BEGIN;
-- Additive measurement metadata; original products, quantities, views and RPCs are unchanged.
CREATE TABLE IF NOT EXISTS public.rf_product_measures (
  product_id varchar PRIMARY KEY REFERENCES public.products(product_id) ON DELETE RESTRICT,
  unit_code text NOT NULL DEFAULT 'g' CHECK(unit_code='g'),
  quantity_scale integer NOT NULL DEFAULT 100 CHECK(quantity_scale=100),
  kind text NOT NULL CHECK(kind IN ('wood','oil')),
  price_basis text NOT NULL CHECK(price_basis IN ('ounce','g')),
  wholesale_pack_grams numeric[] NOT NULL DEFAULT ARRAY[125,1000]::numeric[],
  is_demo boolean NOT NULL DEFAULT false,
  CHECK((kind='wood' AND price_basis='ounce') OR (kind='oil' AND price_basis='g')),
  CHECK(COALESCE(array_length(wholesale_pack_grams,1),0)>0 AND array_position(wholesale_pack_grams,NULL) IS NULL AND 0<ALL(wholesale_pack_grams) AND 10000>=ALL(wholesale_pack_grams))
);
ALTER TABLE public.rf_product_measures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rf_product_measures FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.rf_product_measures TO service_role;
COMMENT ON TABLE public.rf_product_measures IS 'Weighted SKU quantities use exact integer centigrams in legacy quantity columns. API displays grams. Wood prices are per 30g ounce; oil prices per gram. Never reinterpret existing piece SKUs.';

CREATE OR REPLACE FUNCTION public.rf_seed_weight_demo(p_check_only boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p record; b record; v_end date; v_grams numeric; v_day integer; v_count integer:=0;
BEGIN
  -- Preflight does not insert data. Installer calls false only after the new code is in place and old server is stopped.
  IF p_check_only THEN RETURN jsonb_build_object('ready',true,'scale',100,'ounce_grams',30,'quarter_threshold_sar',1500); END IF;
  PERFORM pg_advisory_xact_lock(7391702);
  SELECT max(sale_date) INTO v_end FROM sales;
  IF v_end IS NULL THEN v_end:=CURRENT_DATE; END IF;
  FOR p IN SELECT * FROM (VALUES
    ('DGW001','[تجريبي] خشب عود هندي فاخر','العود | Oud',2250::numeric,1200::numeric,'wood','ounce'),
    ('DGW002','[تجريبي] خشب عود كمبودي','العود | Oud',1500::numeric,800::numeric,'wood','ounce'),
    ('DGW003','[تجريبي] خشب عود مروكي','العود | Oud',1200::numeric,600::numeric,'wood','ounce'),
    ('DGW004','[تجريبي] خشب عود لاوسي فاخر','العود | Oud',3000::numeric,1600::numeric,'wood','ounce'),
    ('DGO001','[تجريبي] دهن عود هندي فاخر','دهون العود | Oud Oils',180::numeric,90::numeric,'oil','g'),
    ('DGO002','[تجريبي] دهن عود كمبودي','دهون العود | Oud Oils',120::numeric,60::numeric,'oil','g')
  ) AS demo(id,name,category,price,cost,kind,basis) LOOP
    IF EXISTS(SELECT 1 FROM products WHERE product_id=p.id) AND NOT EXISTS(SELECT 1 FROM rf_product_measures WHERE product_id=p.id AND is_demo) THEN
      RAISE EXCEPTION 'Demo SKU collision for %. No records were changed.',p.id;
    END IF;
    INSERT INTO products(product_id,product_name,category,unit_price_sar,unit_cost_sar,popularity_factor,lead_time_days)
      VALUES(p.id,p.name,p.category,p.price,p.cost,1,4) ON CONFLICT(product_id) DO NOTHING;
    INSERT INTO rf_product_measures(product_id,kind,price_basis,is_demo)
      VALUES(p.id,p.kind,p.basis,true) ON CONFLICT(product_id) DO NOTHING;
    INSERT INTO warehouse_inventory(product_id,current_stock,reserved_stock,snapshot_date)
      VALUES(p.id,CASE WHEN p.kind='wood' THEN 1000000 ELSE 250000 END,0,v_end) ON CONFLICT(product_id) DO NOTHING;
    FOR b IN SELECT branch_id,row_number() OVER(ORDER BY branch_id)::integer AS branch_index FROM branches LOOP
      INSERT INTO branch_inventory(branch_id,product_id,current_stock,reserved_stock,safety_stock,snapshot_date)
        VALUES(b.branch_id,p.id,CASE WHEN p.kind='wood' THEN 10000+b.branch_index*1500 ELSE 5000+b.branch_index*250 END,0,
          CASE WHEN p.kind='wood' THEN 3000 ELSE 1000 END,v_end) ON CONFLICT(branch_id,product_id) DO NOTHING;
    END LOOP;
    v_count:=v_count+1;
  END LOOP;
  -- Bulk anti-joins avoid a separate history scan for each synthetic sale.
  INSERT INTO sales(sale_date,branch_id,product_id,quantity_sold,promotion_flag)
  SELECT v_end-d.day,br.branch_id,sku.product_id,
    (100*CASE WHEN m.kind='wood' THEN CASE WHEN sku.unit_price_sar>=1500 AND (d.day+br.branch_index)%2=0 THEN 7.5 WHEN (d.day+br.branch_index)%3=0 THEN 30 ELSE 15 END
      ELSE (25+((d.day+br.branch_index)%20)*5)::numeric/100 END)::integer,false
  FROM products sku JOIN rf_product_measures m USING(product_id)
  CROSS JOIN (SELECT branch_id,row_number() OVER(ORDER BY branch_id)::integer AS branch_index FROM branches) br
  CROSS JOIN generate_series(0,59) d(day)
  WHERE sku.product_id IN ('DGW001','DGW002','DGW003','DGW004','DGO001','DGO002') AND m.is_demo AND d.day%3=0
    AND NOT EXISTS(SELECT 1 FROM sales s WHERE s.product_id=sku.product_id AND s.branch_id=br.branch_id AND s.sale_date=v_end-d.day);
  INSERT INTO sales(sale_date,branch_id,product_id,quantity_sold,promotion_flag)
  SELECT v_end-1,br.branch_id,sku.product_id,12500,false
  FROM products sku JOIN rf_product_measures m USING(product_id) CROSS JOIN branches br
  WHERE sku.product_id IN ('DGW001','DGW002','DGW003','DGW004') AND m.is_demo
    AND NOT EXISTS(SELECT 1 FROM sales s WHERE s.product_id=sku.product_id AND s.branch_id=br.branch_id AND s.sale_date=v_end-1);
  RETURN jsonb_build_object('demo_products',v_count,'through',v_end,'unit','g','quantity_step',0.01,'existing_piece_products_changed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.rf_seed_weight_demo(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rf_seed_weight_demo(boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
