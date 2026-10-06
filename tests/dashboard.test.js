// Phase 6 tests: dashboard numbers, charts data, reports, CSV export, notification housekeeping. Server must be running.
require('dotenv').config();
const db = require('../backend/config/database');
const BASE = process.env.BASE_URL || 'http://localhost:3000/api';
const ADMIN = [process.env.ADMIN_EMAIL || 'admin@medistore.com', process.env.ADMIN_PASS || 'Admin12345'];
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
function client() {
  let cookie = '';
  return async (method, path, body, raw) => {
    const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    if (raw) { const buf = Buffer.from(await r.arrayBuffer()); return { status: r.status, headers: r.headers, bom: buf.slice(0, 3).toString('hex'), text: buf.toString('utf8').replace(/^\uFEFF/, '') }; }
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
}
const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const one = async (sql, p = []) => (await db.execute(sql, p))[0][0];
const DELIV = { delivery_address: '12 Test Street, Pune 411001', delivery_phone: '9876543210' };

(async () => {
  const stamp = Date.now(), admin = client(), anon = client(), pharm = client(), cust = client();
  await admin('POST', '/auth/login', { email: ADMIN[0], password: ADMIN[1] });
  const em = (k) => `zzd${stamp}_${k}@test.com`;
  await cust('POST', '/auth/register', { name: 'ZZ Shopper', email: em('c'), password: 'Passw0rdd' }); await cust('POST', '/auth/login', { email: em('c'), password: 'Passw0rdd' });
  await admin('POST', '/users', { name: 'ZZ Pharm', email: em('p'), password: 'Pharma1234', role: 'pharmacist' }); await pharm('POST', '/auth/login', { email: em('p'), password: 'Pharma1234' });

  // ---------- access control
  for (const p of ['/dashboard/summary', '/dashboard/sales', '/dashboard/inventory', '/reports/sales']) {
    ok((await anon('GET', p)).status === 401 && (await cust('GET', p)).status === 403 && (await pharm('GET', p)).status === 200, `${p}: anonymous 401, customer 403, pharmacist 200`);
  }

  // ---------- fixtures
  let r = await admin('POST', '/categories', { category_name: 'ZZ Cat ' + stamp }); const cat = r.body.data.category_id;
  r = await admin('POST', '/suppliers', { supplier_name: 'ZZ Report Supplier' }); const S = r.body.data.supplier_id;
  const mids = [], mk = async (name, price, mrp, extra = {}) => { const x = await admin('POST', '/medicines', { name, mrp, selling_price: price, ...extra }); mids.push(x.body.data.medicine_id); return x.body.data.medicine_id; };
  const A = await mk(`ZZ Alpha ${stamp}`, 40, 50, { category_id: cat, strength: '10mg' }), B = await mk(`ZZ Beta ${stamp}`, 25.5, 30), C = await mk(`ZZ Gamma ${stamp}`, 90, 120);
  const EVIL = await mk(`=ZZ Evil ${stamp}`, 10, 20), QUOTE = await mk(`ZZ "Quoted", Name ${stamp}`, 10, 20);
  const batch = async (mid, bn, qty, cost, sell, reorder = 5) => (await admin('POST', '/inventory/batches', { medicine_id: mid, supplier_id: S, batch_number: bn, quantity: qty, expiry_date: addDays(365), purchase_price: cost, selling_price: sell, reorder_level: reorder })).body.data.batch_id;
  await batch(A, 'ZA-1', 100, 10, 40); await batch(B, 'ZB-1', 50, 20, 25.5, 60); await batch(C, 'ZC-1', 5, 100, 90); await batch(EVIL, 'ZE-1', 3, 1, 10); await batch(QUOTE, 'ZQ-1', 4, 1, 10);
  const order = async (items) => { for (const [m, q] of items) await cust('POST', '/cart/items', { medicine_id: m, quantity: q }); const x = await cust('POST', '/orders', DELIV); if (x.status !== 201) throw new Error('order failed: ' + x.body.message); return x.body.data.order_id; };
  const o1 = await order([[A, 3]]), o2 = await order([[A, 2], [B, 2]]), o3 = await order([[B, 4]]), o4 = await order([[A, 1]]), o5 = await order([[C, 1]]);
  ok(true, `orders created: ${o1},${o2},${o3},${o4},${o5}`);
  await db.execute('UPDATE orders SET order_date = DATE_SUB(NOW(), INTERVAL 3 DAY) WHERE order_id = ?', [o1]);
  await db.execute('UPDATE orders SET order_date = DATE_SUB(NOW(), INTERVAL 40 DAY) WHERE order_id = ?', [o4]);

  // ---------- dashboard summary equals independent SQL
  r = await admin('GET', '/dashboard/summary'); let c = r.body.data.cards;
  ok(c.total_medicines === (await one('SELECT COUNT(*) n FROM medicines')).n && c.total_customers === (await one("SELECT COUNT(*) n FROM users WHERE role='customer'")).n, 'total medicines and customers match the database');
  ok(c.total_orders === (await one('SELECT COUNT(*) n FROM orders')).n && c.pending_orders === (await one("SELECT COUNT(*) n FROM orders WHERE order_status='Pending'")).n, 'total and pending orders match');
  ok(c.total_suppliers === (await one("SELECT COUNT(*) n FROM suppliers WHERE status='active'")).n, 'active suppliers match');
  const todaySql = async () => Number((await one("SELECT COALESCE(SUM(total_amount),0) s FROM orders WHERE order_status<>'Cancelled' AND DATE(order_date)=CURDATE()")).s).toFixed(2);
  ok(c.todays_sales === await todaySql(), "today's sales equals SQL (" + c.todays_sales + ')');
  const before = Number(c.todays_sales);
  ok((await cust('POST', `/orders/${o3}/cancel`, {})).status === 200, 'order 3 cancelled');
  r = await admin('GET', '/dashboard/summary'); c = r.body.data.cards;
  ok((before - Number(c.todays_sales)).toFixed(2) === '102.00' && c.todays_sales === await todaySql(), "cancelled order (102.00) is removed from today's sales");
  ok(c.total_orders === (await one('SELECT COUNT(*) n FROM orders')).n, 'cancelled orders still count in "total orders"');
  const inv = (await admin('GET', '/inventory/summary')).body.data;
  ok(c.low_stock === inv.low_stock_medicines && c.out_of_stock === inv.out_of_stock_medicines && c.expiring_soon === inv.expiring_30 && c.expired === inv.expired_batches, 'low/out/expiring/expired cards match the inventory module');
  const s = r.body.data.sales;
  ok(s.today.amount === c.todays_sales && Number(s.last_7_days.amount) >= Number(s.today.amount) && Number(s.all_time.amount) >= Number(s.last_7_days.amount), 'sales summary is monotonic: today <= 7 days <= all time');
  const wk = (await one("SELECT COALESCE(SUM(total_amount),0) s, COUNT(*) n FROM orders WHERE order_status<>'Cancelled' AND order_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)"));
  ok(s.last_7_days.amount === Number(wk.s).toFixed(2) && s.last_7_days.orders === wk.n, 'last-7-days sales equals SQL');
  ok(Array.isArray(r.body.data.recent_orders) && r.body.data.recent_orders.length <= 5 && r.body.data.recent_orders[0].order_id === (await one('SELECT MAX(order_id) m FROM orders')).m, 'recent orders: newest first, max 5');
  ok(r.body.data.low_stock_list.some(m => m.name === `ZZ Beta ${stamp}`), 'low-stock list includes the medicine below its reorder level');
  ok(r.body.data.inventory.stock_value === Number(inv.stock_value).toFixed(2), 'inventory value matches');

  // ---------- sales series
  r = await admin('GET', '/dashboard/sales'); let sr = r.body.data;
  ok(sr.period === 'daily' && sr.series.length === 30 && sr.series[29].period === (await one('SELECT CURDATE() d')).d, 'daily series: 30 points ending today');
  ok(sr.series.every((p, i, a) => i === 0 || p.period > a[i - 1].period), 'dates strictly ascending (no gaps or duplicates)');
  const d3 = sr.series[26], sql3 = await one("SELECT COALESCE(SUM(total_amount),0) s, COUNT(*) n FROM orders WHERE order_status<>'Cancelled' AND DATE(order_date)=DATE_SUB(CURDATE(), INTERVAL 3 DAY)");
  ok(d3.revenue === Number(sql3.s).toFixed(2) && d3.orders === sql3.n && Number(d3.revenue) >= 120, 'point 3 days ago equals SQL (includes order 1: 120.00)');
  ok(sr.total_revenue === (sr.series.reduce((a, p) => a + Math.round(Number(p.revenue) * 100), 0) / 100).toFixed(2), 'total_revenue equals the sum of the series');
  ok(!sr.series.some(p => /^\d{4}-\d{2}-\d{2}$/.test(p.period) && p.period === (addDays(-40))), 'the 40-day-old order is outside the 30-day window');
  ok((await admin('GET', '/dashboard/sales?days=1000')).body.data.series.length === 90 && (await admin('GET', '/dashboard/sales?days=2')).body.data.series.length === 7, 'days parameter is clamped to 7..90');
  r = await admin('GET', '/dashboard/sales?period=monthly&months=12'); sr = r.body.data;
  ok(sr.series.length === 12 && sr.series[11].period === (await one("SELECT DATE_FORMAT(CURDATE(),'%Y-%m') m")).m && sr.series.every(p => /^\d{4}-\d{2}$/.test(p.period)), 'monthly series: 12 months ending this month');
  const monthSql = await one("SELECT COALESCE(SUM(total_amount),0) s FROM orders WHERE order_status<>'Cancelled' AND order_date >= DATE_SUB(DATE_FORMAT(CURDATE(),'%Y-%m-01'), INTERVAL 11 MONTH)");
  ok(sr.total_revenue === Number(monthSql.s).toFixed(2), 'monthly total equals SQL (includes the 40-day-old order)');
  const top = (await admin('GET', '/dashboard/sales?days=90')).body.data.top_medicines, ta = top.find(t => t.medicine_id === A), tb = top.find(t => t.medicine_id === B);
  ok(ta && ta.units === 6 && ta.revenue === '240.00', 'top sellers: Alpha 6 units / 240.00 (all non-cancelled orders in window)');
  ok(tb && tb.units === 2 && tb.revenue === '51.00', 'top sellers: Beta counts 2 units; the cancelled 4 are excluded');
  ok(top.length <= 5 && top.every((t, i, a) => i === 0 || a[i - 1].units >= t.units), 'top sellers sorted by units, max 5');

  // ---------- inventory charts
  r = await admin('GET', '/dashboard/inventory'); const di = r.body.data;
  ok(di.categories.find(x => x.name === 'ZZ Cat ' + stamp)?.count === 1 && di.categories.some(x => x.name === 'Uncategorised'), 'category chart counts active medicines (incl. "Uncategorised")');
  ok(di.batch_status.map(x => x.name).join() === 'Healthy,Expiring soon,Low stock,Expired,Out of stock', 'status buckets are always all five, in a fixed order');
  ok(di.batch_status.reduce((a, x) => a + x.count, 0) === (await one('SELECT COUNT(*) n FROM medicine_batches')).n, 'every batch is in exactly one bucket (chart adds up)');
  ok(di.summary.low_stock_medicines === inv.low_stock_medicines, 'inventory summary shared with the inventory module');

  // ---------- reports: sales
  const from = addDays(-5), to = addDays(0), q = `from=${from}&to=${to}`;
  r = await admin('GET', `/reports/sales?group=medicine&${q}`); const rep = r.body.data, row = (n) => rep.rows.find(x => x.label.includes(n));
  const ra = row(`ZZ Alpha ${stamp}`), rb = row(`ZZ Beta ${stamp}`), rc = row(`ZZ Gamma ${stamp}`);
  ok(ra.units === 5 && ra.revenue === '200.00' && ra.cost === '50.00' && ra.profit === '150.00' && ra.orders === 2, 'Alpha: 5 units, revenue 200.00, cost 50.00, profit 150.00 (order 4 is outside the range)');
  ok(rb.units === 2 && rb.revenue === '51.00' && rb.cost === '40.00' && rb.profit === '11.00', 'Beta: cancelled order excluded; cost uses the batch purchase price');
  ok(rc.profit === '-10.00', 'selling below cost shows a negative profit (-10.00)');
  ok(rep.columns.length === 6 && rep.totals.label === 'Total', 'report shape: columns + totals row');
  r = await admin('GET', `/reports/sales?group=day&${q}`);
  ok(r.body.data.totals.revenue === (r.body.data.rows.reduce((a, x) => a + Math.round(Number(x.revenue) * 100), 0) / 100).toFixed(2), 'day report totals equal the sum of the rows');
  ok(r.body.data.rows.some(x => x.label === addDays(-3)) && r.body.data.rows.some(x => x.label === addDays(0)), 'day report has rows for the days with sales');
  r = await admin('GET', `/reports/sales?group=month&from=${addDays(-60)}&to=${to}`); ok(r.body.data.rows.every(x => /^\d{4}-\d{2}$/.test(x.label)), 'month grouping');
  r = await admin('GET', `/reports/sales?group=category&${q}`); const cr = r.body.data.rows.find(x => x.label === 'ZZ Cat ' + stamp); ok(cr && cr.units === 5 && cr.revenue === '200.00', 'category grouping');
  ok((await admin('GET', `/reports/sales?group=bogus&${q}`)).body.data.params.group === 'day', 'unknown group falls back to day');

  // ---------- reports: purchases / inventory / expiry / low stock
  r = await admin('POST', '/purchases', { supplier_id: S, invoice_number: 'ZZINV' + stamp, confirm: true, items: [{ medicine_id: A, batch_number: 'ZA-P', quantity: 10, purchase_price: 12.5, expiry_date: addDays(300), selling_price: 40 }] });
  await admin('POST', '/purchases', { supplier_id: S, items: [{ medicine_id: A, batch_number: 'ZA-D', quantity: 99, purchase_price: 1, expiry_date: addDays(300), selling_price: 40 }] }); // draft
  r = await admin('GET', `/reports/purchases?supplier_id=${S}&${q}`); const pr = r.body.data;
  ok(pr.rows.length === 1 && pr.rows[0].total_amount === '125.00' && pr.rows[0].units === 10 && pr.totals.total_amount === '125.00', 'purchases report: only the confirmed purchase (125.00); the draft is excluded');
  r = await admin('GET', '/reports/inventory'); const ia = r.body.data.rows.find(x => x.name.includes(`ZZ Alpha ${stamp}`));
  ok(ia.sellable === 104 && ia.cost_value === '1065.00' && ia.retail_value === '4160.00' && ia.status === 'In stock', 'stock valuation: 104 units; cost 94x10 + 10x12.50 = 1065.00; retail 104x40 = 4160.00');
  ok(r.body.data.totals.sellable === r.body.data.rows.reduce((a, x) => a + x.sellable, 0), 'inventory totals row is the sum');
  ok((await admin('GET', '/reports/inventory?stock=low')).body.data.rows.every(x => x.status === 'Low stock') && (await admin('GET', '/reports/inventory?stock=low')).body.data.rows.some(x => x.name.includes('ZZ Beta')), 'stock=low filter');
  await db.execute('INSERT INTO medicine_batches (medicine_id,batch_number,expiry_date,purchase_price,selling_price,quantity,reorder_level) VALUES (?,?,DATE_SUB(CURDATE(),INTERVAL 2 DAY),10,40,7,1)', [A, 'ZA-OLD']);
  r = await admin('GET', '/reports/expiry?window=expired'); const eo = r.body.data.rows.find(x => x.batch_number === 'ZA-OLD');
  ok(eo && eo.days === -2 && eo.quantity === 7 && eo.value === '70.00', 'expiry report (expired): -2 days, 7 units, value 70.00');
  ok(!(await admin('GET', '/reports/expiry?window=30')).body.data.rows.some(x => x.batch_number === 'ZA-OLD'), 'expired batch is not in the 30-day window');
  ok((await admin('GET', '/reports/expiry?window=bogus')).body.data.params.window === '30', 'unknown window falls back to 30');
  ok((await admin('GET', '/reports/low-stock')).body.data.rows.some(x => x.name.includes('ZZ Beta') && x.status === 'Low stock'), 'low-stock report lists Beta');

  // ---------- CSV export
  let csv = await admin('GET', `/reports/sales?group=medicine&${q}&format=csv`, null, true);
  ok(csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type')) && /attachment; filename="sales-.*\.csv"/.test(csv.headers.get('content-disposition')), 'CSV: correct content-type and download filename');
  ok(csv.bom === 'efbbbf' && csv.text.split('\r\n')[0] === 'Medicine,Orders containing,Units sold,Revenue,Cost of goods,Gross profit', 'CSV: UTF-8 BOM (checked on raw bytes) + header row');
  ok(/^"?ZZ Gamma[^\n]*,-10\.00\r?$/m.test(csv.text), 'CSV: negative numbers stay numeric (not prefixed)');
  ok(csv.text.trim().split('\r\n').length === rep.rows.length + 2, 'CSV: header + every row + totals row');
  csv = await admin('GET', '/reports/inventory?format=csv', null, true);
  ok(csv.text.includes(`'=ZZ Evil ${stamp}`) && !new RegExp(`(^|,)=ZZ Evil`, 'm').test(csv.text), 'CSV injection: a medicine named "=ZZ Evil" is exported as \'=ZZ Evil (neutralised)');
  ok(csv.text.includes(`"ZZ ""Quoted"", Name ${stamp}"`), 'CSV: commas and quotes are escaped correctly');

  // ---------- validation
  ok((await admin('GET', '/reports/nope')).status === 422, 'unknown report -> 422');
  ok((await admin('GET', '/reports/sales?format=xml')).status === 422, 'bad format -> 422');
  ok((await admin('GET', '/reports/sales?from=2026-13-45')).status === 422 && (await admin('GET', '/reports/sales?from=garbage')).status === 422, 'invalid dates -> 422');
  ok((await admin('GET', `/reports/sales?from=${addDays(-400)}&to=${to}`)).status === 422, 'range over a year -> 422');
  ok((await admin('GET', `/reports/sales?from=${to}&to=${from}`)).status === 422, 'from after to -> 422');
  ok((await admin('GET', "/reports/sales?group=day;DROP TABLE users")).status === 200, 'group is whitelisted (no SQL injection)');

  // ---------- notification housekeeping
  const [[adm]] = await db.execute('SELECT user_id FROM users WHERE email=?', [ADMIN[0]]);
  const [oldRead] = await db.execute("INSERT INTO notifications (user_id,title,message,type,is_read,created_at) VALUES (?,?,?,?,1,DATE_SUB(NOW(),INTERVAL 100 DAY))", [adm.user_id, 'ZZ old read', 'x', 'low_stock']);
  const [oldUnread] = await db.execute("INSERT INTO notifications (user_id,title,message,type,is_read,created_at) VALUES (?,?,?,?,0,DATE_SUB(NOW(),INTERVAL 100 DAY))", [adm.user_id, 'ZZ old unread', 'x', 'low_stock']);
  const [recentRead] = await db.execute("INSERT INTO notifications (user_id,title,message,type,is_read,created_at) VALUES (?,?,?,?,1,DATE_SUB(NOW(),INTERVAL 10 DAY))", [adm.user_id, 'ZZ recent read', 'x', 'low_stock']);
  await admin('POST', '/inventory/sync-alerts');
  const exists = async (id) => (await one('SELECT COUNT(*) n FROM notifications WHERE notification_id=?', [id])).n === 1;
  ok(!(await exists(oldRead.insertId)) && await exists(oldUnread.insertId) && await exists(recentRead.insertId), 'housekeeping removes read notifications older than 90 days, never unread or recent ones');

  // ---------- cleanup
  const uids = (await db.execute('SELECT user_id FROM users WHERE email LIKE ?', [`zzd${stamp}_%`]))[0].map(u => u.user_id);
  await db.query('DELETE FROM orders WHERE customer_id IN (?)', [uids]);
  await db.execute('DELETE FROM purchases WHERE supplier_id = ?', [S]);
  await db.query('DELETE FROM inventory_transactions WHERE medicine_id IN (?)', [mids]);
  await db.query('DELETE FROM medicine_batches WHERE medicine_id IN (?)', [mids]);
  await db.query('DELETE FROM medicines WHERE medicine_id IN (?)', [mids]);
  await db.execute('DELETE FROM categories WHERE category_id = ?', [cat]); await db.execute('DELETE FROM suppliers WHERE supplier_id = ?', [S]);
  await db.execute("DELETE FROM notifications WHERE title LIKE '%ZZ%' OR message LIKE '%ZZ%'");
  await db.query('DELETE FROM users WHERE user_id IN (?)', [uids]);
  console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
