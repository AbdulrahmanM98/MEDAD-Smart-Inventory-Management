const state = {
  currentView: 'dashboard',
  branches: [],
  products: [],
  categories: [],
  inventoryPage: 1,
  inventoryTotalPages: 1
};

const $ = id => document.getElementById(id);
const SAUDI_TIMEZONE = 'Asia/Riyadh';

function statusBadge(status) {
  const map = {
    'Out of Stock':'badge-red',
    'Critical':'badge-red',
    'Low':'badge-amber',
    'Healthy':'badge-green',
    'Overstock':'badge-blue',
    'No Demand':'badge-gray',
    'Pending':'badge-amber',
    'Approved':'badge-blue',
    'Shipped':'badge-teal',
    'Received':'badge-green',
    'Rejected':'badge-red',
    'Cancelled':'badge-gray'
  };
  return `<span class="badge ${map[status] || 'badge-gray'}">${status || '—'}</span>`;
}

function priorityBadge(priority) {
  const map = { Critical:'badge-red', High:'badge-amber', Normal:'badge-blue' };
  return `<span class="badge ${map[priority] || 'badge-gray'}">${priority || '—'}</span>`;
}

function n(value, digits = null) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(window.RetailFlowLanguage?.locale() || 'en-GB', {
    maximumFractionDigits: digits ?? 2,
    minimumFractionDigits: digits ?? 0
  });
}

// Always render DB timestamps in Saudi Arabia time (GMT+3),
// independent of browser/system timezone.
function formatSaudiDateTime(value) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(window.RetailFlowLanguage?.locale() || 'en-GB', {
    calendar: 'gregory',
    timeZone: SAUDI_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

function formatSaudiTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(window.RetailFlowLanguage?.locale() || 'en-GB', {
    timeZone: SAUDI_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

function showToast(message, type = 'ok') {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = `toast ${type === 'error' ? 'error' : ''} show`;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type':'application/json', ...(options.headers || {}) },
    ...options,
    credentials: 'same-origin'
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 428) window.RetailFlow?.lock();
    throw new Error(body.details || body.error || 'Request failed');
  }
  return body;
}

async function checkHealth() {
  try {
    await api('/api/health');
    document.querySelector('.live-dot').classList.add('ok');
    $('apiLabel').textContent = 'API connected';
  } catch {
    document.querySelector('.live-dot').classList.remove('ok');
    $('apiLabel').textContent = 'API unavailable';
  }
}

function setUpdated() {
  $('lastUpdated').textContent = `${formatSaudiTime()} KSA`;
}

let navigationReady = false;

function availableView(view) {
  const nav = [...document.querySelectorAll('.nav-item[data-view]')]
    .find(button => button.dataset.view === view);
  return !!nav && !nav.hidden && !!$(`view-${view}`);
}

function viewFromLocation() {
  const match = /^#\/([a-z]+)\/?$/.exec(window.location.hash);
  return match && availableView(match[1]) ? match[1] : 'dashboard';
}

function recordView(view, mode) {
  if (!navigationReady) return;
  const hash = `#/${view}`;
  if (mode === 'push' && window.location.hash === hash) return;
  const entry = { retailflowView: view };
  // Replaying Back/Forward must never add another history entry.
  if (mode === 'push') window.history.pushState(entry, '', hash);
  else window.history.replaceState(entry, '', hash);
}

function initializeNavigation() {
  navigationReady = true;
  window.history.scrollRestoration = 'manual';
  switchView(viewFromLocation(), true, 'replace');
}

function restoreNavigation() {
  if (!navigationReady || document.body.classList.contains('auth-locked')) return;
  const view = viewFromLocation();
  if (view !== state.currentView) switchView(view, true, 'restore');
  else if (window.location.hash !== `#/${view}`) recordView(view, 'replace');
}

window.addEventListener('popstate', restoreNavigation);
window.addEventListener('hashchange', restoreNavigation);

function switchView(view, resetScroll = false, historyMode = 'push') {
  if (!availableView(view)) view = 'dashboard';
  const viewChanged = state.currentView !== view;
  state.currentView = view;

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(v => v.classList.remove('active'));

  $(`view-${view}`).classList.add('active');
  document.querySelector(`.nav-item[data-view="${view}"]`).classList.add('active');

  const titles = {
    dashboard: 'Inventory Command Center',
    inventory: 'Inventory Health',
    transfers: 'Replenishment Workflow',
    warehouse: 'Central Warehouse',
    reports: 'Sales Reports',
    supply: 'Supply Planning',
    alerts: 'Stock & Transfer Alerts', performance: 'Operations Performance', accounts: 'Account Management'
  };

  $('pageTitle').textContent = titles[view];
  document.title = `${window.RetailFlowLanguage?.translate(titles[view]) || titles[view]} — مِداد | MEDAD`;
  recordView(view, historyMode);

  // Each section starts at its heading; sidebar scrolling remains independent.
  if (viewChanged || resetScroll) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

  if (view === 'dashboard') loadDashboard();
  if (view === 'inventory') loadInventory();
  if (view === 'transfers') loadTransfers();
  if (view === 'warehouse') loadWarehouse();
  if (view === 'reports') window.RetailFlowReports.load();
  if (view === 'supply') window.RetailFlowSupply.load();
  if (['alerts','performance','accounts'].includes(view)) window.RetailFlow.loadView(view);
}

function setTableLoading(id, colspan) {
  $(id).innerHTML = `<tr class="loading-row"><td colspan="${colspan}">Loading live data...</td></tr>`;
}

async function loadReferenceData() {
  const [branchesRes, productsRes] = await Promise.all([
    api('/api/branches'),
    api('/api/products')
  ]);

  state.branches = branchesRes.data;
  state.products = productsRes.data;
  state.categories = [...new Set(state.products.map(p => p.category))].sort();

  $('branchFilter').innerHTML =
    `<option value="All">All branches</option>` +
    state.branches.map(b => `<option value="${b.branch_id}">${b.branch_name}</option>`).join('');

  $('categoryFilter').innerHTML =
    `<option value="All">All categories</option>` +
    state.categories.map(c => `<option value="${c}">${c}</option>`).join('');

  $('transferBranch').innerHTML =
    state.branches.map(b => `<option value="${b.branch_id}">${b.branch_id} — ${b.branch_name}</option>`).join('');

  document.querySelectorAll('.transfer-item-product').forEach(select => {
  select.innerHTML =
    state.products
      .map(p =>
        `<option value="${p.product_id}">${p.product_id} — ${p.product_name}</option>`
      )
      .join('');

});
}

async function loadDashboard() {
  try {
    setTableLoading('criticalTable', 8);
    setTableLoading('recentDeliveriesTable', 5);

    const [dashboard, deliveries] = await Promise.all([
      api('/api/dashboard'),
      api('/api/deliveries/recent')
    ]);

    $('kpiBranches').textContent = n(dashboard.kpis.branches);
    $('kpiProducts').textContent = n(dashboard.kpis.products);
    $('kpiCritical').textContent = n(dashboard.kpis.critical_oos);
    $('kpiRisk').textContent = n(dashboard.kpis.risk_skus);
    $('kpiPending').textContent = n(dashboard.kpis.pending_transfers);

    renderHealth(dashboard.status_counts);
    renderBranchRisk(dashboard.branch_risk);

    $('criticalTable').innerHTML = dashboard.critical_items.map(r => `
      <tr>
        <td class="branch-cell"><strong>${r.branch_name}</strong><span>${r.branch_id}</span></td>
        <td class="product-cell"><strong>${r.product_name}</strong><span>${r.product_id}</span></td>
        <td>${r.category}</td>
        <td><strong>${WeightUI.quantity(r.current_stock, r)}</strong></td>
        <td>${r.days_of_cover == null ? '—' : n(r.days_of_cover, 1)}</td>
        <td>${statusBadge(r.stock_status)}</td>
        <td class="qty-suggest">${WeightUI.quantity(r.suggested_replenishment_qty, r)}</td>
        <td>
          <button class="action-link quick-transfer"
            data-branch="${r.branch_id}"
            data-product="${r.product_id}"
            data-qty="${r.suggested_replenishment_qty || 1}">
            Create transfer
          </button>
        </td>
      </tr>
    `).join('');

    $('recentDeliveriesTable').innerHTML = deliveries.data.length
      ? deliveries.data.map(r => `
          <tr>
            <td><strong>${r.request_id}</strong></td>
            <td class="branch-cell"><strong>${r.branch_name}</strong><span>${r.branch_id}</span></td>
            <td class="product-cell"><strong>${r.product_name}</strong><span>${r.product_id}</span></td>
            <td>${WeightUI.grouped(r.quantity_totals)}</td>
            <td><strong>${formatSaudiDateTime(r.delivered_at)}</strong></td>
          </tr>
        `).join('')
      : `<tr class="loading-row"><td colspan="5">No received deliveries yet.</td></tr>`;

    bindQuickTransferButtons();
    setUpdated();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderHealth(counts) {
  const order = ['Out of Stock','Critical','Low','Healthy','Overstock','No Demand'];
  const colors = {
    'Out of Stock':'#b34d4d',
    'Critical':'#9c3131',
    'Low':'#c7a65b',
    'Healthy':'#2d806a',
    'Overstock':'#386894',
    'No Demand':'#a6afbb'
  };

  const total = order.reduce((sum, key) => sum + (counts[key] || 0), 0);
  $('healthTotal').textContent = n(total);

  let cursor = 0;
  const stops = [];

  order.forEach(key => {
    const value = counts[key] || 0;
    const pct = total ? (value / total) * 100 : 0;
    if (pct > 0) {
      stops.push(`${colors[key]} ${cursor}% ${cursor + pct}%`);
      cursor += pct;
    }
  });

  $('healthDonut').style.background =
    `conic-gradient(${stops.join(', ') || '#e7edf4 0 100%'})`;

  $('healthLegend').innerHTML = order.map(key => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${colors[key]}"></span>
      <span>${key}</span>
      <strong>${n(counts[key] || 0)}</strong>
    </div>
  `).join('');
}

function renderBranchRisk(rows) {
  const max = Math.max(1, ...rows.map(r => r.total_risk));

  $('branchRiskBars').innerHTML = rows.map(r => `
    <div class="risk-row">
      <div class="risk-label" title="${r.branch_name}">${r.branch_name}</div>
      <div class="risk-track">
        <div class="risk-fill" style="width:${(r.total_risk / max) * 100}%"></div>
      </div>
      <div class="risk-value">${r.total_risk}</div>
    </div>
  `).join('');
}

async function loadInventory() {
  try {
    setTableLoading('inventoryTable', 11);

    const params = new URLSearchParams({
  page: state.inventoryPage,
  pageSize: 25,
  status: $('statusFilter').value,
  branch: $('branchFilter').value,
  branchSearch: $('branchSearch').value.trim(),
  category: $('categoryFilter').value,
  search: $('inventorySearch').value.trim()
});
    const data = await api(`/api/inventory?${params.toString()}`);
    state.inventoryTotalPages = data.totalPages;

    $('inventoryCount').textContent = `${n(data.count)} records`;
    $('pageInfo').textContent = `Page ${data.page} of ${data.totalPages}`;
    $('prevPage').disabled = data.page <= 1;
    $('nextPage').disabled = data.page >= data.totalPages;

    $('inventoryTable').innerHTML = data.data.map(r => `
      <tr>
        <td class="branch-cell"><strong>${r.branch_name}</strong><span>${r.branch_id}</span></td>
        <td class="product-cell">

  <button
    class="product-insights-link"
    data-branch="${r.branch_id}"
    data-product="${r.product_id}"
  >

    <strong>${r.product_name}</strong>
    <span>${r.product_id}</span>

  </button>

</td>
        <td>${r.category}</td>
        <td><strong>${WeightUI.quantity(r.current_stock, r)}</strong></td>
        <td>${WeightUI.quantity(r.last_30d_units, r)}</td>
        <td>${WeightUI.quantity(r.avg_daily_sales, r)}</td>
        <td>${r.days_of_cover == null ? '—' : n(r.days_of_cover, 1)}</td>
        <td>${WeightUI.quantity(r.reorder_point, r)}</td>
        <td>${statusBadge(r.stock_status)}</td>
        <td class="qty-suggest">${WeightUI.quantity(r.suggested_replenishment_qty, r)}</td>
        <td>
          ${Number(r.suggested_replenishment_qty) > 0
            ? `<button class="action-link quick-transfer"
                data-branch="${r.branch_id}"
                data-product="${r.product_id}"
                data-qty="${r.suggested_replenishment_qty}">
                Transfer
              </button>`
            : '—'}
        </td>
      </tr>
    `).join('');

    bindQuickTransferButtons();
bindProductInsightButtons();
setUpdated();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function loadTransfers() {
  try {
    setTableLoading('transfersTable', 9);

    const status = $('transferStatusFilter').value;
    const data = await api(`/api/transfers?status=${encodeURIComponent(status)}`);

    $('transfersTable').innerHTML = data.data.map(r => `
      <tr>
        <td><strong>${r.request_id}</strong></td>
        <td>${r.request_date || '—'}</td>
        <td>${r.branch_id}<span class="route-note">${r.transfer_type === 'Branch Transfer' ? 'From ' + r.source_branch_id : 'From warehouse'}</span>${r.route_block_reason ? `<span class="route-note">${r.route_block_reason}</span>` : ''}</td>
       <td><strong>${n(r.item_count)}</strong> Items</td>
<td><strong>${WeightUI.grouped(r.quantity_totals)}</strong></td>
        <td>${priorityBadge(r.priority)}</td>
        <td>
          <select class="status-select transfer-status" data-id="${r.request_id}" data-current="${r.status}" ${r.allowed_statuses?.length ? '' : 'disabled'}>
            ${[r.status, ...(r.allowed_statuses || [])]
              .map(s => `<option ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </td>
        <td>${r.last_updated || '—'}</td>
        <td><button class="action-link details-btn" data-id="${r.request_id}">View details</button></td>
      </tr>
    `).join('');

    document.querySelectorAll('.transfer-status').forEach(select => {
      select.addEventListener('change', async () => {
        try {
          await api(`/api/transfers/${select.dataset.id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: select.value })
          });

          showToast(`${select.dataset.id} updated to ${select.value}`);

          await Promise.all([
            loadTransfers(),
            loadDashboard(),
            loadWarehouse()
          ]);
        } catch (error) {
          showToast(error.message, 'error');
          await loadTransfers();
        }
      });
    });

   document.querySelectorAll('.details-btn').forEach(btn => {
  btn.addEventListener('click', () => openTransferDetails(btn.dataset.id));
});

    setUpdated();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function openTransferDetails(requestId) {

  $('historyTitle').textContent =
    `${requestId} — Transfer Details`;

  $('historyTimeline').innerHTML =
    `<div class="empty-state">Loading transfer details...</div>`;

  $('historyModal').classList.add('open');

  try {

    const data =
      await api(`/api/transfers/${requestId}/details`);


    const itemsHtml = data.items.map(item => `
      <tr>
        <td class="product-cell">
          <strong>${item.product_name}</strong>
          <span>${item.product_id}</span>
        </td>

        <td>${item.category}</td>

        <td>
          <strong>${WeightUI.quantity(item.requested_qty, item)}</strong>
        </td>
      </tr>
    `).join('');


    const timelineHtml = data.history.map((h, index) => `
      <div class="timeline-item">

        <div class="timeline-dot">
          ${index + 1}
        </div>

        <div class="timeline-content">

          <div class="timeline-status">
            ${h.status}
          </div>

          <div class="timeline-time">
            ${formatSaudiDateTime(h.changed_at)}
          </div>

        </div>

      </div>
    `).join('');


    $('historyTimeline').innerHTML = `

      <div style="
        display:grid;
        grid-template-columns:repeat(4,1fr);
        gap:10px;
        margin-bottom:20px;
      ">

        <div class="kpi-card">
          <div class="kpi-label">Branch</div>
          <div style="font-weight:800;margin-top:6px;">
            ${data.request.branch_id}
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Status</div>
          <div style="margin-top:6px;">
            ${statusBadge(data.request.status)}
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Items</div>
          <div style="font-weight:800;margin-top:6px;">
            ${n(data.item_count)}
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Total Quantities</div>
          <div style="font-weight:800;margin-top:6px;">
            ${WeightUI.grouped(data.quantity_totals)}
          </div>
        </div>

      </div>


      <h3 style="margin-bottom:10px;">
        Products
      </h3>

      <div class="table-wrap">

        <table>

          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Qty</th>
            </tr>
          </thead>

          <tbody>
            ${itemsHtml}
          </tbody>

        </table>

      </div>


      <h3 style="margin-top:22px;margin-bottom:12px;">
        Status Timeline
      </h3>

      <div class="timeline">
        ${timelineHtml}
      </div>

    `;

  } catch (error) {

    $('historyTimeline').innerHTML =
      `<div class="empty-state">${error.message}</div>`;

  }
}
async function loadWarehouse() {
  try {
    setTableLoading('warehouseTable', 6);

    const data = await api('/api/warehouse');

    $('warehouseTable').innerHTML = data.data.map(r => `
      <tr>
        <td class="product-cell"><strong>${r.product_name}</strong><span>${r.product_id}</span></td>
        <td>${r.category}</td>
        <td>${WeightUI.quantity(r.current_stock, r)}</td>
        <td>${WeightUI.quantity(r.reserved_stock, r)}</td>
        <td><strong>${WeightUI.quantity(r.available_stock, r)}</strong></td>
        <td>${statusBadge(r.warehouse_status)}</td>
      </tr>
    `).join('');

    setUpdated();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function updateTransferSummary() {
  const rows =
    document.querySelectorAll('.transfer-item-row');

  let totalUnits = 0;

  rows.forEach(row => {
    const qty =
      Number(
        row.querySelector('.transfer-item-qty')?.value
      ) || 0;

    totalUnits += qty;
  });

  $('transferItemCount').textContent = rows.length;
  WeightUI.draftTotals();
}


function addTransferItem() {

  const row = document.createElement('div');

  row.className = 'transfer-item-row';

  row.innerHTML = `
    <label>
      Product

      <select
        class="control transfer-item-product"
        required
      >
        ${state.products
          .map(
            p =>
              `<option value="${p.product_id}">
                ${p.product_id} — ${p.product_name}
              </option>`
          )
          .join('')}
      </select>
    </label>

    <label>
      <span class="transfer-unit-label">Quantity</span>

      <input
        type="number"
        class="control transfer-item-qty"
        min="1"
        value="1"
        required
      >
    </label>

    <button
      type="button"
      class="remove-transfer-item"
      title="Remove item"
    >
      ×
    </button>
  `;


  $('transferItems').appendChild(row);
  WeightUI.configureRow(row);
  row.querySelector('.transfer-item-product').addEventListener('change',()=>{WeightUI.configureRow(row);updateTransferSummary();});


  row
    .querySelector('.transfer-item-qty')
    .addEventListener(
      'input',
      updateTransferSummary
    );


  row
    .querySelector('.remove-transfer-item')
    .addEventListener('click', () => {

      row.remove();

      updateTransferSummary();

    });


  updateTransferSummary();
}


$('addTransferItem').addEventListener(
  'click',
  addTransferItem
);


$('transferItems').addEventListener(
  'input',
  updateTransferSummary
);


$('transferItems').addEventListener(
  'click',
  e => {

    if (
      e.target.classList.contains(
        'remove-transfer-item'
      )
    ) {

      const rows =
        document.querySelectorAll(
          '.transfer-item-row'
        );

      if (rows.length > 1) {

        e.target
          .closest('.transfer-item-row')
          .remove();

        updateTransferSummary();

      }
    }

  }
);
function openTransferModal(branch = '', product = '', qty = '') {

  if (!window.RetailFlow.canCreate()) return showToast('Your role cannot create this transfer.', 'error');
  window.RetailFlow.prepareTransfer(branch);

  // Clear old items
  $('transferItems').innerHTML = '';

  // Create first item row
  addTransferItem();


  // Set branch if opened from a quick transfer
  if (branch) {
    $('transferBranch').value = branch;
  }


  const productSelect =
    document.querySelector('.transfer-item-product');

  const qtyInput =
    document.querySelector('.transfer-item-qty');


  // Set product if opened from inventory
  if (product && productSelect) {
    productSelect.value = product;
  }


  // Set suggested quantity
  if (qtyInput) {
    qtyInput.value = qty || 1;
  }


  updateTransferSummary();

  if(productSelect)WeightUI.configureRow(productSelect.closest('.transfer-item-row'));
  $('transferModal').classList.add('open');
}

  

function closeTransferModal() {
  $('transferModal').classList.remove('open');
}

function bindQuickTransferButtons() {
  document.querySelectorAll('.quick-transfer').forEach(btn => {
    btn.disabled = !window.RetailFlow.canCreate(btn.dataset.branch);
    btn.addEventListener('click', () => {
      openTransferModal(
        btn.dataset.branch,
        btn.dataset.product,
        btn.dataset.qty
      );
    });
  });
}

async function openProductInsights(branchId, productId) {

  $('productInsightsTitle').textContent = 'Product Insights';

  $('productInsightsSubtitle').textContent =
    `${branchId} • ${productId}`;

  $('productInsightsContent').innerHTML =
    `<div class="empty-state">Loading product insights...</div>`;

  $('productInsightsModal').classList.add('open');


  try {

    const [data, recommendation, weightInfo] = await Promise.all([
      api(`/api/products/${branchId}/${productId}/insights`),
      api(`/api/operations/recommendations/${branchId}/${productId}`),
      api(`/api/products/${productId}/weight-options`)
    ]);


    function uplift(value) {

      if (value === null || value === undefined) {
        return '—';
      }

      const number = Number(value);

      return `${number >= 0 ? '+' : ''}${number}%`;
    }


    $('productInsightsTitle').textContent =
      data.product.product_name;

    $('productInsightsSubtitle').textContent =
      `${data.branch.branch_name} • ${data.product.category} • ${WeightUI.unit(data.product.unit_code)}`;


    $('productInsightsContent').innerHTML = `

      ${WeightUI.optionsMarkup(weightInfo)}
      ${window.RetailFlow.recommendationMarkup(recommendation, branchId, productId)}
      <h3>Current Inventory</h3>

      <div class="kpi-grid">

        <div class="kpi-card">
          <div class="kpi-label">Current Stock</div>
          <div class="kpi-value">
            ${n(data.current_inventory.current_stock)}
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Available Stock</div>
          <div class="kpi-value">
            ${n(data.current_inventory.available_stock)}
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Safety Stock</div>
          <div class="kpi-value">
            ${n(data.current_inventory.safety_stock)}
          </div>
        </div>

      </div>


      <h3 style="margin-top:22px;">
        Historical Sales
      </h3>

      <div class="kpi-grid">

        <div class="kpi-card">
          <div class="kpi-label">Last 30 Days</div>
          <div class="kpi-value">
            ${n(data.recent_sales.last_30d_units)}
          </div>
          <div class="kpi-foot">Units sold</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Avg Daily — 30D</div>
          <div class="kpi-value">
            ${n(data.recent_sales.avg_daily_30d, 2)}
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Last 12 Months</div>
          <div class="kpi-value">
            ${n(data.recent_sales.last_365d_units)}
          </div>
          <div class="kpi-foot">Units sold</div>
        </div>

      </div>


      <h3 style="margin-top:22px;">
        Seasonal Performance
      </h3>

      <div class="table-wrap">

        <table>

          <thead>
            <tr>
              <th>Season</th>
              <th>Units Sold</th>
              <th>Avg / Day</th>
              <th>Vs Normal</th>
            </tr>
          </thead>

          <tbody>

            <tr>
              <td><strong>Normal Period</strong></td>
              <td>${n(data.seasonal_sales.normal.units)}</td>
              <td>${n(data.seasonal_sales.normal.avg_daily, 2)}</td>
              <td>Baseline</td>
            </tr>

            <tr>
              <td><strong>Ramadan</strong></td>
              <td>${n(data.seasonal_sales.ramadan.units)}</td>
              <td>${n(data.seasonal_sales.ramadan.avg_daily, 2)}</td>
              <td>
                ${uplift(data.seasonal_sales.ramadan.uplift_vs_normal)}
              </td>
            </tr>

            <tr>
              <td><strong>Ramadan Peak</strong></td>
              <td>${n(data.seasonal_sales.ramadan_peak.units)}</td>
              <td>${n(data.seasonal_sales.ramadan_peak.avg_daily, 2)}</td>
              <td>
                ${uplift(data.seasonal_sales.ramadan_peak.uplift_vs_normal)}
              </td>
            </tr>

            <tr>
              <td><strong>Eid Al-Fitr</strong></td>
              <td>${n(data.seasonal_sales.eid_fitr.units)}</td>
              <td>${n(data.seasonal_sales.eid_fitr.avg_daily, 2)}</td>
              <td>
                ${uplift(data.seasonal_sales.eid_fitr.uplift_vs_normal)}
              </td>
            </tr>

            <tr>
              <td><strong>Eid Al-Adha</strong></td>
              <td>${n(data.seasonal_sales.eid_adha.units)}</td>
              <td>${n(data.seasonal_sales.eid_adha.avg_daily, 2)}</td>
              <td>
                ${uplift(data.seasonal_sales.eid_adha.uplift_vs_normal)}
              </td>
            </tr>

          </tbody>

        </table>

      </div>


      <h3 style="margin-top:22px;">
        Promotion Performance
      </h3>

      <div class="kpi-grid">

        <div class="kpi-card">
          <div class="kpi-label">Promotion Sales</div>
          <div class="kpi-value">
            ${n(data.promotions.units)}
          </div>
          <div class="kpi-foot">Units sold</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Promotion Days</div>
          <div class="kpi-value">
            ${n(data.promotions.days)}
          </div>
        </div>

      </div>

      <p class="panel-sub" style="margin-top:18px;">
        Sales history through ${data.data_through}
      </p>

    `;


    window.RetailFlow.bindRecommendation(recommendation, branchId, productId);

  } catch (error) {

    $('productInsightsContent').innerHTML =
      `<div class="empty-state">${error.message}</div>`;

  }

}
function bindProductInsightButtons() {

  document
    .querySelectorAll('.product-insights-link')
    .forEach(btn => {

      btn.addEventListener('click', () => {

        openProductInsights(
          btn.dataset.branch,
          btn.dataset.product
        );

      });

    });

}
function debounce(fn, delay = 350) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view, true));
});

document.querySelectorAll('[data-goto]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.goto, true));
});

$('refreshBtn').addEventListener('click', async () => {
  if (state.currentView === 'dashboard') await loadDashboard();
  if (state.currentView === 'inventory') await loadInventory();
  if (state.currentView === 'transfers') await loadTransfers();
  if (state.currentView === 'warehouse') await loadWarehouse();
  if (state.currentView === 'reports') await window.RetailFlowReports.load(true);
  if (state.currentView === 'supply') await window.RetailFlowSupply.load();
  if (['alerts','performance','accounts'].includes(state.currentView)) await window.RetailFlow.loadView(state.currentView);
  showToast('Data refreshed');
});

$('newTransferBtn').addEventListener('click', () => openTransferModal());

$('closeModal').addEventListener('click', closeTransferModal);
$('cancelModal').addEventListener('click', closeTransferModal);

$('transferModal').addEventListener('click', e => {
  if (e.target === $('transferModal')) closeTransferModal();
});

$('closeHistoryModal').addEventListener('click', () => {
  $('historyModal').classList.remove('open');
});

$('historyModal').addEventListener('click', e => {
  if (e.target === $('historyModal')) {
    $('historyModal').classList.remove('open');
  }
});

$('closeProductInsights').addEventListener('click', () => {
  $('productInsightsModal').classList.remove('open');
});


$('productInsightsModal').addEventListener('click', e => {

  if (e.target === $('productInsightsModal')) {
    $('productInsightsModal').classList.remove('open');
  }

});

$('transferForm').addEventListener('submit', async e => {
  e.preventDefault();
  const submitButton = e.currentTarget.querySelector('[type=submit]');
  if (submitButton.disabled) return;
  submitButton.disabled = true;

  try {

    const itemRows = [
      ...document.querySelectorAll('.transfer-item-row')
    ];

    const items = itemRows.map(row => ({
      product_id:
        row.querySelector('.transfer-item-product').value,

      requested_qty:
        Number(
          row.querySelector('.transfer-item-qty').value
        )
    }));

    const result = await api('/api/transfers', {
      method: 'POST',

      body: JSON.stringify({
        branch_id: $('transferBranch').value,
        priority: $('transferPriority').value,
        transfer_type: $('transferType').value,
        source_branch_id: $('transferType').value === 'Branch Transfer' ? $('transferSource').value : null,
        items: items
      })
    });


    closeTransferModal();

    showToast(
      `${result.request.request_id} created`
    );


    await Promise.all([
      loadDashboard(),
      loadTransfers(),
      window.RetailFlow.loadView('alerts')
    ]);

  } catch (error) {

    showToast(
      error.message,
      'error'
    );

  } finally {
    submitButton.disabled = false;
  }
});
['branchFilter','categoryFilter','statusFilter'].forEach(id => {
  $(id).addEventListener('change', () => {
    state.inventoryPage = 1;
    loadInventory();
  });
});

$('inventorySearch').addEventListener('input', debounce(() => {
  state.inventoryPage = 1;
  loadInventory();
}));

$('branchSearch').addEventListener('input', debounce(() => {
  state.inventoryPage = 1;
  loadInventory();
}));

$('prevPage').addEventListener('click', () => {
  if (state.inventoryPage > 1) {
    state.inventoryPage -= 1;
    loadInventory();
  }
});

$('nextPage').addEventListener('click', () => {
  if (state.inventoryPage < state.inventoryTotalPages) {
    state.inventoryPage += 1;
    loadInventory();
  }
});

$('transferStatusFilter').addEventListener('change', loadTransfers);

window.addEventListener('retailflow:language', () => {
  if (document.body.classList.contains('auth-locked')) return;
  checkHealth();setUpdated();
  switchView(state.currentView);
});

document.addEventListener('DOMContentLoaded', async function init() {
  try {
    if (!await window.RetailFlow.start()) return;
    await checkHealth();
    await loadReferenceData();
    initializeNavigation();
    await window.RetailFlow.loadView('alerts');
  } catch (error) {
    showToast(error.message, 'error');
  }
});
