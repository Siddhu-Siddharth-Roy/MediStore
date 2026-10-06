const db = require('../config/database');
const AppError = require('../utils/AppError');
const { paginate, meta, like } = require('../utils/pagination');
const svc = require('../services/purchaseService');

exports.list = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req, 10), q = req.query, where = [], params = [];
    if (/^\d+$/.test(q.supplier_id || '')) { where.push('p.supplier_id = ?'); params.push(q.supplier_id); }
    if (['Draft', 'Confirmed', 'Cancelled'].includes(q.status)) { where.push('p.status = ?'); params.push(q.status); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { where.push('p.purchase_date >= ?'); params.push(q.from); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { where.push('p.purchase_date <= ?'); params.push(q.to); }
    if (q.q) { const l = like(q.q), id = /^#?(\d+)$/.exec(q.q.trim()); where.push(id ? '(p.purchase_id = ? OR s.supplier_name LIKE ? OR p.invoice_number LIKE ?)' : '(s.supplier_name LIKE ? OR p.invoice_number LIKE ? OR s.company_name LIKE ?)'); params.push(...(id ? [id[1], l, l] : [l, l, l])); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '', from = 'FROM purchases p JOIN suppliers s ON s.supplier_id = p.supplier_id';
    const [[{ total }]] = await db.execute(`SELECT COUNT(*) total ${from} ${w}`, params);
    const [rows] = await db.execute(`SELECT p.purchase_id, p.supplier_id, s.supplier_name, p.purchase_date, p.total_amount, p.status, p.invoice_number,
        (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = p.purchase_id) AS item_count, (SELECT COALESCE(SUM(quantity),0) FROM purchase_items WHERE purchase_id = p.purchase_id) AS units
      ${from} ${w} ORDER BY p.purchase_id DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ success: true, data: rows.map(r => ({ ...r, units: Number(r.units) })), pagination: meta(page, limit, total) });
  } catch (e) { next(e); }
};

exports.get = async (req, res, next) => {
  try {
    const [p] = await db.execute(`SELECT p.*, s.supplier_name, s.company_name, s.status AS supplier_status, cu.name AS created_by_name, ku.name AS confirmed_by_name
      FROM purchases p JOIN suppliers s ON s.supplier_id = p.supplier_id LEFT JOIN users cu ON cu.user_id = p.created_by LEFT JOIN users ku ON ku.user_id = p.confirmed_by WHERE p.purchase_id = ?`, [req.params.id]);
    if (!p.length) throw new AppError('Purchase not found', 404);
    const [items] = await db.execute(`SELECT pi.*, m.name AS medicine_name, m.strength, m.dosage_form, m.mrp FROM purchase_items pi JOIN medicines m ON m.medicine_id = pi.medicine_id
      WHERE pi.purchase_id = ? ORDER BY pi.purchase_item_id`, [req.params.id]);
    res.json({ success: true, data: { ...p[0], items, units: items.reduce((a, i) => a + i.quantity, 0) } });
  } catch (e) { next(e); }
};

const payload = (b) => ({ supplier_id: Number(b.supplier_id), purchase_date: b.purchase_date || null, invoice_number: b.invoice_number || null, notes: b.notes || null,
  items: b.items, confirm: b.confirm === true || b.confirm === 'true' });

exports.create = async (req, res, next) => {
  try {
    const r = await svc.create(req.user, payload(req.body));
    res.status(201).json({ success: true, message: r.confirmed ? `Purchase confirmed. ${r.confirmed.units} unit(s) added to stock` : 'Draft saved', data: { purchase_id: r.id, status: r.confirmed ? 'Confirmed' : 'Draft' } });
  } catch (e) { next(e); }
};
exports.update = async (req, res, next) => {
  try {
    const r = await svc.update(req.user, Number(req.params.id), payload(req.body));
    res.json({ success: true, message: r.confirmed ? `Purchase confirmed. ${r.confirmed.units} unit(s) added to stock` : 'Draft updated', data: { purchase_id: r.id, status: r.confirmed ? 'Confirmed' : 'Draft' } });
  } catch (e) { next(e); }
};
exports.confirm = async (req, res, next) => {
  try { const r = await svc.confirm(req.user, Number(req.params.id)); res.json({ success: true, message: `Purchase confirmed. ${r.units} unit(s) added to stock`, data: r }); } catch (e) { next(e); }
};
exports.cancel = async (req, res, next) => {
  try { const r = await svc.cancel(req.user, Number(req.params.id), req.body.reason); res.json({ success: true, message: r.was === 'Confirmed' ? 'Purchase cancelled and stock reversed' : 'Draft discarded' }); } catch (e) { next(e); }
};
