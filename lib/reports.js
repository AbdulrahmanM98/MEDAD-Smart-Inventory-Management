'use strict';
const {range,dateValue,summarize}=require('./reports-domain');
module.exports=function installReports(app,{db,fetchAll,measurements}) {
  let metadata=null,metadataAt=0;
  const cache=new Map(),pending=new Map();
  async function options() {
    if(metadata&&Date.now()-metadataAt<60000)return metadata;
    const [branches,products,first,last]=await Promise.all([
      fetchAll('branches','branch_id,branch_name,city'),fetchAll('products','product_id,product_name,category'),
      db.from('sales').select('sale_date').order('sale_date',{ascending:true}).limit(1),
      db.from('sales').select('sale_date').order('sale_date',{ascending:false}).limit(1)
    ]);
    if(first.error||last.error)throw new Error('Sales history is unavailable.');
    metadata={branches,products,data_start:first.data?.[0]?.sale_date||null,data_through:last.data?.[0]?.sale_date||null};metadataAt=Date.now();return metadata;
  }
  async function salesFor(start,end) {
    const key=start+'|'+end,cached=cache.get(key);
    if(cached&&Date.now()-cached.at<60000)return cached.rows;
    if(pending.has(key))return pending.get(key);
    const job=(async()=>{
      const query=()=>db.from('sales').select('sale_date,branch_id,product_id,quantity_sold').gte('sale_date',start).lte('sale_date',end).order('sale_date').order('branch_id').order('product_id');
      const size=1000,first=await query().range(0,size-1);
      if(first.error)throw new Error('Sales history is unavailable.');
      let rows=first.data||[],offset=size;
      while(rows.length===offset) {
        const batch=await Promise.all(Array.from({length:4},(_,i)=>query().range(offset+i*size,offset+(i+1)*size-1)));
        for(const page of batch){if(page.error)throw new Error('Sales history is unavailable.');rows.push(...(page.data||[]));}
        if(batch.some(p=>(p.data||[]).length<size))break;
        offset+=size*4;
      }
      // Bound retained memory; report data is private server-side and never written to disk.
      cache.clear();cache.set(key,{rows,at:Date.now()});return rows;
    })();
    pending.set(key,job);try{return await job;}finally{pending.delete(key);}
  }
  const handle=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(error){res.status(error.status||503).json({error:error.status?error.message:'Reports are temporarily unavailable. Please retry.'});}};
  app.get('/api/reports/options',handle(()=>options()));
  app.get('/api/reports/sales',handle(async req=>{
    const {start,end}=req.query,branch=req.query.branch||'All',category=req.query.category||'All',product=req.query.product||'All',unit=req.query.unit||'piece';
    const period=range(start,end),meta=await options();
    if(!['piece','g'].includes(unit))throw Object.assign(new Error('Choose pieces or grams.'),{status:400});
    const unitProducts=meta.products.filter(p=>(req.measureCatalog.get(p.product_id)?.unit_code||'piece')===unit);
    if(meta.data_through&&dateValue(end)>dateValue(meta.data_through))throw Object.assign(new Error('The end date exceeds the available sales history.'),{status:400});
    if(!meta.branches.some(b=>b.branch_id===branch)&&branch!=='All')throw Object.assign(new Error('Choose an existing branch.'),{status:400});
    if(category!=='All'&&!unitProducts.some(p=>p.category===category))throw Object.assign(new Error('Choose an existing category in this measurement unit.'),{status:400});
    if(product!=='All'&&!unitProducts.some(p=>p.product_id===product&&(category==='All'||p.category===category)))throw Object.assign(new Error('Choose an existing product in this category and measurement unit.'),{status:400});
    const [sales,inventory]=await Promise.all([salesFor(period.previous_start,end),fetchAll('inventory_health','branch_id,product_id,stock_status,current_stock')]);
    return {...summarize({sales,inventory,branches:meta.branches,products:unitProducts,start,end,branch,category,product,dataStart:meta.data_start,dataThrough:meta.data_through}),measurement_unit:unit};
  }));
};
