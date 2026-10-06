// Report engine. Every report returns the same shape {title, columns, rows, totals} so ONE table renderer in the UI and ONE CSV writer serve them all.
// column.type: text | int | money | date  (controls formatting in the UI and CSV-injection protection in CSV)
const db = require('../config/database');
const AppError = require('../utils/AppError');
const { lowStockRows } = require('./inventoryService');

const run = async (sql, params = []) => (await db.execute(sql, params))[0];
const iso = /^\d{4}-\d{2}-\d{2}$/;
const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const addDays = (d, k) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
const fix = (cols, rows) => rows.map(r => Object.fromEntries(cols.map(c => [c.key, c.type === 'money' ? Number(r[c.key] || 0).toFixed(2) : c.type === 'int' ? Number(r[c.key] || 0) : (r[c.key] ?? '')])));
const totalsRow = (cols, rows, sumKeys, labelKey, label = 'Total') => Object.fromEntries(cols.map(c => [c.key,
  c.key === labelKey ? label : sumKeys.includes(c.key) ? (c.type === 'money' ? (rows.reduce((a, r) => a + Math.round(Number(r[c.key]) * 100), 0) / 100).toFixed(2) : rows.reduce((a, r) => a + Number(r[c.key]), 0)) : '']));

// Validates from/to (default: last 30 days, max 366) using the DB's idea of today.
async function range(q) {
  const [{ today }] = await run('SELECT CURDATE() AS today');
  const to = q.to || today, from = q.from || addDays(to, -29);
  if (!iso.test(from) || !iso.test(to) || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) throw new AppError('Dates must be valid (YYYY-MM-DD)', 422);
  if (from > to) throw new AppError('"From" date must not be after the "To" date', 422);
  if (days(from, to) > 366) throw new AppError('Please choose a range of one year or less', 422);
  return { from, to };
}

const REPORTS = {
  async sales(q) {
    const { from, to } = await range(q), group = ['day', 'month', 'medicine', 'category'].includes(q.group) ? q.group : 'day';
    const label = { day: ['Date', 'date', 'DATE(o.order_date)'], month: ['Month', 'text', "DATE_FORMAT(o.order_date, '%Y-%m')"],
      medicine: ['Medicine', 'text', "CONCAT(m.name, IF(m.strength IS NULL OR m.strength = '', '', CONCAT(' ', m.strength)))"], category: ['Category', 'text', "COALESCE(c.category_name, 'Uncategorised')"] }[group];
    const cols = [{ key: 'label', label: label[0], type: label[1] }, { key: 'orders', label: group === 'medicine' || group === 'category' ? 'Orders containing' : 'Orders', type: 'int' }, { key: 'units', label: 'Units sold', type: 'int' },
      { key: 'revenue', label: 'Revenue', type: 'money' }, { key: 'cost', label: 'Cost of goods', type: 'money' }, { key: 'profit', label: 'Gross profit', type: 'money' }];
    const base = `FROM order_items oi JOIN orders o ON o.order_id = oi.order_id JOIN medicines m ON m.medicine_id = oi.medicine_id JOIN medicine_batches b ON b.batch_id = oi.batch_id
      LEFT JOIN categories c ON c.category_id = m.category_id WHERE o.order_status <> 'Cancelled' AND o.order_date >= ? AND o.order_date < DATE_ADD(?, INTERVAL 1 DAY)`;
    const measures = 'COUNT(DISTINCT o.order_id) orders, SUM(oi.quantity) units, SUM(oi.subtotal) revenue, SUM(oi.quantity * b.purchase_price) cost, SUM(oi.subtotal - oi.quantity * b.purchase_price) profit';
    const raw = await run(`SELECT ${label[2]} AS label, ${measures} ${base} GROUP BY ${group === 'medicine' ? 'm.medicine_id, label' : 'label'} ORDER BY ${group === 'medicine' || group === 'category' ? 'revenue DESC' : 'label'}`, [from, to]);
    const [t] = await run(`SELECT ${measures} ${base}`, [from, to]);
    const rows = fix(cols, raw);
    return { title: `Sales by ${group}`, params: { from, to, group }, columns: cols, rows, totals: fix(cols, [{ ...t, label: 'Total' }])[0],
      note: 'Sales = all orders that were not cancelled. Cost uses the purchase price of the batches the stock was taken from.' };
  },
  async purchases(q) {
    const { from, to } = await range(q); const sid = /^\d+$/.test(q.supplier_id || '') ? q.supplier_id : null;
    const cols = [{ key: 'purchase_id', label: 'Purchase #', type: 'int' }, { key: 'purchase_date', label: 'Date', type: 'date' }, { key: 'supplier_name', label: 'Supplier', type: 'text' }, { key: 'invoice_number', label: 'Invoice', type: 'text' },
      { key: 'line_count', label: 'Lines', type: 'int' }, { key: 'units', label: 'Units', type: 'int' }, { key: 'total_amount', label: 'Total', type: 'money' }];
    const raw = await run(`SELECT p.purchase_id, p.purchase_date, s.supplier_name, p.invoice_number, COUNT(pi.purchase_item_id) line_count, COALESCE(SUM(pi.quantity),0) units, p.total_amount
      FROM purchases p JOIN suppliers s ON s.supplier_id = p.supplier_id LEFT JOIN purchase_items pi ON pi.purchase_id = p.purchase_id
      WHERE p.status = 'Confirmed' AND p.purchase_date BETWEEN ? AND ? ${sid ? 'AND p.supplier_id = ?' : ''} GROUP BY p.purchase_id ORDER BY p.purchase_date DESC, p.purchase_id DESC`, sid ? [from, to, sid] : [from, to]);
    const rows = fix(cols, raw);
    return { title: 'Purchases (confirmed)', params: { from, to, supplier_id: sid }, columns: cols, rows, totals: totalsRow(cols, rows, ['line_count', 'units', 'total_amount'], 'supplier_name', `Total (${rows.length} purchases)`) };
  },
  async inventory(q) {
    const cols = [{ key: 'name', label: 'Medicine', type: 'text' }, { key: 'category', label: 'Category', type: 'text' }, { key: 'manufacturer', label: 'Manufacturer', type: 'text' }, { key: 'sellable', label: 'Sellable units', type: 'int' },
      { key: 'expired_units', label: 'Expired units', type: 'int' }, { key: 'reorder_level', label: 'Reorder level', type: 'int' }, { key: 'status', label: 'Status', type: 'text' },
      { key: 'cost_value', label: 'Value at cost', type: 'money' }, { key: 'retail_value', label: 'Value at selling price', type: 'money' }];
    let raw = await run(`SELECT CONCAT(m.name, IF(m.strength IS NULL OR m.strength = '', '', CONCAT(' ', m.strength))) AS name, COALESCE(c.category_name, 'Uncategorised') AS category, m.manufacturer,
        SUM(CASE WHEN b.expiry_date >= CURDATE() THEN b.quantity ELSE 0 END) AS sellable, SUM(CASE WHEN b.expiry_date < CURDATE() THEN b.quantity ELSE 0 END) AS expired_units, MAX(b.reorder_level) AS reorder_level,
        SUM(CASE WHEN b.expiry_date >= CURDATE() THEN b.quantity * b.purchase_price ELSE 0 END) AS cost_value,
        SUM(CASE WHEN b.expiry_date >= CURDATE() THEN b.quantity ELSE 0 END) * m.selling_price AS retail_value
      FROM medicines m JOIN medicine_batches b ON b.medicine_id = m.medicine_id LEFT JOIN categories c ON c.category_id = m.category_id GROUP BY m.medicine_id ORDER BY name`);
    raw = raw.map(r => ({ ...r, status: Number(r.sellable) === 0 ? 'Out of stock' : Number(r.sellable) <= Number(r.reorder_level) ? 'Low stock' : 'In stock' }));
    const f = { low: 'Low stock', out: 'Out of stock' }[q.stock]; if (f) raw = raw.filter(r => r.status === f);
    const rows = fix(cols, raw);
    return { title: 'Stock valuation', params: { stock: q.stock || 'all' }, columns: cols, rows, totals: totalsRow(cols, rows, ['sellable', 'expired_units', 'cost_value', 'retail_value'], 'name', `Total (${rows.length} medicines)`),
      note: 'Only non-expired stock is valued. Expired units are listed separately.' };
  },
  async expiry(q) {
    const w = q.window === 'expired' ? 'expired' : [30, 60, 90].includes(Number(q.window)) ? Number(q.window) : 30;
    const cond = w === 'expired' ? 'b.expiry_date < CURDATE()' : `b.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ${w} DAY)`; // w is whitelisted
    const cols = [{ key: 'name', label: 'Medicine', type: 'text' }, { key: 'batch_number', label: 'Batch', type: 'text' }, { key: 'supplier_name', label: 'Supplier', type: 'text' }, { key: 'expiry_date', label: 'Expiry', type: 'date' },
      { key: 'days', label: 'Days left', type: 'int' }, { key: 'quantity', label: 'Units', type: 'int' }, { key: 'value', label: 'Value at cost', type: 'money' }];
    const raw = await run(`SELECT CONCAT(m.name, IF(m.strength IS NULL OR m.strength = '', '', CONCAT(' ', m.strength))) AS name, b.batch_number, s.supplier_name, b.expiry_date, DATEDIFF(b.expiry_date, CURDATE()) AS days,
        b.quantity, b.quantity * b.purchase_price AS value FROM medicine_batches b JOIN medicines m ON m.medicine_id = b.medicine_id LEFT JOIN suppliers s ON s.supplier_id = b.supplier_id
      WHERE b.quantity > 0 AND ${cond} ORDER BY b.expiry_date, m.name`);
    const rows = fix(cols, raw);
    return { title: w === 'expired' ? 'Expired stock' : `Expiring within ${w} days`, params: { window: String(w) }, columns: cols, rows, totals: totalsRow(cols, rows, ['quantity', 'value'], 'name', `Total (${rows.length} batches)`) };
  },
  async 'low-stock'() {
    const cols = [{ key: 'name', label: 'Medicine', type: 'text' }, { key: 'manufacturer', label: 'Manufacturer', type: 'text' }, { key: 'sellable', label: 'Sellable units', type: 'int' }, { key: 'reorder_level', label: 'Reorder level', type: 'int' }, { key: 'status', label: 'Status', type: 'text' }];
    const rows = fix(cols, (await lowStockRows()).map(r => ({ ...r, name: r.name + (r.strength ? ' ' + r.strength : ''), status: r.stock_status === 'OUT_OF_STOCK' ? 'Out of stock' : 'Low stock' })));
    return { title: 'Low and out-of-stock medicines', params: {}, columns: cols, rows, totals: null };
  }
};
exports.TYPES = Object.keys(REPORTS);
exports.build = (type, q) => REPORTS[type](q);

// ---- CSV ----
// Spreadsheet apps execute cells that start with = + - @ (CSV/formula injection). Text cells get a leading apostrophe; numeric columns are left alone.
const cell = (v, type) => {
  let s = String(v ?? '');
  if (type === 'text' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
exports.toCsv = (rep) => {
  const lines = [rep.columns.map(c => cell(c.label, 'text')).join(',')];
  for (const r of rep.rows) lines.push(rep.columns.map(c => cell(r[c.key], c.type)).join(','));
  if (rep.totals) lines.push(rep.columns.map(c => cell(rep.totals[c.key], c.type)).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n'; // BOM so Excel reads UTF-8 correctly
};
