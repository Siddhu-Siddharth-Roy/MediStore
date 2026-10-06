const db = require('../config/database');
const AppError = require('../utils/AppError');
const { paginate, meta, like } = require('../utils/pagination');
const orders = require('../services/orderService');

const isStaff = (u) => ['admin', 'pharmacist'].includes(u.role);

// Customers only ever see their own orders (rule 9); staff see all (rule 10).
exports.list = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req, 10), q = req.query, where = [], params = [];
    if (!isStaff(req.user)) { where.push('o.customer_id = ?'); params.push(req.user.user_id); }
    if (orders.STATUSES.includes(q.status)) { where.push('o.order_status = ?'); params.push(q.status); }
    if (q.status === 'active') where.push("o.order_status NOT IN ('Delivered','Cancelled')");
    if (isStaff(req.user) && q.q) {
      const l = like(q.q), id = /^#?(\d+)$/.exec(q.q.trim());
      where.push(id ? '(o.order_id = ? OR u.name LIKE ? OR u.email LIKE ?)' : '(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
      params.push(...(id ? [id[1], l, l] : [l, l, l]));
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { where.push('o.order_date >= ?'); params.push(q.from); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { where.push('o.order_date < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(q.to); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const from = 'FROM orders o JOIN users u ON u.user_id = o.customer_id';
    const [[{ total }]] = await db.execute(`SELECT COUNT(*) total ${from} ${w}`, params);
    const [rows] = await db.execute(`SELECT o.order_id, o.order_date, o.updated_at, o.total_amount, o.order_status, u.name AS customer_name,
        (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = o.order_id) AS item_count
      ${from} ${w} ORDER BY o.order_id DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ success: true, data: rows.map(r => ({ ...r, item_count: Number(r.item_count) })), pagination: meta(page, limit, total) });
  } catch (e) { next(e); }
};

exports.get = async (req, res, next) => {
  try {
    const staff = isStaff(req.user);
    const [o] = await db.execute(`SELECT o.*, u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
      FROM orders o JOIN users u ON u.user_id = o.customer_id WHERE o.order_id = ?${staff ? '' : ' AND o.customer_id = ?'}`, staff ? [req.params.id] : [req.params.id, req.user.user_id]);
    if (!o.length) throw new AppError('Order not found', 404); // same answer for "doesn't exist" and "not yours"
    const order = o[0];
    const [items] = await db.execute(`SELECT oi.medicine_id, m.name, m.strength, m.dosage_form, SUM(oi.quantity) AS quantity, oi.unit_price, SUM(oi.subtotal) AS subtotal
      FROM order_items oi JOIN medicines m ON m.medicine_id = oi.medicine_id WHERE oi.order_id = ? GROUP BY oi.medicine_id, oi.unit_price, m.name, m.strength, m.dosage_form ORDER BY m.name`, [order.order_id]);
    const [history] = await db.execute(`SELECT h.status, h.note, h.created_at, u.name AS changed_by_name FROM order_status_history h LEFT JOIN users u ON u.user_id = h.changed_by
      WHERE h.order_id = ? ORDER BY h.history_id`, [order.order_id]);
    if (!staff) history.forEach(h => delete h.changed_by_name);
    const data = { ...order, prescription_confirmed: !!order.prescription_confirmed, items: items.map(i => ({ ...i, quantity: Number(i.quantity) })), history };
    if (!staff) { delete data.customer_email; delete data.customer_phone; }
    data.can_cancel = staff ? orders.NEXT[order.order_status].includes('Cancelled') : orders.CUSTOMER_CAN_CANCEL.includes(order.order_status);
    if (staff) { // staff also see which batches the stock was taken from, and what they may do next
      [data.allocations] = await db.execute(`SELECT oi.batch_id, b.batch_number, b.expiry_date, m.name, oi.quantity FROM order_items oi
        JOIN medicine_batches b ON b.batch_id = oi.batch_id JOIN medicines m ON m.medicine_id = oi.medicine_id WHERE oi.order_id = ? ORDER BY m.name, b.expiry_date`, [order.order_id]);
      data.next_statuses = orders.NEXT[order.order_status].filter(s => s !== 'Cancelled');
    }
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

exports.place = async (req, res, next) => {
  try {
    const { delivery_address, delivery_phone, notes, prescription_confirmed } = req.body;
    const r = await orders.placeOrder(req.user, { delivery_address, delivery_phone, notes, prescription_confirmed: prescription_confirmed === true || prescription_confirmed === 'true' });
    res.status(201).json({ success: true, message: 'Order placed successfully', data: { order_id: r.orderId, total_amount: r.total } });
  } catch (e) { next(e); }
};

exports.updateStatus = async (req, res, next) => {
  try {
    const r = await orders.changeStatus(req.user, Number(req.params.id), req.body.status, req.body.note);
    res.json({ success: true, message: `Order is now ${r.to}`, data: r });
  } catch (e) { next(e); }
};

exports.cancelOwn = async (req, res, next) => {
  try {
    await orders.changeStatus(req.user, Number(req.params.id), 'Cancelled', req.body.reason || 'Cancelled by customer');
    res.json({ success: true, message: 'Order cancelled' });
  } catch (e) { next(e); }
};
