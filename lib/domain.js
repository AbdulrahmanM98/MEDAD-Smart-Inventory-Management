'use strict';

const TARGET_DAYS = 14;
const DEFAULT_SOURCE_DAYS = 7;
const SLA_DAYS = 3;
const transitions = {
  Pending: ['Approved', 'Rejected', 'Cancelled'],
  Approved: ['Shipped', 'Cancelled', 'Rejected'],
  Shipped: ['Received'],
  Received: [], Rejected: [], Cancelled: []
};
const number = v => Math.max(0, Number(v) || 0);
function sameCityRoute(source, destination) {
  const city = b => typeof b?.city === 'string' ? b.city.trim().toLowerCase() : '';
  return !!source && !!destination && source.branch_id !== destination.branch_id && !!city(source) && city(source) === city(destination);
}
function recommendation(inventory, health, incoming = 0) {
  const daily = number(health?.avg_daily_sales);
  const available = Math.max(0, number(inventory.current_stock) - number(inventory.reserved_stock));
  const safety = number(inventory.safety_stock);
  const target = Math.ceil(daily * TARGET_DAYS) + safety;
  const qty = Math.max(0, target - available - number(incoming));
  return {available_stock: available, daily_sales: daily, days_of_cover: daily ? +(available / daily).toFixed(1) : null,
    safety_stock: safety, target_days: TARGET_DAYS, target_stock: target, incoming_units: number(incoming),
    suggested_qty: qty, reason: daily ? `Cover ${TARGET_DAYS} days of recent demand plus safety stock, after open transfers.` : 'Recent demand is zero; replenish only the safety-stock gap.'};
}
function sourceCapacity(inventory, health, sourceDays = DEFAULT_SOURCE_DAYS) {
  const retain = number(inventory.safety_stock) + Math.ceil(number(health?.avg_daily_sales) * sourceDays);
  return Math.max(0, number(inventory.current_stock) - number(inventory.reserved_stock) - retain);
}
function allowedStatuses(user, request) {
  if (request.transfer_type === 'Branch Transfer' && user.role !== 'admin') return [];
  const next = transitions[request.status] || [];
  if (user.role === 'admin') return next;
  if (user.role === 'approver') return next.filter(s => ['Approved','Rejected','Cancelled'].includes(s));
  if (user.role === 'warehouse') return next.filter(s => s === 'Shipped');
  if (user.role === 'branch_manager' && user.branch_id === request.branch_id) return next.filter(s => ['Received','Cancelled'].includes(s));
  return [];
}
function metrics(inventory, transfers, history, now = new Date()) {
  const byRequest = new Map();
  for (const h of history) {
    if (!byRequest.has(h.request_id)) byRequest.set(h.request_id, []);
    byRequest.get(h.request_id).push(h);
  }
  const received = [], overdue = [];
  const perBranch = new Map();
  for (const row of inventory) {
    const key = row.branch_id;
    if (!perBranch.has(key)) perBranch.set(key, {branch_id:key,branch_name:row.branch_name,total:0,in_stock:0,risk:0});
    const b = perBranch.get(key); b.total++;
    if (number(row.current_stock) > 0) b.in_stock++;
    if (['Out of Stock','Critical','Low'].includes(row.stock_status)) b.risk++;
  }
  for (const t of transfers) {
    const started = new Date(t.created_at || `${t.request_date}T00:00:00Z`);
    const events = (byRequest.get(t.request_id) || []).filter(h => h.status === 'Received')
      .map(h => new Date(h.changed_at)).filter(d => Number.isFinite(+d)).sort((a,b)=>a-b);
    if (t.status === 'Received' && events.length && Number.isFinite(+started)) {
      const days = (+events[0]-started) / 86400000;
      if (days >= 0) received.push(days);
    }
    if (['Pending','Approved','Shipped'].includes(t.status) && Number.isFinite(+started)) {
      const age = (+now-started)/86400000;
      if (age > SLA_DAYS) overdue.push({...t,age_days: +age.toFixed(1)});
    }
  }
  const inStock = inventory.filter(r=>number(r.current_stock)>0).length;
  return {sla_days:SLA_DAYS, total_sku_locations:inventory.length,
    availability_pct:inventory.length ? +(100*inStock/inventory.length).toFixed(1) : null,
    completed_transfers:transfers.filter(t=>t.status==='Received').length, measured_deliveries:received.length,
    average_delivery_days:received.length ? +(received.reduce((a,b)=>a+b,0)/received.length).toFixed(1) : null,
    on_time_pct:received.length ? +(100*received.filter(d=>d<=SLA_DAYS).length/received.length).toFixed(1) : null,
    overdue:overdue.sort((a,b)=>b.age_days-a.age_days),
    branches:[...perBranch.values()].map(b=>({...b,availability_pct:+(100*b.in_stock/b.total).toFixed(1)})).sort((a,b)=>a.availability_pct-b.availability_pct)};
}
module.exports = {TARGET_DAYS, DEFAULT_SOURCE_DAYS, SLA_DAYS, recommendation, sourceCapacity, allowedStatuses, metrics, transitions, sameCityRoute};
