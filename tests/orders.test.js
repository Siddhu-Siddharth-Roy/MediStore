// Phase 4 tests: cart, checkout, stock deduction, order status, cancellation, ownership, concurrency. Server must be running.
require('dotenv').config();
const db = require('../backend/config/database');
const BASE = process.env.BASE_URL || 'http://localhost:3000/api';
const ADMIN = [process.env.ADMIN_EMAIL || 'admin@medistore.com', process.env.ADMIN_PASS || 'Admin12345'];
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
}
const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const DELIV = { delivery_address: '12 Test Street, Pune 411001', delivery_phone: '9876543210' };

(async () => {
  const stamp = Date.now(), admin = client(), anon = client(), pharm = client();
  await admin('POST', '/auth/login', { email: ADMIN[0], password: ADMIN[1] });
  const newCustomer = async (i) => { const c = client(), email = `zzo${stamp}_${i}@test.com`; await c('POST', '/auth/register', { name: `ZZ Cust ${i}`, email, password: 'Passw0rdd' }); await c('POST', '/auth/login', { email, password: 'Passw0rdd' }); return c; };
  const c1 = await newCustomer(1), c2 = await newCustomer(2);
  await admin('POST', '/users', { name: 'ZZ Pharm', email: `zzop${stamp}@test.com`, password: 'Pharma1234', role: 'pharmacist' }); await pharm('POST', '/auth/login', { email: `zzop${stamp}@test.com`, password: 'Pharma1234' });
  const mids = [], mkMed = async (name, extra = {}) => { const r = await admin('POST', '/medicines', { name: `ZZ ${name} ${stamp}`, mrp: 50, selling_price: 40, ...extra }); mids.push(r.body.data.medicine_id); return r.body.data.medicine_id; };
  const mkBatch = async (mid, bn, qty, days, reorder = 1) => (await admin('POST', '/inventory/batches', { medicine_id: mid, batch_number: bn, quantity: qty, expiry_date: addDays(days), purchase_price: 10, selling_price: 40, reorder_level: reorder })).body.data.batch_id;
  const qtyOf = async (bid) => (await admin('GET', `/inventory/batches/${bid}`)).body.data.quantity;
  const stockOf = async (mid) => Number((await admin('GET', `/medicines/${mid}`)).body.data.stock_available);
  const orderCount = async (cid) => (await db.execute('SELECT COUNT(*) n FROM orders o JOIN users u ON u.user_id=o.customer_id WHERE u.email LIKE ?', [`zzo${stamp}_%`]))[0][0].n;

  // ---- fixtures: medicine A with an early + late batch and a big EXPIRED batch that must never be sold
  const A = await mkMed('Aspirin'); const early = await mkBatch(A, 'A-EARLY', 3, 30), late = await mkBatch(A, 'A-LATE', 10, 200);
  const [exp] = await db.execute('INSERT INTO medicine_batches (medicine_id,batch_number,expiry_date,purchase_price,selling_price,quantity,reorder_level) VALUES (?,?,DATE_SUB(CURDATE(),INTERVAL 5 DAY),1,40,50,1)', [A, 'A-EXPIRED']);
  const RX = await mkMed('Amoxil Rx', { prescription_required: true, selling_price: 20 }); await mkBatch(RX, 'RX-1', 10, 100);
  const NOSTOCK = await mkMed('NoStock'); const INACTIVE = await mkMed('Inactive', { status: 'inactive' }); await mkBatch(INACTIVE, 'IN-1', 5, 100);

  // ================= CART =================
  ok((await anon('GET', '/cart')).status === 401, 'anonymous cannot use cart');
  ok((await admin('GET', '/cart')).status === 403, 'staff cannot use customer cart');
  let r = await c1('GET', '/cart'); ok(r.status === 200 && r.body.data.items.length === 0 && r.body.data.total === '0.00', 'empty cart');
  ok((await c1('POST', '/cart/items', { medicine_id: 99999999, quantity: 1 })).status === 404, 'unknown medicine -> 404');
  ok((await c1('POST', '/cart/items', { medicine_id: INACTIVE, quantity: 1 })).status === 404, 'rule 1: inactive medicine cannot be added');
  ok((await c1('POST', '/cart/items', { medicine_id: NOSTOCK, quantity: 1 })).status === 409, 'medicine with no stock cannot be added');
  ok((await c1('POST', '/cart/items', { medicine_id: A, quantity: 14 })).status === 409, 'rule 2: cannot add more than sellable stock (13; the expired 50 do not count)');
  ok((await c1('POST', '/cart/items', { medicine_id: A, quantity: 0 })).status === 422 && (await c1('POST', '/cart/items', { medicine_id: A, quantity: 'x' })).status === 422, 'quantity validated');
  r = await c1('POST', '/cart/items', { medicine_id: A, quantity: 2, unit_price: 0.01, total: 1 }); ok(r.status === 201 && r.body.data.total === '80.00', 'add 2 => 80.00 (client-sent price ignored)');
  r = await c1('POST', '/cart/items', { medicine_id: A, quantity: 3 }); ok(r.body.data.items[0].quantity === 5 && r.body.data.total === '200.00' && r.body.data.item_count === 5, 'adding again accumulates (5 => 200.00)');
  ok((await c1('POST', '/cart/items', { medicine_id: A, quantity: 9 })).status === 409, 'accumulated quantity is checked against stock too');
  ok((await c1('PUT', `/cart/items/${A}`, { quantity: 20 })).status === 409, 'set quantity above stock rejected');
  r = await c1('PUT', `/cart/items/${A}`, { quantity: 4 }); ok(r.body.data.total === '160.00', 'set quantity 4 => 160.00');
  ok((await c1('PUT', `/cart/items/${NOSTOCK}`, { quantity: 1 })).status === 404, 'cannot edit item not in cart');
  ok((await c2('GET', '/cart')).body.data.items.length === 0, "carts are private: other customer's cart is empty");
  r = await c1('DELETE', `/cart/items/${A}`); ok(r.body.data.items.length === 0, 'remove item');
  await c1('POST', '/cart/items', { medicine_id: A, quantity: 1 }); r = await c1('DELETE', '/cart'); ok(r.body.data.items.length === 0, 'clear cart');

  // ================= CHECKOUT =================
  ok((await c1('POST', '/orders', DELIV)).status === 400, 'empty cart cannot be checked out');
  await c1('POST', '/cart/items', { medicine_id: A, quantity: 5 });
  ok((await c1('POST', '/orders', { ...DELIV, delivery_address: 'short' })).status === 422, 'address validated');
  ok((await c1('POST', '/orders', { ...DELIV, delivery_phone: 'abc' })).status === 422, 'phone validated');
  ok((await admin('POST', '/orders', DELIV)).status === 403, 'staff cannot place customer orders');
  ok((await anon('POST', '/orders', DELIV)).status === 401, 'anonymous cannot place orders');
  r = await c1('POST', '/orders', { ...DELIV, total_amount: 1, unit_price: 0.01, order_status: 'Delivered', customer_id: 1 });
  ok(r.status === 201 && r.body.data.total_amount === '200.00', 'rule 14: total computed on server (200.00), tampered fields ignored'); const o1 = r.body.data.order_id;
  r = await c1('GET', `/orders/${o1}`); ok(r.body.data.order_status === 'Pending' && r.body.data.customer_name === 'ZZ Cust 1', 'order is Pending and belongs to the caller (not customer_id 1)');
  ok(r.body.data.items.length === 1 && r.body.data.items[0].quantity === 5 && r.body.data.items[0].unit_price === '40.00' && r.body.data.items[0].subtotal === '200.00', 'order line: 5 x 40.00 = 200.00');
  ok(r.body.data.allocations === undefined && r.body.data.customer_email === undefined, 'customer view hides batch allocations and contact internals');
  r = await admin('GET', `/orders/${o1}`); const al = r.body.data.allocations;
  ok(al.length === 2 && al.find(a => a.batch_number === 'A-EARLY').quantity === 3 && al.find(a => a.batch_number === 'A-LATE').quantity === 2, 'FEFO: 3 taken from earliest-expiry batch, 2 from the next');
  ok(await qtyOf(early) === 0 && await qtyOf(late) === 8 && (await db.execute('SELECT quantity q FROM medicine_batches WHERE batch_id=?', [exp.insertId]))[0][0].q === 50, 'rule 4: stock deducted automatically; expired batch untouched');
  r = await admin('GET', `/inventory/transactions?type=SALE&medicine_id=${A}`); ok(r.body.data.length === 2 && r.body.data.every(t => t.reference_id === o1 && t.quantity < 0), 'rule 6: SALE movements recorded, referencing the order');
  ok((await c1('GET', '/cart')).body.data.items.length === 0, 'cart emptied after order');
  ok(r.body.data.reduce((a, t) => a + t.quantity, 0) === -5, 'SALE movements total -5');
  r = await c1('GET', '/notifications?limit=50'); ok(r.body.data.some(n => n.type === 'order_placed' && n.title.includes('#' + o1)), 'customer notified: order placed');
  ok((await admin('GET', '/notifications?limit=100')).body.data.some(n => n.type === 'new_order' && n.title.includes('#' + o1)), 'staff notified: new order');
  ok((await admin('GET', `/orders/${o1}`)).body.data.history.length === 1, 'status history starts with Pending');

  // ================= OWNERSHIP =================
  ok((await c2('GET', `/orders/${o1}`)).status === 404, "rule 9: customer cannot open someone else's order (404)");
  ok((await c2('GET', '/orders')).body.data.length === 0, "rule 9: customer list contains only own orders");
  ok((await c2('POST', `/orders/${o1}/cancel`, {})).status === 404, "customer cannot cancel someone else's order");
  ok((await c1('GET', '/orders')).body.data.some(o => o.order_id === o1), 'customer sees own order in list');
  r = await admin('GET', `/orders?q=${o1}`); ok(r.body.data.length === 1 && r.body.data[0].customer_name === 'ZZ Cust 1', 'rule 10: staff see all orders; search by order id');
  ok((await pharm('GET', '/orders?q=ZZ Cust 1')).body.data.length >= 1, 'pharmacist can search orders by customer name');
  ok((await c1('PUT', `/orders/${o1}/status`, { status: 'Confirmed' })).status === 403, 'customer cannot change status');

  // ================= SHORTAGE => FULL ROLLBACK =================
  await c1('POST', '/cart/items', { medicine_id: A, quantity: 8 }); // stock is 8
  await admin('POST', '/inventory/adjust', { batch_id: late, type: 'DAMAGED', quantity: 3, remarks: 'drop' }); // now 5
  const txBefore = (await admin('GET', '/inventory/transactions')).body.pagination.total, ordersBefore = await orderCount();
  r = await c1('POST', '/orders', DELIV); ok(r.status === 409 && /only 5/.test(r.body.message), 'stock vanished after adding to cart -> 409 with explanation: ' + r.body.message);
  ok(await qtyOf(late) === 5 && await orderCount() === ordersBefore && (await admin('GET', '/inventory/transactions')).body.pagination.total === txBefore, 'rollback: no order, no stock change, no movements');
  r = await c1('GET', '/cart'); ok(r.body.data.items[0].quantity === 8 && r.body.data.has_issues && r.body.data.items[0].issue === 'Only 5 available', 'cart kept and flags the problem');
  await c1('PUT', `/cart/items/${A}`, { quantity: 5 }); r = await c1('POST', '/orders', DELIV); ok(r.status === 201, 'fixing the cart lets the order through'); const o2 = r.body.data.order_id;
  ok(await qtyOf(late) === 0 && await stockOf(A) === 0, 'all sellable stock now sold (expired batch still not counted)');
  ok((await anon('GET', `/medicines?q=${stamp}`)).body.data.every(m => m.medicine_id !== A), 'sold-out medicine disappears from the public catalog');
  ok((await c2('POST', '/cart/items', { medicine_id: A, quantity: 1 })).status === 409, 'cannot add sold-out medicine to cart');

  // ================= CANCELLATION RESTORES STOCK =================
  r = await c1('POST', `/orders/${o2}/cancel`, { reason: 'Changed my mind' }); ok(r.status === 200, 'customer cancels Pending order');
  ok(await qtyOf(late) === 5 && await qtyOf(early) === 0, 'cancelled order restocked its batch (late back to 5)');
  r = await admin('GET', `/inventory/transactions?type=RETURN&medicine_id=${A}`); ok(r.body.data.length === 1 && r.body.data[0].quantity === 5 && r.body.data[0].reference_id === o2, 'RETURN movement recorded for the cancellation');
  ok((await c1('POST', `/orders/${o2}/cancel`, {})).status === 409, 'cannot cancel twice');
  ok((await admin('PUT', `/orders/${o2}/status`, { status: 'Confirmed' })).status === 409, 'cancelled order is terminal');
  ok((await admin('GET', '/notifications?limit=100')).body.data.some(n => n.type === 'order_cancelled' && n.title.includes('#' + o2)), 'staff notified of cancellation');
  ok((await c1('GET', '/notifications?limit=100')).body.data.some(n => n.type === 'order_cancelled' && /Changed my mind/.test(n.message)), 'customer notified of cancellation');
  const parallel = await Promise.all([c1('POST', `/orders/${o1}/cancel`, {}), c1('POST', `/orders/${o1}/cancel`, {})]);
  ok(parallel.map(x => x.status).sort().join() === '200,409', 'two simultaneous cancels: exactly one wins');
  ok(await qtyOf(early) === 3 && await qtyOf(late) === 7, 'stock restored exactly once (early 3, late 7)');

  // ================= STATUS MACHINE =================
  await c1('POST', '/cart/items', { medicine_id: A, quantity: 2 }); r = await c1('POST', '/orders', DELIV); const o3 = r.body.data.order_id;
  ok(await qtyOf(early) === 1, 'FEFO again: earliest batch used first (3 -> 1)');
  const st = (cl, id, status, note) => cl('PUT', `/orders/${id}/status`, { status, note });
  ok((await st(admin, o3, 'Delivered')).status === 409, 'cannot skip Pending -> Delivered');
  ok((await st(admin, o3, 'Bogus')).status === 422, 'unknown status rejected');
  ok((await st(pharm, o3, 'Confirmed')).status === 200, 'pharmacist confirms order');
  ok((await st(admin, o3, 'Confirmed')).status === 409, 'cannot repeat the same status');
  ok((await st(admin, o3, 'Pending')).status === 409, 'cannot go backwards');
  ok((await st(admin, o3, 'Processing')).status === 200, '-> Processing');
  r = await c1('POST', `/orders/${o3}/cancel`, {}); ok(r.status === 409 && /contact the store/.test(r.body.message), 'customer cannot cancel once Processing');
  ok((await st(admin, o3, 'Packed')).status === 200 && (await st(admin, o3, 'Dispatched')).status === 200, '-> Packed -> Dispatched');
  ok((await st(admin, o3, 'Cancelled')).status === 409, 'cannot cancel after Dispatched');
  ok((await st(admin, o3, 'Out for Delivery')).status === 200 && (await st(admin, o3, 'Delivered')).status === 200, '-> Out for Delivery -> Delivered');
  ok((await st(admin, o3, 'Cancelled')).status === 409 && (await st(admin, o3, 'Pending')).status === 409, 'Delivered is terminal');
  r = await c1('GET', `/orders/${o3}`); ok(r.body.data.history.map(h => h.status).join() === 'Pending,Confirmed,Processing,Packed,Dispatched,Out for Delivery,Delivered', 'timeline has every step in order');
  const types = (await c1('GET', '/notifications?limit=100')).body.data.map(n => n.type);
  ok(['order_confirmed', 'order_processing', 'order_packed', 'order_dispatched', 'order_out_for_delivery', 'order_delivered'].every(t => types.includes(t)), 'customer notified at every status change');
  ok(r.body.data.can_cancel === false && (await admin('GET', `/orders/${o3}`)).body.data.next_statuses.length === 0, 'delivered order: no cancel, no next status');
  await c1('POST', '/cart/items', { medicine_id: A, quantity: 1 }); const o4 = (await c1('POST', '/orders', DELIV)).body.data.order_id;
  await st(admin, o4, 'Confirmed'); await st(admin, o4, 'Processing'); const before = await stockOf(A);
  ok((await st(pharm, o4, 'Cancelled', 'Out of delivery area')).status === 200 && await stockOf(A) === before + 1, 'staff can cancel before dispatch; stock restored');
  ok((await c1('GET', '/notifications?limit=100')).body.data.some(n => n.type === 'order_cancelled' && /Out of delivery area/.test(n.message)), 'customer sees the staff-supplied reason');

  // ================= LISTS / FILTERS =================
  r = await admin('GET', '/orders?status=Delivered&q=ZZ Cust 1'); ok(r.body.data.length === 1 && r.body.data[0].order_id === o3, 'filter by status');
  r = await c1('GET', '/orders?status=active'); ok(r.body.data.length === 0, 'status=active hides delivered/cancelled');
  r = await c1('GET', '/orders?limit=2&page=1'); ok(r.body.data.length === 2 && r.body.pagination.total === 4, 'pagination (4 orders total for customer 1)');
  ok((await admin('GET', `/orders?from=${addDays(1)}`)).body.data.length === 0 && (await admin('GET', `/orders?from=${addDays(-1)}`)).body.data.length >= 4, 'filter by date');
  ok((await c1('GET', '/orders/abc')).status === 422, 'bad order id -> 422');

  // ================= PRESCRIPTIONS =================
  await c1('POST', '/cart/items', { medicine_id: RX, quantity: 1 });
  r = await c1('POST', '/orders', DELIV); ok(r.status === 422 && /prescription/i.test(r.body.message), 'prescription medicine requires confirmation');
  r = await c1('POST', '/orders', { ...DELIV, prescription_confirmed: true }); ok(r.status === 201 && (await c1('GET', `/orders/${r.body.data.order_id}`)).body.data.prescription_confirmed === true, 'prescription confirmed and stored on the order');

  // ================= EXPIRED / INACTIVE AT CHECKOUT =================
  const E = await mkMed('Expiring'); const eb = await mkBatch(E, 'E-1', 5, 30);
  await c1('POST', '/cart/items', { medicine_id: E, quantity: 2 });
  await db.execute('UPDATE medicine_batches SET expiry_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE batch_id = ?', [eb]);
  r = await c1('GET', '/cart'); ok(r.body.data.items.find(i => i.medicine_id === E).issue === 'Out of stock', 'cart flags item whose only batch just expired');
  r = await c1('POST', '/orders', DELIV); ok(r.status === 409 && await qtyOf(eb) === 5, 'rule 3: expired batch cannot be sold at checkout; stock untouched');
  await c1('DELETE', `/cart/items/${E}`); await c1('DELETE', `/cart/items/${RX}`);
  const F = await mkMed('Discontinued'); await mkBatch(F, 'F-1', 5, 100); await c1('POST', '/cart/items', { medicine_id: F, quantity: 1 });
  await admin('DELETE', `/medicines/${F}`);
  r = await c1('GET', '/cart'); ok(r.body.data.items[0].issue === 'No longer available', 'cart flags deactivated medicine');
  r = await c1('POST', '/orders', DELIV); ok(r.status === 409 && /No longer available/.test(r.body.message), 'rule 1: deactivated medicine blocks checkout');
  await c1('DELETE', '/cart');

  // ================= CONCURRENCY: 8 customers, 5 units =================
  const C = await mkMed('Limited'); const cb = await mkBatch(C, 'C-1', 5, 100);
  const crowd = await Promise.all(Array.from({ length: 8 }, (_, i) => newCustomer(10 + i)));
  for (const cl of crowd) await cl('POST', '/cart/items', { medicine_id: C, quantity: 1 });
  const res = await Promise.all(crowd.map(cl => cl('POST', '/orders', DELIV)));
  const won = res.filter(x => x.status === 201).length, lost = res.filter(x => x.status === 409).length;
  ok(won === 5 && lost === 3 && await qtyOf(cb) === 0, `8 simultaneous buyers, 5 units: ${won} orders succeeded, ${lost} rejected, stock ${await qtyOf(cb)} (never oversold)`);
  r = await admin('GET', `/inventory/transactions?type=SALE&batch_id=${cb}`); ok(r.body.pagination.total === 5 && r.body.data.reduce((a, t) => a + t.quantity, 0) === -5, 'exactly 5 SALE movements for the contested batch');
  ok(res.filter(x => x.status !== 201 && x.status !== 409).length === 0, 'no 500 errors / unhandled deadlocks under contention');

  // ================= LEDGER CONSISTENCY =================
  for (const [name, bid] of [['A-EARLY', early], ['A-LATE', late], ['C-1', cb], ['E-1', eb]]) {
    const [[row]] = await db.execute('SELECT (SELECT quantity FROM medicine_batches WHERE batch_id=?) q, (SELECT COALESCE(SUM(quantity),0) FROM inventory_transactions WHERE batch_id=?) s', [bid, bid]);
    ok(Number(row.q) === Number(row.s), `ledger matches stock for batch ${name} (${row.q} = ${row.s})`);
  }

  // ---- cleanup
  const uids = (await db.execute('SELECT user_id FROM users WHERE email LIKE ? OR email = ?', [`zzo${stamp}_%`, `zzop${stamp}@test.com`]))[0].map(u => u.user_id);
  if (uids.length) await db.query('DELETE FROM orders WHERE customer_id IN (?)', [uids]);
  await db.query('DELETE FROM inventory_transactions WHERE medicine_id IN (?)', [mids]);
  await db.query('DELETE FROM medicine_batches WHERE medicine_id IN (?)', [mids]);
  await db.query('DELETE FROM medicines WHERE medicine_id IN (?)', [mids]);
  await db.execute("DELETE FROM notifications WHERE title LIKE '%ZZ%' OR message LIKE '%ZZ%'");
  await db.execute('DELETE FROM users WHERE email LIKE ? OR email = ?', [`zzo${stamp}_%`, `zzop${stamp}@test.com`]);
  console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
