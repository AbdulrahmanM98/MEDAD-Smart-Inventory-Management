require('dotenv').config({ path: process.env.RETAILFLOW_ENV_FILE || require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const validStatuses = ['Pending', 'Approved', 'Shipped', 'Received', 'Rejected', 'Cancelled'];
const validPriorities = ['Normal', 'High', 'Critical'];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchAll(table, columns = '*', filters = null) {
  const pageSize = 1000;
  let from = 0;
  let rows = [];

  while (true) {
    let query = supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (filters) query = filters(query);

    const { data, error } = await query;
    if (error) throw error;

    rows = rows.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

const measurements = require('./lib/measurements')(supabase);
require('./lib/operations')(app, { db: supabase, fetchAll, measurements });
require('./lib/reports')(app, { db: supabase, fetchAll, measurements });
require('./lib/supply')(app, { fetchAll });

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'RetailFlow API', time: new Date().toISOString() });
});

app.get('/api/branches', async (req, res) => {
  try {
    const { data, error } = await supabase.from('branches').select('*').order('branch_id');
    if (error) throw error;
    res.json({ count: data.length, data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load branches', details: error.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').order('product_id');
    if (error) throw error;
    res.json({ count: data.length, data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load products', details: error.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const [inventory, transfers, branches, products] = await Promise.all([
      fetchAll('inventory_health', 'branch_id,branch_name,product_id,product_name,category,current_stock,last_30d_units,avg_daily_sales,days_of_cover,reorder_point,stock_status,suggested_replenishment_qty'),
      fetchAll('transfer_requests', '*'),
      fetchAll('branches', 'branch_id'),
      fetchAll('products', 'product_id')
    ]);

    const statusCounts = {};
    inventory.forEach(row => {
      statusCounts[row.stock_status] = (statusCounts[row.stock_status] || 0) + 1;
    });

    const riskStatuses = new Set(['Out of Stock', 'Critical', 'Low']);
    const criticalStatuses = new Set(['Out of Stock', 'Critical']);

    const branchRiskMap = {};
    inventory.forEach(row => {
      if (!riskStatuses.has(row.stock_status)) return;
      if (!branchRiskMap[row.branch_id]) {
        branchRiskMap[row.branch_id] = {
          branch_id: row.branch_id,
          branch_name: row.branch_name,
          critical: 0,
          low: 0,
          total_risk: 0
        };
      }
      if (criticalStatuses.has(row.stock_status)) branchRiskMap[row.branch_id].critical += 1;
      if (row.stock_status === 'Low') branchRiskMap[row.branch_id].low += 1;
      branchRiskMap[row.branch_id].total_risk += 1;
    });

    const branchRisk = Object.values(branchRiskMap)
      .sort((a, b) => b.critical - a.critical || b.total_risk - a.total_risk)
      .slice(0, 8);

    const criticalItems = inventory
      .filter(row => criticalStatuses.has(row.stock_status))
      .sort((a, b) => {
        if (a.stock_status === 'Out of Stock' && b.stock_status !== 'Out of Stock') return -1;
        if (b.stock_status === 'Out of Stock' && a.stock_status !== 'Out of Stock') return 1;
        const ad = a.days_of_cover == null ? 999 : Number(a.days_of_cover);
        const bd = b.days_of_cover == null ? 999 : Number(b.days_of_cover);
        return ad - bd;
      })
      .slice(0, 10);

    const recentTransfers = transfers
      .sort((a, b) => String(b.request_date).localeCompare(String(a.request_date)))
      .slice(0, 8);

    res.json({
      kpis: {
        branches: branches.length,
        products: products.length,
        risk_skus: inventory.filter(r => riskStatuses.has(r.stock_status)).length,
        critical_oos: inventory.filter(r => criticalStatuses.has(r.stock_status)).length,
        pending_transfers: transfers.filter(r => r.status === 'Pending').length
      },
      status_counts: statusCounts,
      branch_risk: branchRisk,
      critical_items: criticalItems,
      recent_transfers: recentTransfers
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load dashboard', details: error.message });
  }
});

app.get('/api/inventory', async (req, res) => {
  try {
    const {
  status,
  branch,
  branchSearch,
  category,
  search,
  page = '1',
  pageSize = '25'
} = req.query;

    const p = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(10, Number(pageSize) || 25));
    const from = (p - 1) * size;
    const to = from + size - 1;

    let query = supabase
      .from('inventory_health')
      .select('*', { count: 'exact' });

    if (status && status !== 'All') query = query.eq('stock_status', status);
    if (branch && branch !== 'All') query = query.eq('branch_id', branch);
if (branchSearch) {
  query = query.ilike('branch_name', `%${branchSearch}%`);
}
    if (category && category !== 'All') query = query.eq('category', category);
    if (search) query = query.ilike('product_name', `%${search}%`);

    query = query
      .order('current_stock', { ascending: true })
      .range(from, to);

    const { data, count, error } = await query;
    if (error) throw error;

    res.json({
      page: p,
      pageSize: size,
      count: count || 0,
      totalPages: Math.max(1, Math.ceil((count || 0) / size)),
      data
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load inventory', details: error.message });
  }
});

app.get('/api/products/:branchId/:productId/insights', async (req, res) => {
  try {

    const {
      branchId,
      productId
    } = req.params;


    // Historical sales insights
    const {
      data: insights,
      error: insightsError
    } = await supabase

      .from('product_sales_insights')

      .select('*')

      .eq('branch_id', branchId)

      .eq('product_id', productId)

      .single();


    if (insightsError) {
      throw insightsError;
    }


    // Current inventory
    const {
      data: inventory,
      error: inventoryError
    } = await supabase

      .from('branch_inventory')

      .select(
        'current_stock, reserved_stock, safety_stock, snapshot_date'
      )

      .eq('branch_id', branchId)

      .eq('product_id', productId)

      .single();


    if (inventoryError) {
      throw inventoryError;
    }


    const normalAvg =
      Number(insights.normal_avg_daily || 0);


    function upliftPercent(seasonAvg) {

      const seasonal =
        Number(seasonAvg || 0);

      if (!normalAvg) return null;

      return Math.round(
        ((seasonal - normalAvg) / normalAvg) * 100
      );
    }


    res.json({

      product: {
        product_id: insights.product_id,
        product_name: insights.product_name,
        category: insights.category
      },

      branch: {
        branch_id: insights.branch_id,
        branch_name: insights.branch_name
      },

      current_inventory: {

        current_stock:
          inventory.current_stock,

        reserved_stock:
          inventory.reserved_stock,

        available_stock:
          inventory.current_stock -
          inventory.reserved_stock,

        safety_stock:
          inventory.safety_stock

      },


      recent_sales: {

        last_30d_units:
          insights.last_30d_units,

        avg_daily_30d:
          insights.avg_daily_30d,

        last_365d_units:
          insights.last_365d_units,

        total_history_units:
          insights.total_history_units

      },


      seasonal_sales: {

        normal: {
          units:
            insights.normal_units,

          avg_daily:
            insights.normal_avg_daily
        },

        ramadan: {
          units:
            insights.ramadan_units,

          avg_daily:
            insights.ramadan_avg_daily,

          uplift_vs_normal:
            upliftPercent(
              insights.ramadan_avg_daily
            )
        },

        ramadan_peak: {
          units:
            insights.ramadan_peak_units,

          avg_daily:
            insights.ramadan_peak_avg_daily,

          uplift_vs_normal:
            upliftPercent(
              insights.ramadan_peak_avg_daily
            )
        },

        eid_fitr: {
          units:
            insights.eid_fitr_units,

          avg_daily:
            insights.eid_fitr_avg_daily,

          uplift_vs_normal:
            upliftPercent(
              insights.eid_fitr_avg_daily
            )
        },

        eid_adha: {
          units:
            insights.eid_adha_units,

          avg_daily:
            insights.eid_adha_avg_daily,

          uplift_vs_normal:
            upliftPercent(
              insights.eid_adha_avg_daily
            )
        }

      },


      promotions: {

        units:
          insights.promotion_units,

        days:
          insights.promotion_days

      },

      data_through:
        insights.data_through

    });


  } catch (error) {

    res.status(500).json({

      error:
        'Failed to load product insights',

      details:
        error.message

    });

  }
});

app.get('/api/inventory/critical', async (req, res) => {
  try {
    const rows = await fetchAll(
      'inventory_health',
      '*',
      q => q.in('stock_status', ['Critical', 'Out of Stock'])
    );

    rows.sort((a, b) => {
      if (a.stock_status === 'Out of Stock' && b.stock_status !== 'Out of Stock') return -1;
      if (b.stock_status === 'Out of Stock' && a.stock_status !== 'Out of Stock') return 1;
      const ad = a.days_of_cover == null ? 999 : Number(a.days_of_cover);
      const bd = b.days_of_cover == null ? 999 : Number(b.days_of_cover);
      return ad - bd;
    });

    res.json({ count: rows.length, data: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load critical inventory', details: error.message });
  }
});

app.get('/api/warehouse', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('warehouse_health')
      .select('*')
      .order('available_stock', { ascending: true });

    if (error) throw error;
    res.json({ count: data.length, data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load warehouse inventory', details: error.message });
  }
});

// Transfer status history
app.get('/api/transfers/:id/history', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transfer_status_history')
      .select('*')
      .eq('request_id', req.params.id)
      .order('changed_at', { ascending: true });

    if (error) throw error;

    res.json({
      count: data.length,
      data
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to load transfer history',
      details: error.message
    });
  }
});

app.get('/api/transfers/:id/details', async (req, res) => {
  try {
    const requestId = req.params.id;

    const { data: request, error: requestError } = await supabase
      .from('transfer_requests')
      .select('*')
      .eq('request_id', requestId)
      .single();

    if (requestError) throw requestError;

    const { data: items, error: itemsError } = await supabase
      .from('transfer_request_items')
      .select('*')
      .eq('request_id', requestId)
      .order('item_id');

    if (itemsError) throw itemsError;

    const productIds = items.map(item => item.product_id);

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('product_id, product_name, category')
      .in('product_id', productIds);

    if (productsError) throw productsError;

    const { data: history, error: historyError } = await supabase
      .from('transfer_status_history')
      .select('*')
      .eq('request_id', requestId)
      .order('changed_at', { ascending: true });

    if (historyError) throw historyError;

    const productMap = Object.fromEntries(
      products.map(product => [product.product_id, product])
    );

    const detailedItems = items.map(item => ({
      ...item,
      product_name: productMap[item.product_id]?.product_name,
      category: productMap[item.product_id]?.category
    }));

    res.json({
      request,

      item_count: items.length,

      total_units: items.reduce(
        (sum, item) => sum + Number(item.requested_qty),
        0
      ),

      items: detailedItems,

      history
    });

  } catch (error) {
    res.status(500).json({
      error: 'Failed to load transfer details',
      details: error.message
    });
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  if (status >= 500) console.error('RetailFlow request error:', error.message);
  res.status(status).json({ error: status >= 500 && status !== 503 ? 'Service unavailable. Check the server configuration.' : error.message });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, process.env.RETAILFLOW_HOST || '127.0.0.1', () => {
  console.log(`RetailFlow running on http://localhost:${PORT}`);
});
