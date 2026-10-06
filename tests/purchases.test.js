// Phase 5 tests: purchase drafts, confirmation (auto stock increase), cancellation/reversal, supplier history, concurrency. Server must be running.
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

(async () => {
  const stamp = Date.now(), admin = client(), anon = client(), pharm = client(), cust = client(), pharm2 = client();
  await admin('POST', '/auth/login', { email: ADMIN[0], password: ADMIN[1] });
  const em = (k) => `zzq${stamp}_${k}@test.com`;
  await cust('POST', '/auth/register', { name: 'ZZ Buyer', email: em('c'), password: 'Passw0rdd' }); await cust('POST', '/auth/login', { email: em('c'), password: 'Passw0rdd' });
  for (const [cl, k] of [[pharm, 'p1'], [pharm2, 'p2']]) { await admin('POST', '/users', { name: 'ZZ Pharm ' + k, email: em(k), password: 'Pharma1234', role: 'pharmacist' }); await cl('POST', '/auth/login', { email: em(k), password: 'Pharma1234' }); }

  const mids = [], mkMed = async (name, extra = {}) => { const r = await admin('POST', '/medicines', { name: `ZZ ${name} ${stamp}`, mrp: 100, selling_price: 80, ...extra }); mids.push(r.body.data.medicine_id); return r.body.data.medicine_id; };
  const M1 = await mkMed('Paracetamol'), M2 = await mkMed('Ibuprofen'), M3 = await mkMed('Cetirizine', { mrp: 50, selling_price: 30 });
  let r = await admin('POST', '/suppliers', { supplier_name: 'ZZ Pharma Wholesale' }); const S = r.body.data.supplier_id;
  r = await admin('POST', '/suppliers', { supplier_name: 'ZZ Inactive Supplier' }); const SI = r.body.data.supplier_id; await admin('PATCH', `/suppliers/${SI}/status`, { status: 'inactive' });
  const line = (mid, bn, qty, price, extra = {}) => ({ medicine_id: mid, batch_number: bn, quantity: qty, purchase_price: price, expiry_date: addDays(365), manufacturing_date: addDays(-30), selling_price: 40, reorder_level: 5, ...extra });
  const batchOf = async (mid, bn) => (await db.execute('SELECT * FROM medicine_batches WHERE medicine_id=? AND batch_number=?', [mid, bn]))[0][0];
  const stockOf = async (mid) => Number((await admin('GET', `/medicines/${mid}`)).body.data.stock_available);
  const batchCount = async () => (await db.query('SELECT COUNT(*) n FROM medicine_batches WHERE medicine_id IN (?)', [mids]))[0][0].n;
  const txCount = async () => (await db.query('SELECT COUNT(*) n FROM inventory_transactions WHERE medicine_id IN (?)', [mids]))[0][0].n;

  // ===== access control
  const base = { supplier_id: S, items: [line(M1, 'P-1', 10, 50)] };
  ok((await anon('GET', '/purchases')).status === 401, 'anonymous cannot list purchases');
  ok((await cust('GET', '/purchases')).status === 403 && (await cust('POST', '/purchases', base)).status === 403, 'customer cannot view or create purchases');
  ok((await pharm('GET', '/purchases')).status === 200, 'pharmacist can view purchases');

  // ===== validation (nothing may be saved on failure)
  const b0 = await batchCount();
  const bad = async (patch, status, label) => { const x = await admin('POST', '/purchases', { ...base, ...patch }); ok(x.status === status, `${label} -> ${status} (got ${x.status}${x.status !== status ? ': ' + x.body.message : ''})`); return x; };
  await bad({ items: [] }, 422, 'no items');
  await bad({ supplier_id: 99999999 }, 404, 'unknown supplier');
  await bad({ supplier_id: SI }, 409, 'inactive supplier');
  await bad({ items: [line(M1, 'P-1', 0, 50)] }, 422, 'quantity 0');
  await bad({ items: [line(M1, 'P-1', 5, -1)] }, 422, 'negative price');
  await bad({ items: [line(M1, '', 5, 50)] }, 422, 'missing batch number');
  await bad({ items: [line(M1, 'P-1', 5, 50, { expiry_date: 'garbage' })] }, 422, 'invalid expiry date');
  await bad({ purchase_date: addDays(3) }, 422, 'future purchase date');
  await bad({ items: [line(99999999, 'P-1', 5, 50)] }, 422, 'unknown medicine');
  r = await bad({ items: [line(M1, 'P-1', 5, 50, { expiry_date: addDays(-1) })] }, 422, 'already-expired batch'); ok(r.body.errors && r.body.errors[0].field === 'items[0].expiry_date', 'error names the exact line field (items[0].expiry_date)');
  await bad({ items: [line(M1, 'P-1', 5, 50, { manufacturing_date: addDays(400) })] }, 422, 'manufacturing date after expiry');
  r = await bad({ items: [line(M1, 'P-1', 5, 50), line(M2, 'P-2', 5, 50, { selling_price: 500 })] }, 422, 'selling price above MRP'); ok(r.body.errors[0].field === 'items[1].selling_price', 'error points at line 2');
  await bad({ items: [line(M1, 'P-1', 5, 50), line(M1, 'p-1', 5, 50)] }, 422, 'same medicine + batch twice in one purchase');
  ok(await batchCount() === b0, 'failed validations created no batches');

  // ===== draft: no stock effect, totals computed on the server
  const tx0 = await txCount();
  r = await admin('POST', '/purchases', { supplier_id: S, invoice_number: 'INV-' + stamp, notes: 'first', total_amount: 1, items: [line(M1, 'P-1', 10, 19.99), line(M2, 'P-2', 3, 0.1, { selling_price: '' })] });
  ok(r.status === 201 && r.body.data.status === 'Draft', 'draft saved'); const P1 = r.body.data.purchase_id;
  r = await admin('GET', `/purchases/${P1}`); const d1 = r.body.data;
  ok(d1.total_amount === '199.90' + '' || d1.total_amount === '200.20', 'total computed on server: 10x19.99 + 3x0.10 = ' + d1.total_amount); ok(d1.total_amount === '200.20', 'exact decimal total 200.20 (no float drift)');
  ok(d1.status === 'Draft' && d1.created_by_name === 'Administrator' && d1.confirmed_by === null && d1.items.length === 2 && d1.units === 13, 'draft detail: creator recorded, 2 lines, 13 units');
  ok(d1.items.find(i => i.medicine_id === M2).selling_price === '80.00', "missing selling price defaults to the medicine's price");
  ok(await batchCount() === b0 && await txCount() === tx0 && await stockOf(M1) === 0, 'draft has NO effect on batches, movements or stock');

  // ===== edit draft
  r = await admin('PUT', `/purchases/${P1}`, { supplier_id: S, invoice_number: 'INV-' + stamp, items: [line(M1, 'P-1', 10, 20), line(M2, 'P-2', 5, 10)] });
  ok(r.status === 200, 'draft edited'); r = await admin('GET', `/purchases/${P1}`); ok(r.body.data.total_amount === '250.00' && r.body.data.items.length === 2, 'edit replaced items; total recalculated to 250.00');
  ok((await anon('PUT', `/purchases/${P1}`, base)).status === 401 && (await cust('PUT', `/purchases/${P1}`, base)).status === 403, 'only staff can edit');

  // ===== confirm => stock increases automatically
  ok((await cust('POST', `/purchases/${P1}/confirm`)).status === 403, 'customer cannot confirm');
  r = await pharm('POST', `/purchases/${P1}/confirm`); ok(r.status === 200 && r.body.data.units === 15 && r.body.data.total === '250.00', 'pharmacist confirms: ' + r.body.message);
  const b1 = await batchOf(M1, 'P-1'), b2 = await batchOf(M2, 'P-2');
  ok(b1.quantity === 10 && b2.quantity === 5 && b1.supplier_id === S && Number(b1.purchase_price) === 20 && b1.reorder_level === 5, 'rule 5: batches created with quantity, supplier, cost price and reorder level');
  r = await admin('GET', `/inventory/transactions?batch_id=${b1.batch_id}`); ok(r.body.data.length === 1 && r.body.data[0].transaction_type === 'PURCHASE' && r.body.data[0].quantity === 10 && r.body.data[0].reference_id === P1, 'rule 6: PURCHASE movement (+10) references the purchase');
  ok(/INV-/.test(r.body.data[0].remarks), 'movement remarks include the invoice number');
  r = await admin('GET', `/purchases/${P1}`); ok(r.body.data.status === 'Confirmed' && r.body.data.confirmed_by_name === 'ZZ Pharm p1' && r.body.data.confirmed_at && r.body.data.items.every(i => i.batch_id), 'confirmed: who/when recorded, items linked to batches');
  ok(await stockOf(M1) === 10, 'stock visible to customers/catalog immediately');
  ok((await anon('GET', `/medicines?q=${stamp}`)).body.data.some(m => m.medicine_id === M1), 'purchased medicine appears in the public catalog');
  ok((await pharm('PUT', `/purchases/${P1}`, base)).status === 409, 'confirmed purchase cannot be edited');
  ok((await pharm('POST', `/purchases/${P1}/confirm`)).status === 409, 'cannot confirm twice');
  ok(await stockOf(M1) === 10, 'stock not doubled by the rejected re-confirm');
  ok((await admin('GET', '/notifications?limit=100')).body.data.some(n => n.type === 'new_purchase' && n.title.includes('#' + P1)), 'staff notified of new purchase');
  ok(!(await pharm('GET', '/notifications?limit=100')).body.data.some(n => n.type === 'new_purchase' && n.title.includes('#' + P1)), 'confirming user is not notified about their own action');

  // ===== atomic create+confirm, top-up of an existing lot
  r = await admin('POST', '/purchases', { supplier_id: S, confirm: true, items: [line(M1, 'P-1', 7, 21, { selling_price: 70 }), line(M3, 'P-3', 4, 12, { selling_price: 40 })] });
  ok(r.status === 201 && r.body.data.status === 'Confirmed', 'create with confirm:true is applied in one step'); const P2 = r.body.data.purchase_id;
  ok((await batchOf(M1, 'P-1')).quantity === 17 && Number((await batchOf(M1, 'P-1')).selling_price) === 40, 'same lot (same batch no. + expiry): quantity topped up 10 -> 17, existing batch price kept');
  ok((await batchOf(M3, 'P-3')).quantity === 4, 'new lot created in the same purchase');
  r = await admin('GET', `/inventory/transactions?medicine_id=${M1}&type=PURCHASE`); ok(r.body.data.length === 2, 'two PURCHASE movements for the medicine');

  // ===== all-or-nothing confirmation
  r = await admin('POST', '/purchases', { supplier_id: S, items: [line(M2, 'P-9', 6, 10), line(M3, 'P-9', 6, 10)] }); const P3 = r.body.data.purchase_id;
  await admin('DELETE', `/medicines/${M3}`); // deactivate second medicine after the draft was saved
  const t1 = await txCount(), c1 = await batchCount();
  r = await admin('POST', `/purchases/${P3}/confirm`); ok(r.status === 422 && /inactive/.test(r.body.message), 'confirm re-validates: medicine deactivated since drafting -> rejected (' + r.body.message + ')');
  ok(await txCount() === t1 && await batchCount() === c1 && (await admin('GET', `/purchases/${P3}`)).body.data.status === 'Draft', 'rollback: line 1 was NOT applied either; purchase still Draft');
  await admin('PUT', `/medicines/${M3}`, { name: `ZZ Cetirizine ${stamp}`, mrp: 50, selling_price: 30, status: 'active' });
  await admin('PATCH', `/suppliers/${S}/status`, { status: 'inactive' });
  r = await admin('POST', `/purchases/${P3}/confirm`); ok(r.status === 409 && /inactive/.test(r.body.message), 'supplier deactivated since drafting -> confirm rejected');
  await admin('PATCH', `/suppliers/${S}/status`, { status: 'active' });
  await db.execute('UPDATE purchase_items SET expiry_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE purchase_id = ? AND batch_number = ? AND medicine_id = ?', [P3, 'P-9', M2]);
  r = await admin('POST', `/purchases/${P3}/confirm`); ok(r.status === 422 && /expired/.test(r.body.message), 'batch expired while draft was waiting -> confirm rejected');
  await db.execute('UPDATE purchase_items SET expiry_date = DATE_ADD(CURDATE(), INTERVAL 300 DAY) WHERE purchase_id = ?', [P3]);
  await db.execute("UPDATE purchase_items SET expiry_date = DATE_ADD(CURDATE(), INTERVAL 10 DAY) WHERE purchase_id = ? AND medicine_id = ?", [P3, M3]);
  // existing lot with a different expiry must be refused
  r = await admin('POST', '/purchases', { supplier_id: S, items: [line(M1, 'P-1', 5, 21, { expiry_date: addDays(500) })] }); const P4 = r.body.data.purchase_id;
  const q0 = (await batchOf(M1, 'P-1')).quantity;
  r = await admin('POST', `/purchases/${P4}/confirm`); ok(r.status === 409 && /already exists with expiry/.test(r.body.message) && (await batchOf(M1, 'P-1')).quantity === q0, 'same batch number but different expiry -> 409, stock unchanged');
  await admin('POST', `/purchases/${P4}/cancel`, {});
  r = await admin('POST', `/purchases/${P3}/confirm`); ok(r.status === 200, 'after fixing the problems the draft confirms fine');

  // ===== concurrency
  r = await admin('POST', '/purchases', { supplier_id: S, items: [line(M2, 'RACE-1', 20, 5)] }); const P5 = r.body.data.purchase_id; const bq = (await batchOf(M2, 'P-2')).quantity;
  const dbl = await Promise.all([admin('POST', `/purchases/${P5}/confirm`), pharm('POST', `/purchases/${P5}/confirm`), pharm2('POST', `/purchases/${P5}/confirm`)]);
  ok(dbl.map(x => x.status).sort().join() === '200,409,409' && (await batchOf(M2, 'RACE-1')).quantity === 20, 'three simultaneous confirms of one purchase: exactly one wins, stock added once (20)');
  const lot = { expiry_date: addDays(400) };
  const [da, db2] = [(await admin('POST', '/purchases', { supplier_id: S, items: [line(M3, 'LOT-X', 6, 5, lot)] })).body.data.purchase_id, (await admin('POST', '/purchases', { supplier_id: S, items: [line(M3, 'LOT-X', 9, 5, lot)] })).body.data.purchase_id];
  const two = await Promise.all([admin('POST', `/purchases/${da}/confirm`), pharm('POST', `/purchases/${db2}/confirm`)]);
  ok(two.every(x => x.status === 200) && (await batchOf(M3, 'LOT-X')).quantity === 15, 'two purchases of the same NEW lot confirmed at once: one batch, quantity 15 (no lost update, no duplicate)');
  ok((await db.execute('SELECT COUNT(*) n FROM medicine_batches WHERE medicine_id=? AND batch_number=?', [M3, 'LOT-X']))[0][0].n === 1, 'only one LOT-X batch row exists');

  // ===== sold stock + customer ordering from purchased stock
  const shopper = cust; await shopper('POST', '/cart/items', { medicine_id: M2, quantity: 3 });
  r = await shopper('POST', '/orders', { delivery_address: '12 Test Street, Pune 411001', delivery_phone: '9876543210' }); ok(r.status === 201, 'customer orders a medicine whose stock came from a purchase'); const OID = r.body.data.order_id;
  ok(Number((await db.execute('SELECT COALESCE(SUM(quantity),0) q FROM inventory_transactions WHERE medicine_id=? AND transaction_type=? AND reference_id=?', [M2, 'SALE', OID]))[0][0].q) === -3, 'sale deducted from purchased batches');

  // ===== cancellation
  r = await admin('POST', '/purchases', { supplier_id: S, items: [line(M1, 'C-1', 5, 9)] }); const D1 = r.body.data.purchase_id;
  ok((await pharm('POST', `/purchases/${D1}/cancel`, {})).status === 200 && (await admin('GET', `/purchases/${D1}`)).body.data.status === 'Cancelled', 'draft can be discarded (cancelled) by pharmacist');
  ok((await batchOf(M1, 'C-1')) === undefined, 'discarded draft created no batch');
  ok((await admin('POST', `/purchases/${D1}/confirm`)).status === 409 && (await admin('POST', `/purchases/${D1}/cancel`, {})).status === 409, 'cancelled purchase cannot be confirmed or cancelled again');
  ok((await pharm('POST', `/purchases/${P2}/cancel`, { reason: 'x' })).status === 403, 'pharmacist cannot cancel a CONFIRMED purchase (admin only)');
  ok((await admin('POST', `/purchases/${P2}/cancel`, {})).status === 422, 'cancelling a confirmed purchase requires a reason');
  // P3 had M2 'P-9' x6 and M3 'P-9' x6. Sell/adjust some of M3's units so reversal must fail atomically.
  await admin('POST', '/inventory/adjust', { batch_id: (await batchOf(M3, 'P-9')).batch_id, type: 'DAMAGED', quantity: 2, remarks: 'broken' });
  const m2b = (await batchOf(M2, 'P-9')).quantity;
  r = await admin('POST', `/purchases/${P3}/cancel`, { reason: 'wrong supplier' }); ok(r.status === 409 && /already been sold or adjusted/.test(r.body.message), 'cannot cancel when some purchased units are gone: ' + r.body.message);
  ok((await batchOf(M2, 'P-9')).quantity === m2b && (await admin('GET', `/purchases/${P3}`)).body.data.status === 'Confirmed', 'failed cancel reverses nothing (all-or-nothing)');
  const m1q = (await batchOf(M1, 'P-1')).quantity;
  r = await admin('POST', `/purchases/${P2}/cancel`, { reason: 'Supplier sent wrong goods' }); ok(r.status === 200, 'admin cancels a confirmed purchase');
  ok((await batchOf(M1, 'P-1')).quantity === m1q - 7 && (await batchOf(M3, 'P-3')).quantity === 0, 'stock reversed exactly (P-1: -7, P-3: -4 => 0)');
  r = await admin('GET', `/purchases/${P2}`); ok(r.body.data.status === 'Cancelled' && /wrong goods/.test(r.body.data.notes), 'reason stored on the purchase');
  ok((await admin('GET', '/notifications?limit=100')).body.data.some(n => n.type === 'purchase_cancelled') === false && (await pharm('GET', '/notifications?limit=100')).body.data.some(n => n.type === 'purchase_cancelled' && n.title.includes('#' + P2)), 'other staff notified of the cancellation');

  // ===== lists, filters, supplier history
  r = await admin('GET', `/purchases?supplier_id=${S}`); ok(r.body.data.length >= 5 && r.body.data.every(p => p.supplier_id === S), 'filter by supplier');
  ok((await admin('GET', `/purchases?supplier_id=${S}&status=Draft`)).body.data.every(p => p.status === 'Draft'), 'filter by status');
  ok((await admin('GET', `/purchases?q=INV-${stamp}`)).body.data.map(p => p.purchase_id).join() === String(P1), 'search by invoice number');
  ok((await admin('GET', `/purchases?q=${P1}`)).body.data.some(p => p.purchase_id === P1), 'search by purchase id');
  ok((await admin('GET', `/purchases?from=${addDays(1)}`)).body.data.length === 0 && (await admin('GET', `/purchases?from=${addDays(-1)}&supplier_id=${S}`)).body.data.length >= 5, 'filter by date');
  r = await admin('GET', `/purchases?supplier_id=${S}&limit=2&page=2`); ok(r.body.data.length === 2 && r.body.pagination.total >= 5, 'pagination');
  ok((await admin('GET', '/purchases/abc')).status === 422 && (await admin('GET', '/purchases/99999999')).status === 404, 'bad / unknown purchase id');
  r = await admin('GET', `/suppliers/${S}/purchases`); ok(r.body.data.some(p => p.purchase_id === P1 && p.invoice_number === 'INV-' + stamp) && r.body.totals.confirmed_purchases >= 3, 'rule 13: supplier purchase history lists purchases with invoice numbers');
  ok(r.body.totals.total_purchased > 0 && !r.body.data.find(p => p.purchase_id === P2 && p.status !== 'Cancelled'), 'supplier totals count confirmed purchases only; cancelled shown as cancelled');
  r = await admin('GET', `/suppliers/${S}/medicines`); const sm = r.body.data.find(m => m.medicine_id === M1);
  ok(sm && sm.total_purchased === '10' || sm && Number(sm.total_purchased) === 10, 'supplier medicines: total purchased counts confirmed purchases only (cancelled P2 excluded)');
  ok((await admin('DELETE', `/suppliers/${S}`)).status === 409, 'supplier with purchase history cannot be deleted');

  // ===== ledger consistency for every batch touched
  const [bs] = await db.query('SELECT b.batch_id, b.batch_number, b.quantity, COALESCE((SELECT SUM(quantity) FROM inventory_transactions t WHERE t.batch_id=b.batch_id),0) s FROM medicine_batches b WHERE b.medicine_id IN (?)', [mids]);
  ok(bs.length > 5 && bs.every(b => Number(b.quantity) === Number(b.s)), `ledger equals stock for all ${bs.length} batches: ` + bs.map(b => `${b.batch_number}=${b.quantity}`).join(' '));

  // ---- cleanup
  const uids = (await db.execute('SELECT user_id FROM users WHERE email LIKE ?', [`zzq${stamp}_%`]))[0].map(u => u.user_id);
  await db.query('DELETE FROM orders WHERE customer_id IN (?)', [uids]);
  await db.query('DELETE FROM purchases WHERE supplier_id IN (?)', [[S, SI]]);
  await db.query('DELETE FROM inventory_transactions WHERE medicine_id IN (?)', [mids]);
  await db.query('DELETE FROM medicine_batches WHERE medicine_id IN (?)', [mids]);
  await db.query('DELETE FROM medicines WHERE medicine_id IN (?)', [mids]);
  await db.query('DELETE FROM suppliers WHERE supplier_id IN (?)', [[S, SI]]);
  await db.execute("DELETE FROM notifications WHERE title LIKE '%ZZ%' OR message LIKE '%ZZ%'");
  await db.query('DELETE FROM users WHERE user_id IN (?)', [uids]);
  console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
