const {test}=require('node:test');
const assert=require('node:assert/strict');
const {recommendation,sourceCapacity,allowedStatuses,metrics,sameCityRoute}=require('../lib/domain');
test('branch routing requires different branches in the same known city',()=>{
  assert(sameCityRoute({branch_id:'A',city:' Jeddah '},{branch_id:'B',city:'jeddah'}));
  assert(!sameCityRoute({branch_id:'A',city:'Qassim'},{branch_id:'B',city:'Jeddah'}));
  assert(!sameCityRoute({branch_id:'A',city:'Dammam'},{branch_id:'B',city:'Khobar'}));
  assert(!sameCityRoute({branch_id:'A',city:'Jeddah'},{branch_id:'A',city:'Jeddah'}));
  assert(!sameCityRoute({branch_id:'A',city:null},{branch_id:'B',city:null}));
});
test('recommendation accounts for reservations, safety and pending supply',()=>{
  assert.deepEqual(recommendation({current_stock:20,reserved_stock:5,safety_stock:8},{avg_daily_sales:2},10),{
    available_stock:15,daily_sales:2,days_of_cover:7.5,safety_stock:8,target_days:14,target_stock:36,incoming_units:10,suggested_qty:11,
    reason:'Cover 14 days of recent demand plus safety stock, after open transfers.'});
});
test('zero demand has no infinite cover and only safety-stock need',()=>{
  const r=recommendation({current_stock:0,reserved_stock:2,safety_stock:4},{avg_daily_sales:0});
  assert.equal(r.days_of_cover,null);assert.equal(r.suggested_qty,4);
});
test('source retains seven days by default, supports configured days and never goes negative',()=>{
  assert.equal(sourceCapacity({current_stock:100,reserved_stock:20,safety_stock:10},{avg_daily_sales:3}),49);
  assert.equal(sourceCapacity({current_stock:100,reserved_stock:20,safety_stock:10},{avg_daily_sales:3},14),28);
  assert.equal(sourceCapacity({current_stock:5,reserved_stock:0,safety_stock:10},{avg_daily_sales:3}),0);
});
test('every branch-transfer status action is limited to administrators',()=>{
  for(const role of ['viewer','approver','warehouse','branch_manager']){
    for(const status of ['Pending','Approved','Shipped'])assert.deepEqual(allowedStatuses({role,branch_id:'A'},{status,branch_id:'A',transfer_type:'Branch Transfer'}),[]);
  }
  assert.deepEqual(allowedStatuses({role:'admin'},{status:'Pending',transfer_type:'Branch Transfer'}),['Approved','Rejected','Cancelled']);
});
test('open inbound already meeting target suppresses duplicate recommendation',()=>{
  assert.equal(recommendation({current_stock:0,safety_stock:4},{avg_daily_sales:2},40).suggested_qty,0);
});
test('viewer cannot write, warehouse only ships, approver cannot receive',()=>{
  assert.deepEqual(allowedStatuses({role:'viewer'},{status:'Pending'}),[]);
  assert.deepEqual(allowedStatuses({role:'warehouse'},{status:'Approved'}),['Shipped']);
  assert.deepEqual(allowedStatuses({role:'approver'},{status:'Shipped'}),[]);
});
test('branch manager receives only assigned branch and cannot approve',()=>{
  assert.deepEqual(allowedStatuses({role:'branch_manager',branch_id:'A'},{status:'Shipped',branch_id:'B'}),[]);
  assert.deepEqual(allowedStatuses({role:'branch_manager',branch_id:'A'},{status:'Shipped',branch_id:'A'}),['Received']);
  assert.deepEqual(allowedStatuses({role:'branch_manager',branch_id:'A'},{status:'Pending',branch_id:'A'}),['Cancelled']);
});
test('completed states offer no further transitions',()=>{
  for(const status of ['Received','Rejected','Cancelled'])assert.deepEqual(allowedStatuses({role:'admin'},{status}),[]);
});
test('metrics use actual received time, exclude invalid timing and overdue terminal states',()=>{
  const m=metrics([{branch_id:'A',branch_name:'A',current_stock:1,stock_status:'Low'},{branch_id:'A',branch_name:'A',current_stock:0,stock_status:'Out of Stock'}],
    [{request_id:'1',status:'Received',created_at:'2026-01-01T00:00:00Z'},{request_id:'2',status:'Received',created_at:'2026-01-01T00:00:00Z'},
      {request_id:'3',status:'Pending',created_at:'2026-01-01T00:00:00Z'},{request_id:'4',status:'Cancelled',created_at:'2026-01-01T00:00:00Z'}],
    [{request_id:'1',status:'Received',changed_at:'2026-01-03T00:00:00Z'},{request_id:'2',status:'Received',changed_at:'invalid'}],new Date('2026-01-06T00:00:00Z'));
  assert.equal(m.availability_pct,50);assert.equal(m.measured_deliveries,1);assert.equal(m.completed_transfers,2);
  assert.equal(m.average_delivery_days,2);assert.equal(m.on_time_pct,100);assert.equal(m.overdue.length,1);assert.equal(m.overdue[0].age_days,5);
});
test('empty data uses null metrics instead of misleading zero rates',()=>{
  const m=metrics([],[],[]);assert.equal(m.availability_pct,null);assert.equal(m.average_delivery_days,null);assert.equal(m.on_time_pct,null);
});

