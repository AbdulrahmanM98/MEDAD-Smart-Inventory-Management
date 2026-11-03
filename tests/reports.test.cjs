const {test}=require('node:test');
const assert=require('node:assert/strict');
const {range,summarize,change}=require('../lib/reports-domain');
const branches=[{branch_id:'B1',branch_name:'One'},{branch_id:'B2',branch_name:'Two'},{branch_id:'B3',branch_name:'Zero'}];
const products=[{product_id:'A',product_name:'Amber',category:'Perfume'},{product_id:'B',product_name:'Oud',category:'Oud'},{product_id:'C',product_name:'Cedar',category:'Perfume'}];
const row=(date,branch,product,units)=>({sale_date:date,branch_id:branch,product_id:product,quantity_sold:units});
const sales=[row('2026-01-01','B1','A',5),row('2026-01-02','B1','B',5),row('2026-01-03','B1','A',10),row('2026-01-04','B1','B',30),row('2026-01-03','B2','A',30),row('2026-01-04','B2','B',10)];
const report=extra=>summarize({sales,branches,products,start:'2026-01-03',end:'2026-01-04',branch:'B1',dataStart:'2025-01-01',dataThrough:'2026-01-04',...extra});
test('comparison spans exactly the same number of calendar days across year and leap boundaries',()=>{
  assert.deepEqual(range('2024-02-29','2024-03-01'),{start:'2024-02-29',end:'2024-03-01',days:2,previous_start:'2024-02-27',previous_end:'2024-02-28'});
  assert.equal(range('2026-01-01','2026-01-01').previous_start,'2025-12-31');
  for(const [a,b]of [['2026-02-30','2026-03-01'],['2026-01-02','2026-01-01'],['bad','2026-01-01'],['2024-01-01','2026-01-01']])assert.throws(()=>range(a,b));
});
test('selected branch totals, day averages, previous growth and network share reconcile',()=>{
  const r=report();assert.equal(r.summary.units,40);assert.equal(r.summary.previous_units,10);assert.equal(r.summary.change_pct,300);assert.equal(r.summary.daily_average,20);assert.equal(r.summary.network_units,80);assert.equal(r.summary.network_share_pct,50);assert.equal(r.summary.network_average,80/3);assert.equal(r.previous_complete,true);
  assert.equal(r.trend.reduce((s,d)=>s+d.units,0),40);assert.equal(r.products.reduce((s,p)=>s+p.units,0),40);
});
test('ties share rank and branches without sales remain in benchmark denominator',()=>{
  const r=report();assert.deepEqual(r.branches.map(b=>[b.branch_id,b.rank]),[['B1',1],['B2',1],['B3',3]]);assert.equal(r.summary.branch_count,3);
});
test('category filtering preserves full mix for affinity and filters rankings consistently',()=>{
  const r=report({category:'Perfume'});assert.equal(r.summary.units,10);assert.equal(r.summary.network_units,40);assert.equal(r.summary.rank,2);assert.equal(r.products.length,2);
  const oud=r.strengths.find(c=>c.category==='Oud');assert.equal(oud.affinity,1.5);assert.equal(oud.share_pct,75);assert.equal(oud.network_share_pct,50);
});
test('product filter excludes other products from periods, network and categories',()=>{
  const r=report({product:'A'});assert.equal(r.summary.units,10);assert.equal(r.summary.previous_units,5);assert.equal(r.summary.network_units,40);assert.deepEqual(r.categories.map(c=>c.category),['Perfume']);assert.equal(r.strengths.length,0);
});
test('network totals equal branch totals; zero baseline is null instead of infinite growth',()=>{
  const r=report({branch:'All'});assert.equal(r.summary.units,r.branches.reduce((s,b)=>s+b.units,0));assert.equal(r.summary.rank,null);assert.equal(change(10,0),null);
});
test('missing days are zero-filled and partial previous history is explicitly flagged',()=>{
  const r=report({sales:[sales[2]],dataStart:'2026-01-02'});assert.deepEqual(r.trend.map(d=>d.units),[10,0]);assert.equal(r.previous_complete,false);assert.equal(r.summary.change_pct,null);
});
test('empty periods retain products and branches without inventing sales or strengths',()=>{
  const r=report({sales:[]});assert.equal(r.summary.units,0);assert.equal(r.summary.daily_average,0);assert.equal(r.products.length,3);assert.equal(r.branches.length,3);assert.equal(r.strengths.length,0);
});
test('invalid quantities, dates outside both periods and unknown identities cannot affect totals',()=>{
  const r=report({sales:[...sales,row('2026-01-03','B1','A',-20),row('2026-01-03','B1','A','NaN'),row('2026-01-03','unknown','A',999),row('2026-01-03','B1','unknown',999),row('2025-01-01','B1','A',999)]});assert.equal(r.summary.units,40);assert.throws(()=>report({branch:'unknown'}));
});
test('stock opportunities use only matching current inventory and remain separate from historical units',()=>{
  const r=report({inventory:[{branch_id:'B1',product_id:'A',stock_status:'Low',current_stock:2},{branch_id:'B2',product_id:'A',stock_status:'Critical',current_stock:0},{branch_id:'B1',product_id:'B',stock_status:'Healthy',current_stock:200}]});assert.equal(r.stock_risks.length,1);assert.equal(r.stock_risks[0].current_stock,2);assert.equal(r.summary.units,40);
});
