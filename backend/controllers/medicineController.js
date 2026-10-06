const db = require('../config/database');
const AppError = require('../utils/AppError');
const { paginate, meta, like } = require('../utils/pagination');
const { expiryStatusSql } = require('../utils/expiry');

const isStaff = (req) => ['admin', 'pharmacist'].includes(req.user?.role);
// Stock that can actually be sold: batches that have not expired (expiry date itself is still valid).
const STOCK_JOIN = `LEFT JOIN (SELECT medicine_id, SUM(quantity) AS stock FROM medicine_batches
  WHERE expiry_date >= CURDATE() GROUP BY medicine_id) s ON s.medicine_id = m.medicine_id`;
const SELECT = `SELECT m.*, c.category_name, COALESCE(s.stock,0) AS stock_available
  FROM medicines m LEFT JOIN categories c ON c.category_id = m.category_id ${STOCK_JOIN}`;
const SORTS = { name: 'm.name', selling_price: 'm.selling_price', mrp: 'm.mrp', created_at: 'm.created_at', stock: 'stock_available' };
const FIELDS = ['name', 'generic_name', 'brand', 'category_id', 'manufacturer', 'description', 'dosage_form', 'strength', 'mrp', 'selling_price', 'prescription_required', 'status'];

const values = (b) => FIELDS.map(f => {
  if (f === 'prescription_required') return b[f] === true || b[f] === 'true' || b[f] === 1 || b[f] === '1' ? 1 : 0;
  if (f === 'status') return b[f] === 'inactive' ? 'inactive' : 'active';
  const v = b[f];
  return v === undefined || v === '' || v === null ? null : v;
});
const checkPrices = (b) => { if (Number(b.selling_price) > Number(b.mrp)) throw new AppError('Selling price cannot exceed MRP', 422); };

exports.list = async (req, res, next) => {
  try {
    const staff = isStaff(req), { page, limit, offset } = paginate(req, 12);
    const where = [], params = [];
    if (!staff) where.push("m.status = 'active'", 'COALESCE(s.stock,0) > 0'); // customers/public: active + in stock only
    else if (['active', 'inactive'].includes(req.query.status)) { where.push('m.status = ?'); params.push(req.query.status); }
    if (req.query.q) { where.push('(m.name LIKE ? OR m.generic_name LIKE ? OR m.brand LIKE ?)'); const l = like(req.query.q); params.push(l, l, l); }
    if (/^\d+$/.test(req.query.category_id || '')) { where.push('m.category_id = ?'); params.push(req.query.category_id); }
    if (req.query.manufacturer) { where.push('m.manufacturer = ?'); params.push(req.query.manufacturer); }
    if (['0', '1'].includes(req.query.prescription)) { where.push('m.prescription_required = ?'); params.push(req.query.prescription); }
    if (staff && req.query.stock === 'out') where.push('COALESCE(s.stock,0) = 0');
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const order = `${SORTS[req.query.sort] || 'm.name'} ${req.query.dir === 'desc' ? 'DESC' : 'ASC'}`;
    const [[{ total }]] = await db.execute(`SELECT COUNT(*) total FROM medicines m ${STOCK_JOIN} ${w}`, params);
    const [rows] = await db.execute(`${SELECT} ${w} ORDER BY ${order}, m.medicine_id LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ success: true, data: rows, pagination: meta(page, limit, total) });
  } catch (e) { next(e); }
};

exports.manufacturers = async (req, res, next) => {
  try {
    const [rows] = await db.execute("SELECT DISTINCT manufacturer FROM medicines WHERE manufacturer IS NOT NULL AND manufacturer <> '' " +
      (isStaff(req) ? '' : "AND status='active' ") + 'ORDER BY manufacturer');
    res.json({ success: true, data: rows.map(r => r.manufacturer) });
  } catch (e) { next(e); }
};

exports.get = async (req, res, next) => {
  try {
    const [rows] = await db.execute(`${SELECT} WHERE m.medicine_id = ?`, [req.params.id]);
    const m = rows[0];
    if (!m || (!isStaff(req) && (m.status !== 'active' || Number(m.stock_available) <= 0))) throw new AppError('Medicine not found', 404);
    if (isStaff(req)) { // batch-level detail is for staff only
      [m.batches] = await db.execute(`SELECT batch_id, batch_number, manufacturing_date, expiry_date, quantity, reorder_level, purchase_price, selling_price,
        ${expiryStatusSql()} AS expiry_status
        FROM medicine_batches WHERE medicine_id = ? ORDER BY expiry_date`, [m.medicine_id]);
    }
    res.json({ success: true, data: m });
  } catch (e) { next(e); }
};

exports.create = async (req, res, next) => {
  try {
    checkPrices(req.body);
    const [r] = await db.execute(`INSERT INTO medicines (${FIELDS.join(',')}) VALUES (${FIELDS.map(() => '?').join(',')})`, values(req.body));
    const [rows] = await db.execute(`${SELECT} WHERE m.medicine_id = ?`, [r.insertId]);
    res.status(201).json({ success: true, message: 'Medicine added', data: rows[0] });
  } catch (e) { next(e); }
};

exports.update = async (req, res, next) => {
  try {
    checkPrices(req.body);
    const [r] = await db.execute(`UPDATE medicines SET ${FIELDS.map(f => f + '=?').join(',')} WHERE medicine_id=?`, [...values(req.body), req.params.id]);
    if (!r.affectedRows) throw new AppError('Medicine not found', 404);
    const [rows] = await db.execute(`${SELECT} WHERE m.medicine_id = ?`, [req.params.id]);
    res.json({ success: true, message: 'Medicine updated', data: rows[0] });
  } catch (e) { next(e); }
};

// Medicines referenced by batches/orders must keep their history, so DELETE deactivates (soft delete).
exports.remove = async (req, res, next) => {
  try {
    const [r] = await db.execute("UPDATE medicines SET status='inactive' WHERE medicine_id=?", [req.params.id]);
    if (!r.affectedRows) throw new AppError('Medicine not found', 404);
    res.json({ success: true, message: 'Medicine deactivated' });
  } catch (e) { next(e); }
};
