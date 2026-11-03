'use strict';
const DAY=86400000;
function dateValue(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const time=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time:null;
}
const iso=time=>new Date(time).toISOString().slice(0,10);
function range(start,end) {
  const a=dateValue(start),b=dateValue(end);
  if(a===null||b===null||b<a)throw Object.assign(new Error('Choose a valid start and end date.'),{status:400});
  const days=Math.round((b-a)/DAY)+1;
  if(days>366)throw Object.assign(new Error('Choose a period of up to 366 days.'),{status:400});
  return {start,end,days,previous_start:iso(a-days*DAY),previous_end:iso(a-DAY)};
}
const change=(current,previous)=>previous>0?(current-previous)/previous*100:null;
function summarize({sales,branches,products,inventory=[],start,end,branch='All',category='All',product='All',dataStart=null,dataThrough=null}) {
  const period=range(start,end),productMap=new Map(products.map(p=>[p.product_id,p]));
  const selectedProducts=products.filter(p=>(category==='All'||p.category===category)&&(product==='All'||p.product_id===product));
  const selectedIds=new Set(selectedProducts.map(p=>p.product_id));
  const branchMap=new Map(branches.map(b=>[b.branch_id,b]));
  if(branch!=='All'&&!branchMap.has(branch))throw Object.assign(new Error('Choose an existing branch.'),{status:400});
  const totals=new Map(branches.map(b=>[b.branch_id,{...b,units:0,previous_units:0}]));
  const productTotals=new Map(selectedProducts.map(p=>[p.product_id,{...p,units:0,previous_units:0}]));
  const categoryTotals=new Map();
  const trend=Array.from({length:period.days},(_,i)=>({date:iso(dateValue(start)+i*DAY),previous_date:iso(dateValue(period.previous_start)+i*DAY),units:0,previous_units:0}));
  let units=0,previousUnits=0,networkUnits=0;
  for(const row of sales) {
    if(!branchMap.has(row.branch_id))continue;
    const p=productMap.get(row.product_id),qty=Number(row.quantity_sold);
    if(!p||!Number.isFinite(qty)||qty<0)continue;
    const current=row.sale_date>=start&&row.sale_date<=end;
    const previous=row.sale_date>=period.previous_start&&row.sale_date<=period.previous_end;
    if(!current&&!previous)continue;
    // Affinity compares each category's share of the branch's complete sales mix.
    if(current&&(product==='All'||row.product_id===product)) {
      const c=categoryTotals.get(p.category)||{category:p.category,units:0,network_units:0};
      c.network_units+=qty;if(branch==='All'||branch===row.branch_id)c.units+=qty;
      categoryTotals.set(p.category,c);
    }
    if(!selectedIds.has(row.product_id))continue;
    const bt=totals.get(row.branch_id);bt[current?'units':'previous_units']+=qty;
    if(current)networkUnits+=qty;
    if(branch!=='All'&&row.branch_id!==branch)continue;
    const pt=productTotals.get(row.product_id);pt[current?'units':'previous_units']+=qty;
    if(current)units+=qty;else previousUnits+=qty;
    const index=Math.round((dateValue(row.sale_date)-dateValue(current?start:period.previous_start))/DAY);
    if(trend[index])trend[index][current?'units':'previous_units']+=qty;
  }
  const ranking=[...totals.values()].sort((a,b)=>b.units-a.units||a.branch_id.localeCompare(b.branch_id));
  let prior=null,rank=0;ranking.forEach((b,i)=>{if(b.units!==prior)rank=i+1;b.rank=rank;prior=b.units;b.change_pct=change(b.units,b.previous_units);});
  const allCategories=[...categoryTotals.values()];
  const mixUnits=allCategories.reduce((s,c)=>s+c.units,0),networkMix=allCategories.reduce((s,c)=>s+c.network_units,0);
  const categories=allCategories.map(c=>({...c,share_pct:mixUnits?c.units/mixUnits*100:0,network_share_pct:networkMix?c.network_units/networkMix*100:0,affinity:mixUnits&&networkMix&&c.network_units?(c.units/mixUnits)/(c.network_units/networkMix):null})).sort((a,b)=>b.units-a.units||a.category.localeCompare(b.category));
  const productRows=[...productTotals.values()].map(p=>({...p,share_pct:units?p.units/units*100:0,change_pct:change(p.units,p.previous_units)})).sort((a,b)=>b.units-a.units||a.product_id.localeCompare(b.product_id));
  const strengths=branch==='All'||product!=='All'?[]:categories.filter(c=>c.units>0&&c.affinity>1).sort((a,b)=>b.affinity-a.affinity);
  const currentStock=new Map(inventory.filter(r=>branch==='All'||r.branch_id===branch).map(r=>[r.branch_id+'|'+r.product_id,r]));
  const risks=[...currentStock.values()].filter(r=>selectedIds.has(r.product_id)&&['Out of Stock','Critical','Low'].includes(r.stock_status)).map(r=>({branch_id:r.branch_id,branch_name:branchMap.get(r.branch_id)?.branch_name||r.branch_id,product_id:r.product_id,product_name:productMap.get(r.product_id)?.product_name||r.product_id,stock_status:r.stock_status,current_stock:r.current_stock})).slice(0,8);
  const average=branches.length?networkUnits/branches.length:0;
  return {period,data_start:dataStart,data_through:dataThrough,previous_complete:!!dataStart&&period.previous_start>=dataStart&&(!dataThrough||period.previous_end<=dataThrough),filters:{branch,category,product},
    summary:{units,previous_units:previousUnits,change_pct:change(units,previousUnits),daily_average:units/period.days,active_products:productRows.filter(p=>p.units>0).length,network_units:networkUnits,network_average:average,vs_network_average_pct:branch==='All'?null:change(units,average),network_share_pct:networkUnits?units/networkUnits*100:0,rank:branch==='All'?null:ranking.find(b=>b.branch_id===branch)?.rank,branch_count:branches.length},
    trend,products:productRows,categories,strengths,branches:ranking,stock_risks:risks};
}
module.exports={range,dateValue,iso,change,summarize};
