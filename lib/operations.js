'use strict';
const path = require('path');
const {createAuth} = require('./auth');
const {recommendation,sourceCapacity,allowedStatuses,metrics,sameCityRoute} = require('./domain');

module.exports = function installOperations(app, {db,fetchAll,measurements}) {
  const {audit}=createAuth(app,{db,dataDir:process.env.RETAILFLOW_DATA_DIR||path.join(__dirname,'..','data')});
  app.use('/api',measurements.middleware);
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  const one=async(table,key,value)=>{
    const {data,error}=await db.from(table).select('*').eq(key,value).single();
    if(error)throw Object.assign(new Error(`${table} record not found.`),{status:404});return data;
  };
  const rpc=async(name,args)=>{
    const {data,error}=await db.rpc(name,args);
    if(error)throw Object.assign(new Error(error.code==='PGRST202'?'Install sql/operations.sql before using transfers.':error.message),{status:error.code==='PGRST202'?503:400});
    return data;
  };
  async function snapshot() {
    const [inventory,transfers,history]=await Promise.all([
      fetchAll('inventory_health'),fetchAll('transfer_requests'),fetchAll('transfer_status_history')
    ]);return {inventory,transfers,history};
  }
  async function readSettings() {
    const {data,error}=await db.from('rf_operational_settings').select('source_days').eq('id',true).single();
    if(error)throw Object.assign(new Error('Replenishment settings are unavailable.'),{status:503});
    return data;
  }
  app.get('/api/products/:productId/weight-options',wrap(async(req,res)=>res.json(await measurements.weightOptions(req.params.productId))));
  app.get('/api/operations/settings',wrap(async(req,res)=>res.json(await readSettings())));
  app.patch('/api/operations/settings',wrap(async(req,res)=>{
    if(req.user.role!=='admin')return res.status(403).json({error:'Only an administrator can change transfer settings.'});
    const days=req.body.source_days;
    if(!Number.isInteger(days)||days<1||days>30)return res.status(400).json({error:'Source coverage must be a whole number from 1 to 30 days.'});
    const {data,error}=await db.from('rf_operational_settings').update({source_days:days,updated_at:new Date().toISOString()}).eq('id',true).select('source_days').single();
    if(error)throw error;
    audit(req.user,'settings.source_days',{source_days:days});res.json(data);
  }));
  app.get('/api/operations/recommendations/:branchId/:productId',wrap(async(req,res)=>{
    const {branchId,productId}=req.params;
    const [health,inventories,warehouses,transfers,items,settings,branches]=await Promise.all([
      fetchAll('inventory_health','*',q=>q.eq('product_id',productId)),
      fetchAll('branch_inventory','*',q=>q.eq('product_id',productId)),
      fetchAll('warehouse_health','*',q=>q.eq('product_id',productId)),
      fetchAll('transfer_requests','*',q=>q.eq('branch_id',branchId).in('status',['Pending','Approved','Shipped'])),
      fetchAll('transfer_request_items','*',q=>q.eq('product_id',productId)),readSettings(),fetchAll('branches')
    ]);
    const current=inventories.find(r=>r.branch_id===branchId);
    if(!current)return res.status(404).json({error:'Branch inventory not found.'});
    const open=new Set(transfers.map(t=>t.request_id));
    const incoming=items.filter(i=>open.has(i.request_id)).reduce((sum,i)=>sum+Number(i.requested_qty),0);
    const rec=recommendation(current,health.find(r=>r.branch_id===branchId),incoming);
    const destination=branches.find(b=>b.branch_id===branchId);
    const sources=(req.user.role==='admin'?inventories:[]).filter(r=>sameCityRoute(branches.find(b=>b.branch_id===r.branch_id),destination)).map(r=>({
      branch_id:r.branch_id,branch_name:health.find(h=>h.branch_id===r.branch_id)?.branch_name||r.branch_id,
      transferable_qty:sourceCapacity(r,health.find(h=>h.branch_id===r.branch_id),settings.source_days)
    })).filter(r=>r.transferable_qty>0).sort((a,b)=>b.transferable_qty-a.transferable_qty);
    res.json({recommendation:rec,sources,destination_city:destination?.city||null,source_retention_days:settings.source_days,warehouse_available:Math.max(0,Number(warehouses[0]?.available_stock)||0)});
  }));
  app.get('/api/operations/alerts',wrap(async(req,res)=>{
    const {inventory,transfers,history}=await snapshot();
    const result=metrics(inventory,transfers,history);
    let rows=inventory.filter(r=>['Out of Stock','Critical','Low'].includes(r.stock_status)).map(r=>({
      kind:'stock',severity:r.stock_status==='Low'?'warning':'critical',branch_id:r.branch_id,branch_name:r.branch_name,
      product_id:r.product_id,product_name:r.product_name,status:r.stock_status,current_stock:r.current_stock,
      days_of_cover:r.days_of_cover,suggested_qty:r.suggested_replenishment_qty,
      message:r.stock_status==='Out of Stock'?'No stock available.':`Stock cover: ${r.days_of_cover==null?'unknown':Number(r.days_of_cover).toFixed(1)+' days'}.`
    }));
    rows.push(...result.overdue.map(t=>({kind:'transfer',severity:'warning',branch_id:t.branch_id,
      branch_name:inventory.find(i=>i.branch_id===t.branch_id)?.branch_name||t.branch_id,
      request_id:t.request_id,status:t.status,age_days:t.age_days,message:`Open for ${t.age_days} days; target is ${result.sla_days} days.`})));
    const summary={critical:rows.filter(r=>r.severity==='critical').length,warning:rows.filter(r=>r.severity==='warning').length,overdue:result.overdue.length};
    if(req.query.branch&&req.query.branch!=='All')rows=rows.filter(r=>r.branch_id===req.query.branch);
    if(req.query.severity&&req.query.severity!=='All')rows=rows.filter(r=>r.severity===req.query.severity);
    if(req.query.kind&&req.query.kind!=='All')rows=rows.filter(r=>r.kind===req.query.kind);
    const search=String(req.query.search||'').trim().toLowerCase();
    if(search)rows=rows.filter(r=>[r.branch_name,r.product_name,r.product_id,r.request_id].some(s=>String(s||'').toLowerCase().includes(search)));
    rows.sort((a,b)=>(a.severity==='critical'?0:1)-(b.severity==='critical'?0:1)||((Number(a.days_of_cover)||0)-(Number(b.days_of_cover)||0)));
    const count=rows.length,totalPages=Math.max(1,Math.ceil(count/25)),page=Math.min(totalPages,Math.max(1,Math.floor(Number(req.query.page)||1)));
    res.json({data:rows.slice((page-1)*25,page*25),summary,count,page,totalPages,generated_at:new Date().toISOString()});
  }));
  app.get('/api/operations/metrics',wrap(async(req,res)=>{
    const s=await snapshot();res.json({...metrics(s.inventory,s.transfers,s.history),generated_at:new Date().toISOString()});
  }));
  app.get('/api/transfers',wrap(async(req,res)=>{
    const rows=await fetchAll('transfer_request_summary','*',q=>req.query.status&&req.query.status!=='All'?q.eq('status',req.query.status):q);
    const headers=await fetchAll('transfer_requests','request_id,branch_id,source_branch_id,transfer_type,status');
    const branches=await fetchAll('branches');
    const measureItems=await fetchAll('transfer_request_items');
    const map=new Map(headers.map(t=>[t.request_id,t]));
    const data=rows.map(r=>{
      const t=map.get(r.request_id)||r;
      const invalidRoute=t.transfer_type==='Branch Transfer'&&!sameCityRoute(branches.find(b=>b.branch_id===t.source_branch_id),branches.find(b=>b.branch_id===t.branch_id));
      return {...r,...t,quantity_totals:measurements.totals(measureItems.filter(i=>i.request_id===t.request_id),req.measureCatalog),route_block_reason:invalidRoute?'Source and destination must be in the same city.':null,
        allowed_statuses:allowedStatuses(req.user,t).filter(s=>!invalidRoute||!['Approved','Shipped','Received'].includes(s))};
    });
    data.sort((a,b)=>String(b.created_at||b.request_date).localeCompare(String(a.created_at||a.request_date)));
    res.json({count:data.length,data});
  }));
  app.post('/api/transfers',wrap(async(req,res)=>{
    if(!['admin','approver','branch_manager'].includes(req.user.role))return res.status(403).json({error:'Your role cannot create transfers.'});
    const {branch_id,source_branch_id=null,transfer_type='Warehouse Replenishment',priority='High',items}=req.body;
    if(transfer_type==='Branch Transfer'&&req.user.role!=='admin')return res.status(403).json({error:'Only an administrator can create branch-to-branch transfers.'});
    if(req.user.role==='branch_manager'&&branch_id!==req.user.branch_id)return res.status(403).json({error:'Create requests only for your assigned branch.'});
    if(typeof branch_id!=='string'||!branch_id||branch_id.length>64)return res.status(400).json({error:'Choose a destination branch.'});
    if(!['Warehouse Replenishment','Branch Transfer'].includes(transfer_type)||!['Normal','High','Critical'].includes(priority))return res.status(400).json({error:'Invalid transfer type or priority.'});
    if(transfer_type==='Branch Transfer'&&(typeof source_branch_id!=='string'||!source_branch_id||source_branch_id===branch_id))return res.status(400).json({error:'Choose a different source branch.'});
    if(transfer_type==='Branch Transfer'){
      const branches=await fetchAll('branches');
      if(!sameCityRoute(branches.find(b=>b.branch_id===source_branch_id),branches.find(b=>b.branch_id===branch_id)))return res.status(400).json({error:'Branch transfers are allowed only between different branches in the same city. Both branches need a known city.'});
    }
    if(!Array.isArray(items)||!items.length||items.length>100)return res.status(400).json({error:'Add 1–100 products.'});
    let cleaned;try{cleaned=measurements.inputItems(items,req.measureCatalog);}catch(error){return res.status(400).json({error:error.message});}
    if(cleaned.some(i=>typeof i.product_id!=='string'||!i.product_id||i.product_id.length>64||!Number.isSafeInteger(i.requested_qty)||i.requested_qty<1||i.requested_qty>1000000))return res.status(400).json({error:'Each product needs a positive whole-number quantity, up to 1,000,000.'});
    if(new Set(cleaned.map(i=>i.product_id)).size!==cleaned.length)return res.status(400).json({error:'The same product cannot appear twice.'});
    const data=await rpc('rf_create_transfer',{p_branch_id:branch_id,p_source_branch_id:transfer_type==='Branch Transfer'?source_branch_id:null,p_transfer_type:transfer_type,p_priority:priority,p_items:cleaned});
    audit(req.user,'transfer.create',{request_id:data.request.request_id,branch_id,transfer_type});res.status(201).json(data);
  }));
  app.patch('/api/transfers/:id/status',wrap(async(req,res)=>{
    const t=await one('transfer_requests','request_id',req.params.id);
    if(!allowedStatuses(req.user,t).includes(req.body.status))return res.status(403).json({error:'This status change is not permitted for your role or the current request state.'});
    if(t.transfer_type==='Branch Transfer'&&['Approved','Shipped','Received'].includes(req.body.status)){
      const branches=await fetchAll('branches');
      if(!sameCityRoute(branches.find(b=>b.branch_id===t.source_branch_id),branches.find(b=>b.branch_id===t.branch_id)))return res.status(400).json({error:'Source and destination must be in the same city. Cancel or reject the old request instead.'});
    }
    const data=await rpc('rf_change_transfer_status',{p_request_id:req.params.id,p_new_status:req.body.status});
    audit(req.user,'transfer.status',{request_id:req.params.id,from:t.status,to:req.body.status});res.json(data);
  }));
  // Multi-item transfers have null legacy product_id/quantity fields; use their items.
  app.get('/api/deliveries/recent',wrap(async(req,res)=>{
    const [history,transfers,items,branches,products]=await Promise.all([
      fetchAll('transfer_status_history','*',q=>q.eq('status','Received')),fetchAll('transfer_requests'),fetchAll('transfer_request_items'),fetchAll('branches'),fetchAll('products')
    ]);
    history.sort((a,b)=>String(b.changed_at).localeCompare(String(a.changed_at)));
    const seen=new Set(),data=[];
    for(const h of history){
      if(seen.has(h.request_id))continue;seen.add(h.request_id);
      const t=transfers.find(t=>t.request_id===h.request_id);if(!t)continue;
      const lines=items.filter(i=>i.request_id===h.request_id);
      data.push({request_id:t.request_id,branch_id:t.branch_id,branch_name:branches.find(b=>b.branch_id===t.branch_id)?.branch_name||t.branch_id,
        product_id:lines.length===1?lines[0].product_id:'',product_name:lines.length===1?(products.find(p=>p.product_id===lines[0].product_id)?.product_name||lines[0].product_id):`${lines.length} products`,
        quantity:lines.reduce((s,i)=>s+Number(i.requested_qty),0),quantity_totals:measurements.totals(lines,req.measureCatalog),delivered_at:h.changed_at});
      if(data.length===8)break;
    }res.json({count:data.length,data});
  }));
};
