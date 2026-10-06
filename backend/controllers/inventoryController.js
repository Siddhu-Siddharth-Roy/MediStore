const db = require('../config/database');
const AppError = require('../utils/AppError');
const { withTransaction } = require('../utils/db');
const { paginate, meta, like } = require('../utils/pagination');
const { expiryStatusSql } = require('../utils/expiry');
const { changeStock } = require('../services/stockService');
const { lowStockRows, getSummary } = require('../services/inventoryService');
const { syncAlerts, syncAlertsSoon, notifyStaff } = require('../services/alertService');

const BATCH_SELECT = `SELECT b.batch_id, b.medicine_id, m.name AS medicine_name, m.strength, m.dosage_form, m.mrp,
    b.supplier_id, s.supplier_name, b.batch_number, b.manufacturing_date, b.expiry_date, b.purchase_price, b.selling_price,
    b.quantity, b.reorder_level, b.created_at, DATEDIFF(b.expiry_date, CURDATE()) AS days_to_expiry,
    ${expiryStatusSql('b.expiry_date')} AS expiry_status,
    CASE WHEN b.quantity = 0 THEN 'OUT_OF_STOCK' WHEN b.quantity <= b.reorder_level THEN 'LOW_STOCK' ELSE 'IN_STOCK' END AS stock_status
  FROM medicine_batches b JOIN medicines m ON m.medicine_id = b.medicine_id LEFT JOIN suppliers s ON s.supplier_id = b.supplier_id`;
const getBatch = async (id, conn = db) => {
  const [r] = await conn.execute(`${BATCH_SELECT} WHERE b.batch_id = ?`, [id]);
  if (!r.length) throw new AppError('Batch not found', 404);
  return r[0];
};
const who = (req) => `${req.user.name} (#${req.user.user_id})`;
const dbToday = async () => (await db.execute('SELECT CURDATE() AS d'))[0][0].d; // same clock/timezone as every CURDATE() in the SQL

// Shared validation for batch create/update; also checks price against the medicine's MRP and supplier state.
async function checkBatchRules(b, medicineId) {
  const today = await dbToday();
  if (b.manufacturing_date && b.manufacturing_date > today) throw new AppError('Manufacturing date cannot be in the future', 422);
  if (b.manufacturing_date && b.manufacturing_date >= b.expiry_date) throw new AppError('Expiry date must be after the manufacturing date', 422);
  const [m] = await db.execute('SELECT mrp FROM medicines WHERE medicine_id = ?', [medicineId]);
  if (!m.length) throw new AppError('Medicine not found', 404);
  if (Number(b.selling_price) > Number(m[0].mrp)) throw new AppError(`Selling price cannot exceed the medicine's MRP (${m[0].mrp})`, 422);
  if (b.supplier_id) {
    const [s] = await db.execute('SELECT status FROM suppliers WHERE supplier_id = ?', [b.supplier_id]);
    if (!s.length) throw new AppError('Supplier not found', 404);
    if (s[0].status !== 'active') throw new AppError('Supplier is inactive', 422);
  }
}

// ---------- reads ----------
exports.list = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req);
    const where = [], params = [], q = req.query;
    if (q.q) { const l = like(q.q); where.push('(m.name LIKE ? OR m.generic_name LIKE ? OR b.batch_number LIKE ?)'); params.push(l, l, l); }
    if (/^\d+$/.test(q.medicine_id || '')) { where.push('b.medicine_id = ?'); params.push(q.medicine_id); }
    if (/^\d+$/.test(q.supplier_id || '')) { where.push('b.supplier_id = ?'); params.push(q.supplier_id); }
    const STATUS = {
      in_stock: 'b.quantity > 0 AND b.expiry_date >= CURDATE()', low: 'b.quantity > 0 AND b.quantity <= b.reorder_level AND b.expiry_date >= CURDATE()',
      out: 'b.quantity = 0', expired: 'b.quantity > 0 AND b.expiry_date < CURDATE()',
      expiring: 'b.quantity > 0 AND b.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)' };
    if (STATUS[q.status]) where.push(STATUS[q.status]);
    const SORTS = { expiry_date: 'b.expiry_date', quantity: 'b.quantity', medicine_name: 'm.name', created_at: 'b.created_at' };
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [[{ total }]] = await db.execute(`SELECT COUNT(*) total FROM medicine_batches b JOIN medicines m ON m.medicine_id = b.medicine_id ${w}`, params);
    const [rows] = await db.execute(`${BATCH_SELECT} ${w} ORDER BY ${SORTS[q.sort] || 'b.expiry_date'} ${q.dir === 'desc' ? 'DESC' : 'ASC'}, b.batch_id LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ success: true, data: rows, pagination: meta(page, limit, total) });
  } catch (e) { next(e); }
};

exports.getOne = async (req, res, next) => { try { res.json({ success: true, data: await getBatch(req.params.id) }); } catch (e) { next(e); } };

exports.summary = async (req, res, next) => { try { res.json({ success: true, data: await getSummary() }); } catch (e) { next(e); } };

exports.lowStock = async (req, res, next) => {
  try {
    let rows = await lowStockRows();
    if (req.query.status === 'out') rows = rows.filter(r => r.stock_status === 'OUT_OF_STOCK');
    if (req.query.status === 'low') rows = rows.filter(r => r.stock_status === 'LOW_STOCK');
    res.json({ success: true, data: rows });
  } catch (e) { next(e); }
};

async function expiryList(req, res, next, where, ordering) {
  try {
    const { page, limit, offset } = paginate(req);
    const [[{ total, units, value }]] = await db.execute(`SELECT COUNT(*) total, COALESCE(SUM(b.quantity),0) units, COALESCE(SUM(b.quantity*b.purchase_price),0) value FROM medicine_batches b WHERE ${where}`);
    const [rows] = await db.execute(`${BATCH_SELECT} WHERE ${where} ORDER BY ${ordering}, b.batch_id LIMIT ${limit} OFFSET ${offset}`);
    res.json({ success: true, data: rows, totals: { batches: Number(total), units: Number(units), value_at_risk: Number(value) }, pagination: meta(page, limit, total) });
  } catch (e) { next(e); }
}
// Only batches that still hold stock are listed; empty expired batches need no action.
exports.expired = (req, res, next) => expiryList(req, res, next, 'b.quantity > 0 AND b.expiry_date < CURDATE()', 'b.expiry_date DESC');
exports.expiring = (req, res, next) => {
  const days = [30, 60, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30; // whitelisted, safe to inline
  return expiryList(req, res, next, `b.quantity > 0 AND b.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ${days} DAY)`, 'b.expiry_date ASC');
};

exports.transactions = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req, 15), q = req.query, where = [], params = [];
    if (/^\d+$/.test(q.medicine_id || '')) { where.push('t.medicine_id = ?'); params.push(q.medicine_id); }
    if (/^\d+$/.test(q.batch_id || '')) { where.push('t.batch_id = ?'); params.push(q.batch_id); }
    if (['PURCHASE', 'SALE', 'RETURN', 'EXPIRED', 'DAMAGED', 'ADJUSTMENT'].includes(q.type)) { where.push('t.transaction_type = ?'); params.push(q.type); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { where.push('t.transaction_date >= ?'); params.push(q.from); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { where.push('t.transaction_date < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(q.to); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [[{ total }]] = await db.execute(`SELECT COUNT(*) total FROM inventory_transactions t ${w}`, params);
    const [rows] = await db.execute(`SELECT t.transaction_id, t.transaction_date, t.transaction_type, t.quantity, t.reference_id, t.remarks, t.medicine_id, t.batch_id,
        m.name AS medicine_name, m.strength, b.batch_number FROM inventory_transactions t
        JOIN medicines m ON m.medicine_id = t.medicine_id JOIN medicine_batches b ON b.batch_id = t.batch_id
        ${w} ORDER BY t.transaction_id DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ success: true, data: rows, pagination: meta(page, limit, total) });
  } catch (e) { next(e); }
};

// ---------- writes ----------
// Add stock as a NEW batch (opening stock). Quantity changes on existing batches go through /adjust so every change is explained.
exports.addBatch = async (req, res, next) => {
  try {
    const b = req.body;
    if (b.expiry_date < await dbToday()) throw new AppError('Cannot add a batch that has already expired', 422);
    await checkBatchRules(b, b.medicine_id);
    const id = await withTransaction(async (conn) => {
      const [r] = await conn.execute(
        `INSERT INTO medicine_batches (medicine_id, supplier_id, batch_number, manufacturing_date, expiry_date, purchase_price, selling_price, quantity, reorder_level)
         VALUES (?,?,?,?,?,?,?,0,?)`,
        [b.medicine_id, b.supplier_id || null, b.batch_number, b.manufacturing_date || null, b.expiry_date, b.purchase_price, b.selling_price, b.reorder_level ?? 10]);
      await changeStock(conn, { batchId: r.insertId, delta: Number(b.quantity), type: 'ADJUSTMENT', remarks: `Opening stock for new batch, added by ${who(req)}` });
      return r.insertId;
    });
    syncAlertsSoon();
    res.status(201).json({ success: true, message: 'Stock added', data: await getBatch(id) });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') e = new AppError('This medicine already has a batch with that batch number. Use "Adjust" to change its quantity', 409);
    next(e);
  }
};

// Edit batch details (not quantity).
exports.updateBatch = async (req, res, next) => {
  try {
    const cur = await getBatch(req.params.id), b = req.body;
    await checkBatchRules(b, cur.medicine_id);
    await db.execute(`UPDATE medicine_batches SET supplier_id=?, manufacturing_date=?, expiry_date=?, purchase_price=?, selling_price=?, reorder_level=? WHERE batch_id=?`,
      [b.supplier_id || null, b.manufacturing_date || null, b.expiry_date, b.purchase_price, b.selling_price, b.reorder_level ?? cur.reorder_level, cur.batch_id]);
    syncAlertsSoon();
    res.json({ success: true, message: 'Batch updated', data: await getBatch(cur.batch_id) });
  } catch (e) { next(e); }
};

// ADJUSTMENT takes a signed quantity; DAMAGED/EXPIRED always remove stock; RETURN always adds stock.
exports.adjust = async (req, res, next) => {
  try {
    const { batch_id, type, remarks } = req.body, qty = Number(req.body.quantity);
    const delta = type === 'ADJUSTMENT' ? qty : type === 'RETURN' ? Math.abs(qty) : -Math.abs(qty);
    const result = await withTransaction(conn => changeStock(conn, { batchId: batch_id, delta, type, remarks: `${remarks} — by ${who(req)}` }));
    const batch = await getBatch(batch_id);
    await notifyStaff('stock_adjustment', `Stock ${type.toLowerCase()}: ${batch.medicine_name}`,
      `${req.user.name} changed batch ${batch.batch_number} by ${delta > 0 ? '+' : ''}${delta} (${result.before} → ${result.after}). Reason: ${remarks}`, { dedupe: false, excludeUserId: req.user.user_id });
    syncAlertsSoon();
    res.json({ success: true, message: 'Stock updated', data: batch, movement: result });
  } catch (e) { next(e); }
};

// Writes off ALL expired stock in one go (type EXPIRED) after staff have physically removed it.
exports.writeOffExpired = async (req, res, next) => {
  try {
    const out = await withTransaction(async (conn) => {
      const [rows] = await conn.execute('SELECT batch_id, quantity FROM medicine_batches WHERE expiry_date < CURDATE() AND quantity > 0 FOR UPDATE');
      for (const r of rows) await changeStock(conn, { batchId: r.batch_id, delta: -r.quantity, type: 'EXPIRED', remarks: `Expired stock written off by ${who(req)}` });
      return { batches: rows.length, units: rows.reduce((a, r) => a + r.quantity, 0) };
    });
    if (out.batches) await notifyStaff('stock_adjustment', 'Expired stock written off', `${req.user.name} wrote off ${out.units} unit(s) across ${out.batches} expired batch(es).`, { dedupe: false, excludeUserId: req.user.user_id });
    syncAlertsSoon();
    res.json({ success: true, message: out.batches ? `Wrote off ${out.units} unit(s) from ${out.batches} batch(es)` : 'No expired stock to write off', data: out });
  } catch (e) { next(e); }
};

exports.syncAlerts = async (req, res, next) => { try { await syncAlerts(); res.json({ success: true, message: 'Alerts refreshed' }); } catch (e) { next(e); } };
