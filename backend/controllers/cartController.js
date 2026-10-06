const db = require('../config/database');
const AppError = require('../utils/AppError');
const { STOCK_JOIN } = require('../services/inventoryService');

// Builds the cart view. Prices and stock are always read fresh from the DB (never trusted from the client).
async function buildCart(customerId) {
  const [rows] = await db.execute(
    `SELECT ci.medicine_id, ci.quantity, m.name, m.strength, m.dosage_form, m.manufacturer, m.mrp, m.selling_price AS unit_price, m.status,
            m.prescription_required, COALESCE(s.stock, 0) AS available
     FROM carts c JOIN cart_items ci ON ci.cart_id = c.cart_id JOIN medicines m ON m.medicine_id = ci.medicine_id ${STOCK_JOIN}
     WHERE c.customer_id = ? ORDER BY ci.cart_item_id`, [customerId]);
  let totalPaise = 0, count = 0;
  const items = rows.map(r => {
    const available = Number(r.available), pricePaise = Math.round(Number(r.unit_price) * 100), line = pricePaise * r.quantity;
    let issue = null;
    if (r.status !== 'active') issue = 'No longer available';
    else if (available === 0) issue = 'Out of stock';
    else if (r.quantity > available) issue = `Only ${available} available`;
    totalPaise += line; count += r.quantity;
    return { ...r, prescription_required: !!r.prescription_required, available, line_total: (line / 100).toFixed(2), issue };
  });
  return { items, item_count: count, subtotal: (totalPaise / 100).toFixed(2), total: (totalPaise / 100).toFixed(2),
    has_issues: items.some(i => i.issue), requires_prescription: items.some(i => i.prescription_required) };
}
const send = (res, cart, message, status = 200) => res.status(status).json({ success: true, message, data: cart });

// Checks rule 1 + 2 for a desired quantity.
async function assertCanHold(medicineId, qty, inCart = 0) {
  const [r] = await db.execute(`SELECT m.name, m.status, COALESCE(s.stock, 0) AS stock FROM medicines m ${STOCK_JOIN} WHERE m.medicine_id = ?`, [medicineId]);
  if (!r.length || r[0].status !== 'active') throw new AppError('This medicine is not available', 404);
  const stock = Number(r[0].stock);
  if (stock === 0) throw new AppError(`${r[0].name} is out of stock`, 409);
  if (qty > stock) throw new AppError(`Only ${stock} available${inCart ? ` (you already have ${inCart} in your cart)` : ''}`, 409);
}
const ensureCart = async (customerId) => {
  await db.execute('INSERT IGNORE INTO carts (customer_id) VALUES (?)', [customerId]);
  return (await db.execute('SELECT cart_id FROM carts WHERE customer_id = ?', [customerId]))[0][0].cart_id;
};

exports.get = async (req, res, next) => { try { send(res, await buildCart(req.user.user_id)); } catch (e) { next(e); } };

exports.add = async (req, res, next) => {
  try {
    const { medicine_id } = req.body, add = Number(req.body.quantity || 1), uid = req.user.user_id;
    const cartId = await ensureCart(uid);
    const [ex] = await db.execute('SELECT quantity FROM cart_items WHERE cart_id = ? AND medicine_id = ?', [cartId, medicine_id]);
    const have = ex.length ? ex[0].quantity : 0;
    await assertCanHold(medicine_id, have + add, have);
    await db.execute('INSERT INTO cart_items (cart_id, medicine_id, quantity) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantity = ?', [cartId, medicine_id, have + add, have + add]);
    send(res, await buildCart(uid), 'Added to cart', 201);
  } catch (e) { next(e); }
};

exports.setQuantity = async (req, res, next) => {
  try {
    const uid = req.user.user_id, qty = Number(req.body.quantity), mid = req.params.medicineId;
    const [r] = await db.execute('SELECT ci.cart_item_id FROM cart_items ci JOIN carts c ON c.cart_id = ci.cart_id WHERE c.customer_id = ? AND ci.medicine_id = ?', [uid, mid]);
    if (!r.length) throw new AppError('Item is not in your cart', 404);
    await assertCanHold(mid, qty);
    await db.execute('UPDATE cart_items SET quantity = ? WHERE cart_item_id = ?', [qty, r[0].cart_item_id]);
    send(res, await buildCart(uid), 'Quantity updated');
  } catch (e) { next(e); }
};

exports.remove = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    await db.execute('DELETE ci FROM cart_items ci JOIN carts c ON c.cart_id = ci.cart_id WHERE c.customer_id = ? AND ci.medicine_id = ?', [uid, req.params.medicineId]);
    send(res, await buildCart(uid), 'Removed from cart');
  } catch (e) { next(e); }
};

exports.clear = async (req, res, next) => {
  try {
    const uid = req.user.user_id;
    await db.execute('DELETE ci FROM cart_items ci JOIN carts c ON c.cart_id = ci.cart_id WHERE c.customer_id = ?', [uid]);
    send(res, await buildCart(uid), 'Cart cleared');
  } catch (e) { next(e); }
};
