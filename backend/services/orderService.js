// Order placement and the order-status state machine. All stock movement goes through stockService.changeStock.
const AppError = require('../utils/AppError');
const { withTransaction } = require('../utils/db');
const { changeStock } = require('./stockService');
const { notifyStaff, notifyUser, syncAlertsSoon } = require('./alertService');

// Forward-only flow. Cancellation is possible until the parcel leaves the store (Dispatched).
const NEXT = {
  Pending: ['Confirmed', 'Cancelled'], Confirmed: ['Processing', 'Cancelled'], Processing: ['Packed', 'Cancelled'], Packed: ['Dispatched', 'Cancelled'],
  Dispatched: ['Out for Delivery'], 'Out for Delivery': ['Delivered'], Delivered: [], Cancelled: []
};
const CUSTOMER_CAN_CANCEL = ['Pending', 'Confirmed'];
exports.NEXT = NEXT;
exports.CUSTOMER_CAN_CANCEL = CUSTOMER_CAN_CANCEL;
exports.STATUSES = Object.keys(NEXT);

const MSG = {
  Confirmed: ['order_confirmed', 'has been confirmed'], Processing: ['order_processing', 'is being processed'], Packed: ['order_packed', 'has been packed'],
  Dispatched: ['order_dispatched', 'has been dispatched'], 'Out for Delivery': ['order_out_for_delivery', 'is out for delivery'],
  Delivered: ['order_delivered', 'has been delivered. Thank you for shopping with MediStore'], Cancelled: ['order_cancelled', 'has been cancelled']
};
const money = (paise) => (paise / 100).toFixed(2);

// ---------------------------------------------------------------------------------------------
// Place an order from the customer's cart. EVERYTHING happens in one DB transaction:
//   lock cart -> validate -> price on the server -> create order -> allocate stock first-expiry-first-out -> deduct stock -> clear cart.
// If anything fails (e.g. stock vanished), the whole thing rolls back: no order, stock untouched, cart intact.
// ---------------------------------------------------------------------------------------------
exports.placeOrder = async (user, d) => {
  const result = await withTransaction(async (conn) => {
    const [carts] = await conn.execute('SELECT cart_id FROM carts WHERE customer_id = ? FOR UPDATE', [user.user_id]);
    if (!carts.length) throw new AppError('Your cart is empty', 400);
    const [items] = await conn.execute(
      `SELECT ci.medicine_id, ci.quantity, m.name, m.strength, m.selling_price, m.status, m.prescription_required
       FROM cart_items ci JOIN medicines m ON m.medicine_id = ci.medicine_id WHERE ci.cart_id = ? ORDER BY ci.medicine_id`, [carts[0].cart_id]);
    if (!items.length) throw new AppError('Your cart is empty', 400);

    const inactive = items.filter(i => i.status !== 'active');
    if (inactive.length) throw new AppError(`No longer available: ${inactive.map(i => i.name).join(', ')}. Remove them from your cart to continue`, 409); // rule 1
    const rx = items.filter(i => i.prescription_required);
    if (rx.length && !d.prescription_confirmed) throw new AppError(`Please confirm you hold a valid prescription for: ${rx.map(i => i.name).join(', ')}`, 422);

    // Rule 14: totals come from DB prices, never from the client. Integer paise avoids floating-point drift.
    const lines = items.map(i => ({ ...i, pricePaise: Math.round(Number(i.selling_price) * 100) }));
    const totalPaise = lines.reduce((a, l) => a + l.pricePaise * l.quantity, 0);

    const [o] = await conn.execute(
      `INSERT INTO orders (customer_id, total_amount, order_status, delivery_address, delivery_phone, notes, prescription_confirmed) VALUES (?,?,?,?,?,?,?)`,
      [user.user_id, money(totalPaise), 'Pending', d.delivery_address, d.delivery_phone, d.notes || null, rx.length ? 1 : 0]);
    const orderId = o.insertId;
    await conn.execute('INSERT INTO order_status_history (order_id, status, changed_by, note) VALUES (?,?,?,?)', [orderId, 'Pending', user.user_id, 'Order placed']);

    const problems = [];
    for (const l of lines) {
      // Lock this medicine's sellable batches, earliest expiry first (FEFO). Expired batches are never selected (rule 3).
      const [batches] = await conn.execute(
        'SELECT batch_id, quantity FROM medicine_batches WHERE medicine_id = ? AND quantity > 0 AND expiry_date >= CURDATE() ORDER BY expiry_date, batch_id FOR UPDATE', [l.medicine_id]);
      const available = batches.reduce((a, b) => a + b.quantity, 0);
      if (available < l.quantity) { problems.push(`${l.name}: ${available > 0 ? 'only ' + available + ' in stock' : 'out of stock'}`); continue; } // rule 2
      let remaining = l.quantity;
      for (const b of batches) {
        if (!remaining) break;
        const take = Math.min(remaining, b.quantity);
        await changeStock(conn, { batchId: b.batch_id, delta: -take, type: 'SALE', referenceId: orderId, remarks: `Order #${orderId}` });
        await conn.execute('INSERT INTO order_items (order_id, medicine_id, batch_id, quantity, unit_price, subtotal) VALUES (?,?,?,?,?,?)',
          [orderId, l.medicine_id, b.batch_id, take, money(l.pricePaise), money(l.pricePaise * take)]);
        remaining -= take;
      }
    }
    if (problems.length) throw new AppError(`Not enough stock — ${problems.join('; ')}. Please update your cart`, 409);
    await conn.execute('DELETE FROM cart_items WHERE cart_id = ?', [carts[0].cart_id]);
    return { orderId, total: money(totalPaise) };
  });

  // After commit: notifications must never fail the order.
  try {
    await notifyUser(user.user_id, 'order_placed', `Order #${result.orderId} placed`, `Thank you! Your order #${result.orderId} (₹${result.total}) has been placed and is awaiting confirmation.`);
    await notifyStaff('new_order', `New order #${result.orderId}`, `${user.name} placed order #${result.orderId} worth ₹${result.total}.`, { dedupe: false });
    syncAlertsSoon();
  } catch (e) { console.error('Post-order notification failed:', e.message); }
  return result;
};

// ---------------------------------------------------------------------------------------------
// Change status. The order row is locked first, so two simultaneous changes (e.g. cancel + cancel) cannot both succeed.
// Cancelling returns every allocated unit to its original batch as a RETURN movement.
// ---------------------------------------------------------------------------------------------
exports.changeStatus = async (actor, orderId, newStatus, note) => {
  const out = await withTransaction(async (conn) => {
    const [rows] = await conn.execute('SELECT order_id, customer_id, order_status FROM orders WHERE order_id = ? FOR UPDATE', [orderId]);
    const o = rows[0];
    if (!o || (actor.role === 'customer' && o.customer_id !== actor.user_id)) throw new AppError('Order not found', 404); // rules 9/10: never reveal others' orders
    if (actor.role === 'customer') {
      if (newStatus !== 'Cancelled') throw new AppError('Customers can only cancel orders', 403);
      if (o.order_status === 'Cancelled') throw new AppError('This order is already cancelled', 409);
      if (!CUSTOMER_CAN_CANCEL.includes(o.order_status)) throw new AppError(`Your order is already ${o.order_status.toLowerCase()} and can no longer be cancelled online. Please contact the store`, 409);
    }
    if (!NEXT[o.order_status].includes(newStatus)) {
      throw new AppError(o.order_status === newStatus ? `Order is already ${newStatus}` : `Cannot change an order from ${o.order_status} to ${newStatus}`, 409);
    }
    if (newStatus === 'Cancelled') {
      const [alloc] = await conn.execute('SELECT batch_id, quantity FROM order_items WHERE order_id = ? ORDER BY batch_id', [orderId]);
      for (const a of alloc) await changeStock(conn, { batchId: a.batch_id, delta: a.quantity, type: 'RETURN', referenceId: orderId, remarks: `Order #${orderId} cancelled, stock restored`, allowExpired: true });
    }
    await conn.execute('UPDATE orders SET order_status = ? WHERE order_id = ?', [newStatus, orderId]);
    await conn.execute('INSERT INTO order_status_history (order_id, status, changed_by, note) VALUES (?,?,?,?)', [orderId, newStatus, actor.user_id, note ? String(note).slice(0, 255) : null]);
    return { customerId: o.customer_id, from: o.order_status };
  });

  try {
    const [type, text] = MSG[newStatus];
    await notifyUser(out.customerId, type, `Order #${orderId} ${newStatus === 'Out for Delivery' ? 'is out for delivery' : newStatus.toLowerCase()}`,
      `Your order #${orderId} ${text}.${newStatus === 'Cancelled' && note ? ' Reason: ' + note : ''}`);
    if (newStatus === 'Cancelled') {
      await notifyStaff('order_cancelled', `Order #${orderId} cancelled`, `Order #${orderId} was cancelled by ${actor.name} (${actor.role}). Stock has been restored.${note ? ' Reason: ' + note : ''}`, { dedupe: false, excludeUserId: actor.user_id });
      syncAlertsSoon();
    }
  } catch (e) { console.error('Status notification failed:', e.message); }
  return { from: out.from, to: newStatus };
};
