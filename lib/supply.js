'use strict';
const path=require('node:path'),domain=require('./supply-domain');
module.exports=function installSupply(app,{fetchAll}){
  const store=require('./supply-store')(process.env.RETAILFLOW_DATA_DIR||path.join(__dirname,'..','data'));
  const handle=fn=>async(req,res)=>{try{if(!['admin','approver','warehouse','viewer'].includes(req.user.role))return res.status(403).json({error:'Supply planning is available to central operations only.'});await fn(req,res);}catch(error){res.status(error.status||503).json({error:error.status?error.message:'Supply planning is temporarily unavailable. Check the local supply data file.'});}};
  const products=()=>fetchAll('products','product_id,product_name,category');
  app.get('/api/supply',handle(async(req,res)=>{
    const [list,inventory,warehouse,transfers,items]=await Promise.all([products(),fetchAll('inventory_health'),fetchAll('warehouse_health'),fetchAll('transfer_requests'),fetchAll('transfer_request_items')]);
    const requests=store.read();
    res.json({role:req.user.role,requests:requests.map(r=>domain.present(r,req.measureCatalog,list)).sort((a,b)=>b.created_at.localeCompare(a.created_at)),suggestions:domain.suggestions({products:list,inventory,warehouse,transfers,transferItems:items,requests,catalog:req.measureCatalog}),generated_at:new Date().toISOString(),integration:'manual'});
  }));
  app.post('/api/supply',handle(async(req,res)=>{
    if(!['admin','approver','warehouse'].includes(req.user.role))return res.status(403).json({error:'Your role cannot create supply requests.'});
    const list=await products(),created=domain.create(req.body,req.measureCatalog,list,req.user);
    const row=store.change(rows=>{const existing=rows.find(r=>r.id===created.id);if(existing){const same=existing.created_by===created.created_by&&existing.destination===created.destination&&existing.note===created.note&&JSON.stringify(existing.items.map(i=>[i.product_id,i.qty_requested]))===JSON.stringify(created.items.map(i=>[i.product_id,i.qty_requested]));if(!same)throw Object.assign(new Error('Request identifier is already in use.'),{status:409});return existing;}rows.push(created);return created;});
    res.status(201).json(domain.present(row,req.measureCatalog,list));
  }));
  app.patch('/api/supply/:id',handle(async(req,res)=>{
    if(!['admin','approver','warehouse'].includes(req.user.role))return res.status(403).json({error:'Your role cannot update supply requests.'});
    const list=await products();const row=store.change(rows=>{const index=rows.findIndex(r=>r.id===req.params.id);if(index<0)throw Object.assign(new Error('Supply request not found.'),{status:404});const updated=domain.transition(structuredClone(rows[index]),req.body,req.measureCatalog,req.user);rows[index]=updated;return updated;});
    res.json(domain.present(row,req.measureCatalog,list));
  }));
};
