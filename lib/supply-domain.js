'use strict';
const {atoms}=require('./weight-domain');
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const scale=(catalog,id)=>{if(/^(DGW|DGO)/.test(id)&&!catalog.has(id))fail('Product measurement metadata is missing.');return catalog.get(id)?.quantity_scale||1;};
const display=(value,catalog,id)=>Number(value)/scale(catalog,id);
const pending=row=>['confirmed','shipped'].includes(row.status);
function suggestions({products,inventory,warehouse,transfers,transferItems,requests,catalog}){
  const inbound=new Map(),committed=new Map();
  const open=new Map(transfers.filter(t=>['Approved','Shipped'].includes(t.status)).map(t=>[t.request_id,t]));
  for(const item of transferItems){const transfer=open.get(item.request_id);if(!transfer)continue;const key=transfer.branch_id+'|'+item.product_id;committed.set(key,(committed.get(key)||0)+Number(item.requested_qty));}
  for(const request of requests.filter(pending))for(const item of request.items)inbound.set(item.product_id,(inbound.get(item.product_id)||0)+Math.max(0,item.qty_confirmed-item.qty_arrived));
  const needs=new Map();
  for(const row of inventory){const need=Math.max(0,Math.ceil(Number(row.suggested_replenishment_qty)||0)-(committed.get(row.branch_id+'|'+row.product_id)||0));needs.set(row.product_id,(needs.get(row.product_id)||0)+need);}
  const available=new Map(warehouse.map(row=>[row.product_id,Math.max(0,Math.floor(Number(row.available_stock)||0))]));
  return products.map(p=>{const need=needs.get(p.product_id)||0,stock=available.get(p.product_id)||0,incoming=inbound.get(p.product_id)||0;return {product_id:p.product_id,product_name:p.product_name,category:p.category,unit_code:catalog.get(p.product_id)?.unit_code||'piece',need_qty:display(need,catalog,p.product_id),warehouse_qty:display(stock,catalog,p.product_id),incoming_qty:display(incoming,catalog,p.product_id),suggested_order_qty:display(Math.max(0,need-stock-incoming),catalog,p.product_id)};}).sort((a,b)=>Number(b.suggested_order_qty>0)-Number(a.suggested_order_qty>0)||a.product_id.localeCompare(b.product_id));
}
function text(value,max,required=false){if(value!=null&&typeof value!=='string')fail('Invalid text field.');const result=(value||'').trim();if(result.length>max||required&&!result)fail('A required text field is missing or too long.');return result;}
function date(value){const result=text(value,10,true),parsed=new Date(result+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==result)fail('Enter a valid expected arrival date.');return result;}
function create(body,catalog,products,actor){
  if(!body||typeof body!=='object'||Array.isArray(body))fail('Invalid supply request.');
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.client_id||''))fail('A request identifier is required.');
  const destination=text(body.destination,120,true),note=text(body.note,1000),known=new Set(products.map(p=>p.product_id));
  if(!Array.isArray(body.items)||body.items.length<1||body.items.length>50)fail('Choose between 1 and 50 products.');
  const ids=new Set(),items=body.items.map(item=>{if(!item||!known.has(item.product_id)||ids.has(item.product_id))fail('Choose unique existing products.');ids.add(item.product_id);return {product_id:item.product_id,qty_requested:atoms(item.qty_requested,scale(catalog,item.product_id)),qty_confirmed:0,qty_arrived:0};});
  const now=new Date().toISOString();return {id:body.client_id,status:'requested',version:1,destination,note,erp_reference:'',expected_date:null,created_at:now,updated_at:now,created_by:actor.id,items,history:[{at:now,actor:actor.id,actor_name:actor.name,action:'requested',note}]};
}
function transition(row,body,catalog,actor){
  if(!body||typeof body!=='object'||Array.isArray(body))fail('Invalid supply update.');
  if(body.version!==row.version)throw Object.assign(new Error('This request changed. Refresh before updating.'),{status:409});
  const action=body.action,note=text(body.note,1000);
  if(action==='cancel'){
    if(!['admin','approver'].includes(actor.role)||!['requested','confirmed'].includes(row.status))fail('Cancellation is not allowed for this role or status.');
    row.status='cancelled';
  }else if(action==='confirm'){
    if(!['admin','approver'].includes(actor.role)||row.status!=='requested')fail('Only an administrator or approver can confirm a requested supply.');
    const expected=date(body.expected_date),reference=text(body.erp_reference,120,true);
    if(!Array.isArray(body.items)||body.items.length!==row.items.length)fail('Confirm every product.');
    const ids=new Set();
    for(const item of row.items){const incoming=body.items.find(i=>i?.product_id===item.product_id);if(!incoming||ids.has(incoming.product_id))fail('Confirm unique products.');ids.add(incoming.product_id);item.qty_confirmed=atoms(incoming.qty_confirmed,scale(catalog,item.product_id),{allowZero:true});if(item.qty_confirmed>item.qty_requested)fail('Confirmed quantity cannot exceed requested quantity.');}
    if(!row.items.some(i=>i.qty_confirmed>0))fail('At least one confirmed quantity must be positive.');
    row.expected_date=expected;row.erp_reference=reference;row.status='confirmed';
  }else if(action==='ship'){
    if(!['admin','warehouse','approver'].includes(actor.role)||row.status!=='confirmed')fail('Only confirmed supply can be marked in transit.');row.status='shipped';
  }else if(action==='arrive'){
    if(!['admin','warehouse'].includes(actor.role)||!pending(row))fail('Only warehouse staff can record confirmed arrivals.');
    if(!Array.isArray(body.items)||!body.items.length)fail('Enter quantities that arrived.');
    const ids=new Set();let total=0;
    for(const incoming of body.items){if(!incoming||ids.has(incoming.product_id))fail('Arrival products must be unique.');ids.add(incoming.product_id);const item=row.items.find(i=>i.product_id===incoming.product_id);if(!item)fail('Arrival product is not in this request.');const qty=atoms(incoming.qty_arrived,scale(catalog,item.product_id),{allowZero:true});if(qty>item.qty_confirmed-item.qty_arrived)fail('Arrival quantity exceeds the remaining confirmed quantity.');item.qty_arrived+=qty;total+=qty;}
    if(total<=0)fail('Enter a positive arrival quantity.');if(row.items.every(i=>i.qty_arrived===i.qty_confirmed))row.status='arrived';
  }else fail('Unknown supply action.');
  const now=new Date().toISOString();row.version++;row.updated_at=now;row.history.push({at:now,actor:actor.id,actor_name:actor.name,action,note,items:body.items||null});return row;
}
function present(row,catalog,products){const names=new Map(products.map(p=>[p.product_id,p])),{items,history,...header}=row;return {...header,history:history.map(({at,actor_name,action,note})=>({at,actor_name,action,note})),lines:items.map(i=>({...i,product_name:names.get(i.product_id)?.product_name||i.product_id,unit_code:catalog.get(i.product_id)?.unit_code||'piece',qty_requested:display(i.qty_requested,catalog,i.product_id),qty_confirmed:display(i.qty_confirmed,catalog,i.product_id),qty_arrived:display(i.qty_arrived,catalog,i.product_id),qty_remaining:display(Math.max(0,i.qty_confirmed-i.qty_arrived),catalog,i.product_id)}))};}
module.exports={suggestions,create,transition,present,pending};
