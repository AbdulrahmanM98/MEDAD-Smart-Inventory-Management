-- RetailFlow v2: additive RPCs. Existing tables and process_transfer_status stay intact.
BEGIN;

CREATE TABLE IF NOT EXISTS public.rf_operational_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  source_days integer NOT NULL DEFAULT 7 CHECK (source_days BETWEEN 1 AND 30),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rf_operational_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rf_operational_settings FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.rf_operational_settings TO service_role;
INSERT INTO public.rf_operational_settings(id,source_days) VALUES(true,7) ON CONFLICT(id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.rf_assert_same_city(p_source_branch_id text,p_destination_branch_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_source_city text; v_destination_city text;
BEGIN
  IF p_source_branch_id IS NULL OR p_destination_branch_id IS NULL OR p_source_branch_id=p_destination_branch_id THEN
    RAISE EXCEPTION 'Choose different source and destination branches in the same city';
  END IF;
  PERFORM 1 FROM public.branches WHERE branch_id IN (p_source_branch_id,p_destination_branch_id) ORDER BY branch_id FOR SHARE;
  SELECT NULLIF(lower(btrim(city)),'') INTO v_source_city FROM public.branches WHERE branch_id=p_source_branch_id;
  SELECT NULLIF(lower(btrim(city)),'') INTO v_destination_city FROM public.branches WHERE branch_id=p_destination_branch_id;
  IF v_source_city IS NULL OR v_destination_city IS NULL OR v_source_city<>v_destination_city THEN
    RAISE EXCEPTION 'Branch transfers are allowed only between branches in the same known city';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.rf_assert_same_city(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rf_assert_same_city(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.rf_create_transfer(
  p_branch_id text, p_source_branch_id text, p_transfer_type text, p_priority text, p_items jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.transfer_requests%ROWTYPE;
  v_id text;
  v_items jsonb;
  v_item record;
  v_capacity numeric;
  v_source_days integer;
BEGIN
  SELECT source_days INTO v_source_days FROM public.rf_operational_settings WHERE id=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source coverage settings missing'; END IF;
  IF p_transfer_type NOT IN ('Warehouse Replenishment','Branch Transfer') OR p_priority NOT IN ('Normal','High','Critical') THEN
    RAISE EXCEPTION 'Invalid type or priority';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE branch_id=p_branch_id) THEN RAISE EXCEPTION 'Destination branch not found'; END IF;
  IF p_transfer_type='Branch Transfer' AND (p_source_branch_id IS NULL OR p_source_branch_id=p_branch_id OR NOT EXISTS (SELECT 1 FROM public.branches WHERE branch_id=p_source_branch_id)) THEN
    RAISE EXCEPTION 'Choose an existing, different source branch';
  END IF;
  IF p_transfer_type='Branch Transfer' THEN PERFORM public.rf_assert_same_city(p_source_branch_id,p_branch_id); END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' THEN RAISE EXCEPTION 'Items must be an array'; END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Add 1-100 items'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) i WHERE NOT (i ? 'product_id' AND i ? 'requested_qty') OR i->>'product_id' IS NULL OR i->>'requested_qty' IS NULL) THEN
    RAISE EXCEPTION 'Each item requires a product and quantity';
  END IF;
  IF (SELECT count(DISTINCT i->>'product_id') FROM jsonb_array_elements(p_items) i) <> jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Duplicate products'; END IF;
  FOR v_item IN SELECT i->>'product_id' product_id, (i->>'requested_qty')::numeric qty FROM jsonb_array_elements(p_items) i LOOP
    IF v_item.qty <> trunc(v_item.qty) OR v_item.qty NOT BETWEEN 1 AND 1000000 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.branch_inventory WHERE branch_id=p_branch_id AND product_id=v_item.product_id) THEN
      RAISE EXCEPTION 'Destination inventory missing for %', v_item.product_id;
    END IF;
    IF p_transfer_type='Branch Transfer' THEN
      SELECT GREATEST(0, b.current_stock-COALESCE(b.reserved_stock,0)-COALESCE(b.safety_stock,0)-ceil(GREATEST(0,COALESCE(h.avg_daily_sales,0))*v_source_days))
      INTO v_capacity FROM public.branch_inventory b LEFT JOIN public.inventory_health h USING(branch_id,product_id)
      WHERE b.branch_id=p_source_branch_id AND b.product_id=v_item.product_id;
    ELSE
      SELECT GREATEST(0,current_stock-COALESCE(reserved_stock,0)) INTO v_capacity FROM public.warehouse_inventory WHERE product_id=v_item.product_id;
    END IF;
    IF v_capacity IS NULL OR v_capacity<v_item.qty THEN RAISE EXCEPTION 'Insufficient transferable stock for %. Available %, requested %',v_item.product_id,COALESCE(v_capacity,0),v_item.qty; END IF;
  END LOOP;
  -- Allocate the request number inside the same transaction as header and items.
  PERFORM pg_advisory_xact_lock(7391701);
  SELECT 'TR-' || lpad((COALESCE(max(substring(request_id from '^TR-([0-9]+)$')::bigint),0)+1)::text,
    GREATEST(4,length((COALESCE(max(substring(request_id from '^TR-([0-9]+)$')::bigint),0)+1)::text)),'0') INTO v_id FROM public.transfer_requests;
  INSERT INTO public.transfer_requests(request_id,request_date,branch_id,priority,status,last_updated,product_id,requested_qty,transfer_type,source_branch_id)
  VALUES(v_id,CURRENT_DATE,p_branch_id,p_priority,'Pending',CURRENT_DATE,NULL,NULL,p_transfer_type,
    CASE WHEN p_transfer_type='Branch Transfer' THEN p_source_branch_id ELSE NULL END) RETURNING * INTO v_request;
  INSERT INTO public.transfer_request_items(request_id,product_id,requested_qty)
  SELECT v_id,i->>'product_id',(i->>'requested_qty')::integer FROM jsonb_array_elements(p_items) i;
  IF NOT EXISTS (SELECT 1 FROM public.transfer_status_history WHERE request_id=v_id AND status='Pending') THEN
    INSERT INTO public.transfer_status_history(request_id,status) VALUES(v_id,'Pending');
  END IF;
  SELECT jsonb_agg(to_jsonb(t) ORDER BY item_id) INTO v_items FROM public.transfer_request_items t WHERE request_id=v_id;
  RETURN jsonb_build_object('request',to_jsonb(v_request),'items',v_items,'item_count',jsonb_array_length(p_items),
    'total_units',(SELECT sum((i->>'requested_qty')::integer) FROM jsonb_array_elements(p_items) i));
END;
$$;

CREATE OR REPLACE FUNCTION public.rf_change_transfer_status(p_request_id text,p_new_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request public.transfer_requests%ROWTYPE; v_item record; v_stock record; v_capacity numeric; v_result jsonb; v_source_days integer;
BEGIN
  SELECT source_days INTO v_source_days FROM public.rf_operational_settings WHERE id=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source coverage settings missing'; END IF;
  SELECT * INTO v_request FROM public.transfer_requests WHERE request_id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer request not found'; END IF;
  IF v_request.transfer_type='Branch Transfer' AND p_new_status IN ('Approved','Shipped','Received') THEN
    PERFORM public.rf_assert_same_city(v_request.source_branch_id,v_request.branch_id);
  END IF;
  -- Lock the source in product order before checking its own retained demand.
  IF v_request.transfer_type='Branch Transfer' AND v_request.status='Pending' AND p_new_status='Approved' THEN
    FOR v_item IN SELECT * FROM public.transfer_request_items WHERE request_id=p_request_id ORDER BY product_id LOOP
      SELECT * INTO v_stock FROM public.branch_inventory WHERE branch_id=v_request.source_branch_id AND product_id=v_item.product_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Source inventory missing for %',v_item.product_id; END IF;
      SELECT GREATEST(0,v_stock.current_stock-COALESCE(v_stock.reserved_stock,0)-COALESCE(v_stock.safety_stock,0)-ceil(GREATEST(0,COALESCE(avg_daily_sales,0))*v_source_days))
      INTO v_capacity FROM public.inventory_health WHERE branch_id=v_request.source_branch_id AND product_id=v_item.product_id;
      IF v_capacity IS NULL OR v_capacity<v_item.requested_qty THEN RAISE EXCEPTION 'Transfer would consume source safety stock or configured source demand for %',v_item.product_id; END IF;
    END LOOP;
  END IF;
  -- The existing function atomically reserves, ships, releases and receives stock.
  v_result := public.process_transfer_status(p_request_id::varchar,p_new_status::varchar);
  IF NOT EXISTS (SELECT 1 FROM public.transfer_status_history WHERE request_id=p_request_id AND status=p_new_status) THEN
    INSERT INTO public.transfer_status_history(request_id,status) VALUES(p_request_id,p_new_status);
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.rf_create_transfer(text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.rf_change_transfer_status(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rf_create_transfer(text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rf_change_transfer_status(text,text) TO service_role;
-- Clients must use the role-checked server, including for the legacy RPC.
REVOKE EXECUTE ON FUNCTION public.process_transfer_status(varchar,varchar) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_transfer_status(varchar,varchar) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
