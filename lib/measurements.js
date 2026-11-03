'use strict';
const {PIECE,atoms,metadata,packages,quote,totals}=require('./weight-domain');
const QUANTITIES=new Set(['current_stock','reserved_stock','safety_stock','available_stock','last_30d_units','last_365d_units','total_history_units','avg_daily_sales','avg_daily','avg_daily_30d','normal_units','normal_avg_daily','ramadan_units','ramadan_avg_daily','ramadan_peak_units','ramadan_peak_avg_daily','eid_fitr_units','eid_fitr_avg_daily','eid_adha_units','eid_adha_avg_daily','promotion_units','requested_qty','quantity','units','previous_units','daily_average','daily_sales','target_stock','incoming_units','suggested_qty','suggested_replenishment_qty','reorder_point','transferable_qty','warehouse_available','network_units','network_average']);
function transform(payload,catalog,context=null){
  if(Array.isArray(payload))return payload.map(row=>transform(row,catalog,context));
  if(!payload||typeof payload!=='object')return payload;
  const id=payload.product_id||payload.product?.product_id;
  if(id&&/^(DGW|DGO)/.test(id)&&!catalog.has(id))throw new Error('Weighted product metadata is missing.');
  const measure=id?(catalog.get(id)||PIECE):payload.measurement_unit==='g'?{...PIECE,unit_code:'g',quantity_scale:100}:context;
  const out={};
  for(const [key,value]of Object.entries(payload)){
    if(measure?.quantity_scale===100&&QUANTITIES.has(key)&&value!==null&&value!==''&&Number.isFinite(Number(value)))out[key]=Number(value)/100;
    else out[key]=transform(value,catalog,measure);
  }
  if(id)Object.assign(out,measure);
  const grouped=Array.isArray(payload.items)?totals(payload.items,catalog):payload.quantity_totals;
  if(grouped){
    out.quantity_totals=grouped;
    const keys=Object.keys(grouped);
    if('total_units' in payload)out.total_units=keys.length===1?grouped[keys[0]]:null;
    if('quantity' in payload)out.quantity=keys.length===1?grouped[keys[0]]:null;
    out.quantity_unit=keys.length===1?keys[0]:'mixed';
  }
  return out;
}
module.exports=function createMeasurements(db){
  let cached=null,loadedAt=0,pending=null;
  async function catalog(){
    if(cached&&Date.now()-loadedAt<60000)return cached;
    if(pending)return pending;
    pending=(async()=>{
      const rows=[];for(let from=0;;from+=1000){const {data,error}=await db.from('rf_product_measures').select('*').range(from,from+999);if(error)throw new Error('Install the weighted-products database migration before starting this version.');rows.push(...data);if(data.length<1000)break;}
      const map=new Map(rows.map(row=>[row.product_id,metadata(row)]));cached=map;loadedAt=Date.now();return map;
    })();try{return await pending;}finally{pending=null;}
  }
  async function middleware(req,res,next){
    if(req.path==='/health')return next();
    try{
      req.measureCatalog=await catalog();
      const json=res.json.bind(res);
      const match=/^\/(?:products\/[^/]+\/([^/]+)\/insights|operations\/recommendations\/[^/]+\/([^/]+))$/.exec(req.path);
      const id=match&&(match[1]||match[2]),context=id?(req.measureCatalog.get(id)||PIECE):null;
      res.json=body=>{try{return json(transform(body,req.measureCatalog,context));}catch{res.status(503);return json({error:'A product measurement is unavailable. Please check its configuration.'});}};
      next();
    }catch{return res.status(503).json({error:'Product measurement settings are unavailable. Run the weighted-products database migration first.'});}
  }
  function inputItems(items,catalog){return items.map(item=>{if(!item||typeof item.product_id!=='string')throw Object.assign(new Error('Choose an existing product.'),{status:400});const m=catalog.get(item.product_id)||PIECE;if(/^(DGW|DGO)/.test(item.product_id)&&!catalog.has(item.product_id))throw Object.assign(new Error('Product measurement metadata is missing.'),{status:400});return {product_id:item.product_id,requested_qty:atoms(item.requested_qty,m.quantity_scale)};});}
  async function weightOptions(productId){
    const map=await catalog(),m=map.get(productId)||PIECE;
    const {data:product,error}=await db.from('products').select('product_id,product_name,unit_price_sar').eq('product_id',productId).single();
    if(error)throw Object.assign(new Error('Product not found.'),{status:404});
    const choices=packages(product,m);
    for(const channel of ['retail','wholesale'])choices[channel]=choices[channel].map(pack=>({...pack,price_sar:quote(product,m,pack.grams)}));
    return {product_id:productId,...m,ounce_grams:30,quarter_ounce_min_price_sar:1500,base_price_sar:product.unit_price_sar,...choices};
  }
  return {catalog,middleware,inputItems,weightOptions,totals:(items,map)=>totals(items,map)};
};
module.exports.transform=transform;
