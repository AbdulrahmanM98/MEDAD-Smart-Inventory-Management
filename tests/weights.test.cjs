const {test}=require('node:test'),assert=require('node:assert/strict');
const {atoms,metadata,packages,packageWeight,quote,totals,PIECE}=require('../lib/weight-domain');
const {transform}=require('../lib/measurements');
const wood=metadata({unit_code:'g',quantity_scale:100,kind:'wood',price_basis:'ounce',is_demo:true});
const oil=metadata({unit_code:'g',quantity_scale:100,kind:'oil',price_basis:'g',is_demo:true});
const catalog=new Map([['DGW001',wood],['DGO001',oil]]);
test('grams are exact hundredths; fractions are never truncated or rounded on input',()=>{
  assert.equal(atoms('7.50'),750);assert.equal(atoms(0.01),1);assert.equal(atoms('1000'),100000);assert.equal(atoms('10000'),1000000);
  for(const bad of ['0.001','7.501','1e2','-1','Infinity',NaN,'',null,'10000.01'])assert.throws(()=>atoms(bad));
});
test('existing pieces remain whole numbers and retain their original scale',()=>{
  assert.equal(atoms('3',1),3);assert.throws(()=>atoms('3.5',1));assert.throws(()=>atoms('0',1));assert.equal(metadata(null).quantity_scale,1);
});
test('quarter ounce is enabled at 1500 inclusive, and absent below 1500',()=>{
  assert.deepEqual(packages({unit_price_sar:1499.99},wood).retail.map(p=>p.grams),[15,30]);
  for(const price of [1500,1500.01,2250])assert.deepEqual(packages({unit_price_sar:price},wood).retail.map(p=>p.grams),[7.5,15,30]);
});
test('wood ounce, half and quarter weights equal 30, 15 and 7.50 grams',()=>{
  const p={unit_price_sar:1500};assert.equal(packageWeight(p,wood,'retail','quarter_ounce'),7.5);assert.equal(packageWeight(p,wood,'retail','half_ounce'),15);assert.equal(packageWeight(p,wood,'retail','ounce'),30);
  assert.throws(()=>packageWeight({unit_price_sar:1200},wood,'retail','quarter_ounce'));assert.throws(()=>packageWeight(p,wood,'retail','half_ounce',0.5));
});
test('wholesale weights are independent of the retail price threshold',()=>{
  for(const price of [1200,1500,2250]){const p={unit_price_sar:price};assert.deepEqual(packages(p,wood).wholesale.map(p=>p.grams),[125,1000]);assert.equal(packageWeight(p,wood,'wholesale','wholesale_125',2),250);assert.equal(packageWeight(p,wood,'wholesale','wholesale_1000'),1000);}
});
test('oil can be quoted in fractional grams down to 0.01',()=>{
  assert.equal(packageWeight({unit_price_sar:180},oil,'retail','gram',0.25),0.25);assert.equal(quote({unit_price_sar:180},oil,0.25),45);assert.equal(quote({unit_price_sar:180},oil,0.01),1.8);
});
test('prices are per 30g ounce for wood and use integer cents until final rounding',()=>{
  assert.equal(quote({unit_price_sar:1500},wood,7.5),375);assert.equal(quote({unit_price_sar:2250},wood,15),1125);assert.equal(quote({unit_price_sar:1500},wood,125),6250);assert.equal(quote({unit_price_sar:1500},wood,1000),50000);
  assert.equal(quote({unit_price_sar:1499.99},wood,15),750);
});
test('mixed transfers expose separate piece and gram totals',()=>{
  const raw=[{product_id:'P001',requested_qty:2},{product_id:'DGW001',requested_qty:750},{product_id:'DGO001',requested_qty:1}];
  assert.deepEqual(totals(raw,catalog),{piece:2,g:7.51});
  const out=transform({total_units:753,items:raw},catalog);assert.equal(out.total_units,null);assert.equal(out.quantity_unit,'mixed');assert.equal(out.items[1].requested_qty,7.5);assert.deepEqual(out.quantity_totals,{piece:2,g:7.51});
});
test('weighted stock, seasonal sales and recommendations convert exactly once',()=>{
  const out=transform({product:{product_id:'DGW001'},current_inventory:{current_stock:12345,reserved_stock:25},seasonal_sales:{normal:{units:750,avg_daily:12.5}},recommendation:{target_stock:10001,suggested_qty:1,target_days:14},sources:[{branch_id:'B1',transferable_qty:525}]},catalog);
  assert.equal(out.current_inventory.current_stock,123.45);assert.equal(out.current_inventory.reserved_stock,0.25);assert.equal(out.seasonal_sales.normal.units,7.5);assert.equal(out.seasonal_sales.normal.avg_daily,0.125);assert.equal(out.recommendation.suggested_qty,0.01);assert.equal(out.recommendation.target_days,14);assert.equal(out.sources[0].transferable_qty,5.25);
});
test('weighted report quantities convert while percentages, days and counts remain unchanged',()=>{
  const out=transform({measurement_unit:'g',summary:{units:750,daily_average:25,change_pct:25,active_products:6,rank:2},trend:[{units:250,previous_units:50}],categories:[{units:750,network_units:1000,share_pct:75,affinity:1.5}]},catalog);
  assert.equal(out.summary.units,7.5);assert.equal(out.summary.daily_average,0.25);assert.equal(out.summary.change_pct,25);assert.equal(out.summary.active_products,6);assert.equal(out.summary.rank,2);assert.equal(out.categories[0].share_pct,75);assert.equal(out.trend[0].previous_units,0.5);
});
test('piece responses and ordinary IDs are unchanged; missing demo metadata fails closed',()=>{
  assert.equal(transform({product_id:'P001',quantity:8,current_stock:10},catalog).quantity,8);assert.throws(()=>transform({product_id:'DGW099',quantity:750},catalog));assert.deepEqual(transform({count:80,page:1,data:[]},catalog),{count:80,page:1,data:[]});
});
test('metadata rejects mixed pricing bases and invalid wholesale weights',()=>{
  assert.throws(()=>metadata({unit_code:'g',quantity_scale:100,kind:'wood',price_basis:'g'}));assert.throws(()=>metadata({unit_code:'g',quantity_scale:100,kind:'oil',price_basis:'g',wholesale_pack_grams:[null]}));
});
