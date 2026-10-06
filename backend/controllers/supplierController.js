const db = require('../config/database');
const AppError = require('../utils/AppError');
const { paginate, meta, like } = require('../utils/pagination');

const FIELDS = ['supplier_name', 'company_name', 'contact_person', 'phone', 'email', 'address', 'gst_number'];
const vals = (b) => FIELDS.map(f => (b[f] === undefined || b[f] === '' ? null : b[f]));
const find = async (id) => {
  const [r] = await db.execute('SELECT * FROM suppliers WHERE supplier_id = ?', [id]);
  if (!r.length) throw new AppError('Supplier not found', 404);
  return r[0];
};

exports.list = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req);
    const where = [], params = [];
    if (req.query.q) { where.push('(supplier_name LIKE ? OR company_name LIKE ? OR contact_person LIKE ? OR phone LIKE ?)'); const l = like(req.query.q); params.push(l, l, l, l); }
    if (['active', 'inactive'].includes(req.query.status)) { where.push('status = ?'); params.push(req.query.status); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [[{ total }]] = await db.execute(`SELECT COUNT(*) total FROM suppliers ${w}`, params);
    const [rows] = await db.execute(`SELECT * FROM suppliers ${w} ORDER BY supplier_name LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ success: true, data: rows, pagination: meta(page, limit, total) });
  } catch (e) { next(e); }
};
exports.get = async (req, res, next) => { try { res.json({ success: true, data: await find(req.params.id) }); } catch (e) { next(e); } };
exports.create = async (req, res, next) => {
  try {
    const [r] = await db.execute(`INSERT INTO suppliers (${FIELDS.join(',')}) VALUES (${FIELDS.map(() => '?').join(',')})`, vals(req.body));
    res.status(201).json({ success: true, message: 'Supplier added', data: await find(r.insertId) });
  } catch (e) { next(e); }
};
exports.update = async (req, res, next) => {
  try {
    await find(req.params.id);
    await db.execute(`UPDATE suppliers SET ${FIELDS.map(f => f + '=?').join(',')} WHERE supplier_id=?`, [...vals(req.body), req.params.id]);
    res.json({ success: true, message: 'Supplier updated', data: await find(req.params.id) });
  } catch (e) { next(e); }
};
exports.setStatus = async (req, res, next) => {
  try {
    await find(req.params.id);
    await db.execute('UPDATE suppliers SET status=? WHERE supplier_id=?', [req.body.status, req.params.id]);
    res.json({ success: true, message: `Supplier ${req.body.status === 'active' ? 'activated' : 'deactivated'}`, data: await find(req.params.id) });
  } catch (e) { next(e); }
};
// Hard delete is only allowed for suppliers with no purchase/batch history (so supplier history is never lost).
exports.remove = async (req, res, next) => {
  try {
    await find(req.params.id);
    const [[{ n }]] = await db.execute(`SELECT (SELECT COUNT(*) FROM purchases WHERE supplier_id=?) + (SELECT COUNT(*) FROM medicine_batches WHERE supplier_id=?) AS n`, [req.params.id, req.params.id]);
    if (n > 0) throw new AppError('Supplier has purchase/stock history and cannot be deleted. Deactivate it instead', 409);
    await db.execute('DELETE FROM suppliers WHERE supplier_id=?', [req.params.id]);
    res.json({ success: true, message: 'Supplier deleted' });
  } catch (e) { next(e); }
};
exports.purchases = async (req, res, next) => {
  try {
    await find(req.params.id);
    const [rows] = await db.execute(`SELECT p.purchase_id, p.purchase_date, p.invoice_number, p.total_amount, p.status, COUNT(pi.purchase_item_id) AS item_count
      FROM purchases p LEFT JOIN purchase_items pi ON pi.purchase_id = p.purchase_id
      WHERE p.supplier_id = ? GROUP BY p.purchase_id ORDER BY p.purchase_date DESC, p.purchase_id DESC LIMIT 100`, [req.params.id]);
    const [[t]] = await db.execute("SELECT COALESCE(SUM(total_amount),0) AS total_purchased, COUNT(*) AS confirmed_count FROM purchases WHERE supplier_id = ? AND status = 'Confirmed'", [req.params.id]);
    res.json({ success: true, data: rows, totals: { total_purchased: Number(t.total_purchased), confirmed_purchases: Number(t.confirmed_count) } });
  } catch (e) { next(e); }
};
// Medicines this supplier has supplied: via confirmed purchases and/or batches recorded against them.
exports.medicines = async (req, res, next) => {
  try {
    await find(req.params.id); const sid = req.params.id;
    const [rows] = await db.execute(`SELECT m.medicine_id, m.name, m.strength, m.dosage_form,
        (SELECT COUNT(*) FROM medicine_batches b WHERE b.medicine_id = m.medicine_id AND b.supplier_id = ?) AS batches,
        (SELECT COALESCE(SUM(b.quantity),0) FROM medicine_batches b WHERE b.medicine_id = m.medicine_id AND b.supplier_id = ?) AS quantity_in_stock,
        (SELECT COALESCE(SUM(pi.quantity),0) FROM purchase_items pi JOIN purchases p ON p.purchase_id = pi.purchase_id WHERE p.supplier_id = ? AND p.status = 'Confirmed' AND pi.medicine_id = m.medicine_id) AS total_purchased,
        COALESCE((SELECT MAX(p.purchase_date) FROM purchase_items pi JOIN purchases p ON p.purchase_id = pi.purchase_id WHERE p.supplier_id = ? AND p.status = 'Confirmed' AND pi.medicine_id = m.medicine_id),
                 (SELECT DATE(MAX(b.created_at)) FROM medicine_batches b WHERE b.medicine_id = m.medicine_id AND b.supplier_id = ?)) AS last_supplied
      FROM medicines m
      WHERE m.medicine_id IN (SELECT medicine_id FROM medicine_batches WHERE supplier_id = ?)
         OR m.medicine_id IN (SELECT pi.medicine_id FROM purchase_items pi JOIN purchases p ON p.purchase_id = pi.purchase_id WHERE p.supplier_id = ? AND p.status = 'Confirmed')
      ORDER BY m.name`, [sid, sid, sid, sid, sid, sid, sid]);
    res.json({ success: true, data: rows });
  } catch (e) { next(e); }
};
