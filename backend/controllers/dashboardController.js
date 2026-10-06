const db = require('../config/database');
const { getSummary, lowStockRows } = require('../services/inventoryService');
const { expiryStatusSql } = require('../utils/expiry');

const rows = async (sql, params = []) => (await db.execute(sql, params))[0];
const n = (v) => Number(v || 0);
const two = (v) => Number(v || 0).toFixed(2);

// Sales = every order that has not been cancelled (stock is committed when an order is placed).
const SALES_OK = "order_status <> 'Cancelled'";

exports.summary = async (req, res, next) => {
  try {
    const [[meds], [cust], [ord], [sup], [pend], [draft], [sales], recentOrders, recentPurchases, expiring, inv] = await Promise.all([
      rows("SELECT COUNT(*) total, SUM(status = 'active') active FROM medicines"),
      rows("SELECT COUNT(*) total FROM users WHERE role = 'customer'"),
      rows('SELECT COUNT(*) total FROM orders'),
      rows("SELECT COUNT(*) total FROM suppliers WHERE status = 'active'"),
      rows("SELECT COUNT(*) total FROM orders WHERE order_status = 'Pending'"),
      rows("SELECT COUNT(*) total FROM purchases WHERE status = 'Draft'"),
      rows(`SELECT
          COALESCE(SUM(CASE WHEN DATE(order_date) = CURDATE() THEN total_amount END),0) today_amount, COUNT(CASE WHEN DATE(order_date) = CURDATE() THEN 1 END) today_orders,
          COALESCE(SUM(CASE WHEN order_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) THEN total_amount END),0) week_amount, COUNT(CASE WHEN order_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) THEN 1 END) week_orders,
          COALESCE(SUM(CASE WHEN order_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN total_amount END),0) month_amount, COUNT(CASE WHEN order_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN 1 END) month_orders,
          COALESCE(SUM(total_amount),0) all_amount, COUNT(*) all_orders FROM orders WHERE ${SALES_OK}`),
      rows(`SELECT o.order_id, o.order_date, o.total_amount, o.order_status, u.name AS customer_name FROM orders o JOIN users u ON u.user_id = o.customer_id ORDER BY o.order_id DESC LIMIT 5`),
      rows(`SELECT p.purchase_id, p.purchase_date, p.total_amount, p.status, s.supplier_name FROM purchases p JOIN suppliers s ON s.supplier_id = p.supplier_id ORDER BY p.purchase_id DESC LIMIT 5`),
      rows(`SELECT m.name, m.strength, b.batch_number, b.expiry_date, b.quantity, DATEDIFF(b.expiry_date, CURDATE()) AS days_to_expiry, ${expiryStatusSql('b.expiry_date')} AS expiry_status
            FROM medicine_batches b JOIN medicines m ON m.medicine_id = b.medicine_id WHERE b.quantity > 0 AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) ORDER BY b.expiry_date LIMIT 5`),
      getSummary()
    ]);
    const lowList = (await lowStockRows()).slice(0, 5);
    const avg = (amt, c) => (c ? two(n(amt) / n(c)) : '0.00');
    res.json({ success: true, data: {
      cards: { total_medicines: n(meds.total), active_medicines: n(meds.active), total_customers: n(cust.total), total_orders: n(ord.total), todays_sales: two(sales.today_amount), todays_orders: n(sales.today_orders),
        low_stock: inv.low_stock_medicines, out_of_stock: inv.out_of_stock_medicines, expiring_soon: inv.expiring_30, expired: inv.expired_batches, total_suppliers: n(sup.total), pending_orders: n(pend.total), draft_purchases: n(draft.total) },
      sales: { today: { amount: two(sales.today_amount), orders: n(sales.today_orders) }, last_7_days: { amount: two(sales.week_amount), orders: n(sales.week_orders) },
        this_month: { amount: two(sales.month_amount), orders: n(sales.month_orders), average_order: avg(sales.month_amount, sales.month_orders) }, all_time: { amount: two(sales.all_amount), orders: n(sales.all_orders) } },
      inventory: { sellable_units: inv.sellable_units, stock_value: two(inv.stock_value), expired_units: inv.expired_units, expired_value: two(inv.expired_value), expiring_30: inv.expiring_30, expiring_60: inv.expiring_60, expiring_90: inv.expiring_90 },
      recent_orders: recentOrders, recent_purchases: recentPurchases, low_stock_list: lowList, expiring_list: expiring.map(r => ({ ...r, quantity: n(r.quantity), days_to_expiry: n(r.days_to_expiry) }))
    } });
  } catch (e) { next(e); }
};

// Date helpers: the DB decides what "today" is so charts line up with every CURDATE() in the SQL.
const addDays = (iso, d) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const addMonths = (ym, d) => { const [y, m] = ym.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + d, 1)); return t.toISOString().slice(0, 7); };

exports.sales = async (req, res, next) => {
  try {
    const monthly = req.query.period === 'monthly';
    const span = monthly ? Math.min(Math.max(parseInt(req.query.months, 10) || 12, 3), 24) : Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 90); // validated ints: safe to inline
    const [{ today }] = await rows('SELECT CURDATE() AS today');
    const start = monthly ? `DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL ${span - 1} MONTH)` : `DATE_SUB(CURDATE(), INTERVAL ${span - 1} DAY)`;
    const keyExpr = monthly ? "DATE_FORMAT(order_date, '%Y-%m')" : 'DATE(order_date)';
    const [data, top] = await Promise.all([
      rows(`SELECT ${keyExpr} AS k, SUM(total_amount) AS revenue, COUNT(*) AS orders FROM orders WHERE ${SALES_OK} AND order_date >= ${start} GROUP BY k`),
      rows(`SELECT m.medicine_id, m.name, m.strength, SUM(oi.quantity) AS units, SUM(oi.subtotal) AS revenue FROM order_items oi JOIN orders o ON o.order_id = oi.order_id
            JOIN medicines m ON m.medicine_id = oi.medicine_id WHERE o.${SALES_OK} AND o.order_date >= ${start} GROUP BY m.medicine_id ORDER BY units DESC, revenue DESC LIMIT 5`)
    ]);
    const byKey = new Map(data.map(r => [r.k, r]));
    const series = [];
    for (let i = span - 1; i >= 0; i--) { // zero-filled so quiet days/months still appear on the chart
      const k = monthly ? addMonths(today.slice(0, 7), -i) : addDays(today, -i), r = byKey.get(k);
      series.push({ period: k, revenue: two(r && r.revenue), orders: n(r && r.orders) });
    }
    res.json({ success: true, data: { period: monthly ? 'monthly' : 'daily', span, series,
      total_revenue: two(series.reduce((a, s) => a + Math.round(Number(s.revenue) * 100), 0) / 100), total_orders: series.reduce((a, s) => a + s.orders, 0),
      top_medicines: top.map(t => ({ ...t, units: n(t.units), revenue: two(t.revenue) })) } });
  } catch (e) { next(e); }
};

exports.inventory = async (req, res, next) => {
  try {
    const [categories, status, summary] = await Promise.all([
      rows("SELECT COALESCE(c.category_name, 'Uncategorised') AS name, COUNT(*) AS count FROM medicines m LEFT JOIN categories c ON c.category_id = m.category_id WHERE m.status = 'active' GROUP BY name ORDER BY count DESC, name"),
      // every batch lands in exactly one bucket, so the chart adds up to the number of batches
      rows(`SELECT bucket AS name, COUNT(*) AS count FROM (SELECT CASE WHEN quantity = 0 THEN 'Out of stock' WHEN expiry_date < CURDATE() THEN 'Expired' WHEN quantity <= reorder_level THEN 'Low stock'
              WHEN expiry_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY) THEN 'Expiring soon' ELSE 'Healthy' END AS bucket FROM medicine_batches) t GROUP BY bucket`),
      getSummary()
    ]);
    const order = ['Healthy', 'Expiring soon', 'Low stock', 'Expired', 'Out of stock'], m = new Map(status.map(s => [s.name, n(s.count)]));
    res.json({ success: true, data: { categories: categories.map(c => ({ name: c.name, count: n(c.count) })), batch_status: order.map(name => ({ name, count: m.get(name) || 0 })), summary } });
  } catch (e) { next(e); }
};
