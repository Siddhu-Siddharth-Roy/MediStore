// Phase 3 tests: inventory, batches, adjustments, expiry, low-stock alerts, concurrency. Server must be running.
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
  const stamp = Date.now(), admin = client(), cust = client(), anon = client(), pharm = client();
  await admin('POST', '/auth/login', { email: ADMIN[0], password: ADMIN[1] });
  const cemail = `zzc${stamp}@test.com`, pemail = `zzp${stamp}@test.com`;
  await cust('POST', '/auth/register', { name: 'ZZ Cust', email: cemail, password: 'Passw0rdd' }); await cust('POST', '/auth/login', { email: cemail, password: 'Passw0rdd' });
  await admin('POST', '/users', { name: 'ZZ Pharm', email: pemail, password: 'Pharma1234', role: 'pharmacist' }); await pharm('POST', '/auth/login', { email: pemail, password: 'Pharma1234' });

  // setup
  let r = await admin('POST', '/medicines', { name: 'ZZ Stockmed ' + stamp, strength: '250mg', mrp: 50, selling_price: 40 }); const mid = r.body.data.medicine_id;
  r = await admin('POST', '/suppliers', { supplier_name: 'ZZ Inv Supplier' }); const sid = r.body.data.supplier_id;
  const batch = { medicine_id: mid, supplier_id: sid, batch_number: 'ZZ-A1', manufacturing_date: addDays(-30), expiry_date: addDays(200), purchase_price: 30, selling_price: 40, quantity: 100, reorder_level: 20 };

  // --- RBAC
  ok((await anon('GET', '/inventory')).status === 401, 'anonymous cannot view inventory');
  ok((await cust('GET', '/inventory')).status === 403, 'customer cannot view inventory');
  ok((await cust('POST', '/inventory/batches', batch)).status === 403, 'customer cannot add stock');
  ok((await cust('POST', '/inventory/adjust', { batch_id: 1, type: 'DAMAGED', quantity: 1, remarks: 'x' })).status === 403, 'customer cannot adjust stock');
  ok((await pharm('GET', '/inventory')).status === 200, 'pharmacist can view inventory');

  // --- add batch validation
  ok((await admin('POST', '/inventory/batches', { ...batch, quantity: 0 })).status === 422, 'quantity must be >= 1');
  ok((await admin('POST', '/inventory/batches', { ...batch, expiry_date: addDays(-1) })).status === 422, 'cannot add already-expired batch');
  ok((await admin('POST', '/inventory/batches', { ...batch, manufacturing_date: addDays(300) })).status === 422, 'mfg must be before expiry / not in future');
  ok((await admin('POST', '/inventory/batches', { ...batch, selling_price: 60 })).status === 422, 'batch price cannot exceed MRP');
  ok((await admin('POST', '/inventory/batches', { ...batch, expiry_date: 'not-a-date' })).status === 422, 'invalid date rejected');
  ok((await admin('POST', '/inventory/batches', { ...batch, medicine_id: 99999999 })).status === 404, 'unknown medicine -> 404');

  // --- add batch OK, creates a transaction
  r = await pharm('POST', '/inventory/batches', batch); ok(r.status === 201 && r.body.data.quantity === 100 && r.body.data.stock_status === 'IN_STOCK' && r.body.data.expiry_status === 'VALID', 'pharmacist adds batch (100, IN_STOCK, VALID)');
  const bid = r.body.data.batch_id;
  ok((await admin('POST', '/inventory/batches', batch)).status === 409, 'duplicate batch number -> 409');
  r = await admin('GET', `/inventory/transactions?batch_id=${bid}`); ok(r.body.data.length === 1 && r.body.data[0].quantity === 100 && r.body.data[0].transaction_type === 'ADJUSTMENT', 'opening stock recorded as a transaction');
  r = await anon('GET', `/medicines?q=${stamp}`); ok(r.body.data.length === 1 && Number(r.body.data[0].stock_available) === 100, 'customers now see the medicine with 100 in stock');

  // --- adjustments
  ok((await admin('POST', '/inventory/adjust', { batch_id: bid, type: 'DAMAGED', quantity: 5 })).status === 422, 'reason required');
  r = await admin('POST', '/inventory/adjust', { batch_id: bid, type: 'DAMAGED', quantity: 5, remarks: 'Broken strips' }); ok(r.status === 200 && r.body.data.quantity === 95, 'DAMAGED 5 => 95');
  r = await admin('POST', '/inventory/adjust', { batch_id: bid, type: 'RETURN', quantity: 2, remarks: 'Customer return' }); ok(r.body.data.quantity === 97, 'RETURN 2 => 97');
  r = await admin('POST', '/inventory/adjust', { batch_id: bid, type: 'ADJUSTMENT', quantity: -7, remarks: 'Stock count' }); ok(r.body.data.quantity === 90, 'ADJUSTMENT -7 => 90');
  r = await admin('POST', '/inventory/adjust', { batch_id: bid, type: 'ADJUSTMENT', quantity: 3, remarks: 'Stock count' }); ok(r.body.data.quantity === 93, 'ADJUSTMENT +3 => 93');
  ok((await admin('POST', '/inventory/adjust', { batch_id: bid, type: 'DAMAGED', quantity: 1000, remarks: 'too many' })).status === 409, 'cannot reduce below zero');
  ok((await admin('POST', '/inventory/adjust', { batch_id: bid, type: 'SALE', quantity: 1, remarks: 'x' })).status === 422, 'SALE cannot be entered manually');
  ok((await admin('POST', '/inventory/adjust', { batch_id: bid, type: 'ADJUSTMENT', quantity: 0, remarks: 'x' })).status === 422, 'zero quantity rejected');
  ok((await admin('GET', `/inventory/batches/${bid}`)).body.data.quantity === 93, 'quantity unchanged by failed attempts');
  r = await admin('GET', `/inventory/transactions?batch_id=${bid}`); const sum = r.body.data.reduce((a, t) => a + t.quantity, 0);
  ok(r.body.pagination.total === 5 && sum === 93, 'transaction history sums exactly to batch quantity (5 rows, sum 93)');
  ok((await admin('GET', `/inventory/transactions?batch_id=${bid}&type=DAMAGED`)).body.data.length === 1, 'filter history by type');
  ok((await admin('GET', `/inventory/transactions?batch_id=${bid}&from=${addDays(1)}`)).body.data.length === 0, 'filter history by date');
  ok(r.body.data.some(t => /by ZZ|by Administrator/.test(t.remarks || '')), 'remarks record who made the change');

  // --- edit batch
  r = await admin('PUT', `/inventory/batches/${bid}`, { ...batch, reorder_level: 50, expiry_date: addDays(40) }); ok(r.status === 200 && r.body.data.reorder_level === 50 && r.body.data.expiry_status === 'EXPIRING SOON', 'edit batch (reorder 50, now EXPIRING SOON)');

  // --- concurrency: batch with 5 units, 10 parallel single-unit removals => exactly 5 succeed, never negative
  r = await admin('POST', '/inventory/batches', { ...batch, batch_number: 'ZZ-RACE', quantity: 5, reorder_level: 1 }); const rid = r.body.data.batch_id;
  const results = await Promise.all(Array.from({ length: 10 }, () => admin('POST', '/inventory/adjust', { batch_id: rid, type: 'DAMAGED', quantity: 1, remarks: 'race' })));
  const good = results.filter(x => x.status === 200).length, bad = results.filter(x => x.status === 409).length;
  const final = (await admin('GET', `/inventory/batches/${rid}`)).body.data.quantity;
  ok(good === 5 && bad === 5 && final === 0, `concurrent removals: ${good} ok / ${bad} rejected, final qty ${final} (never negative)`);
  ok((await admin('GET', `/inventory/transactions?batch_id=${rid}`)).body.pagination.total === 6, 'exactly 1 opening + 5 removal transactions');

  // --- expiry
  const [ex] = await db.execute('INSERT INTO medicine_batches (medicine_id,batch_number,expiry_date,purchase_price,selling_price,quantity,reorder_level) VALUES (?,?,DATE_SUB(CURDATE(),INTERVAL 3 DAY),10,40,12,1)', [mid, 'ZZ-EXPIRED']);
  await db.execute('INSERT INTO medicine_batches (medicine_id,batch_number,expiry_date,purchase_price,selling_price,quantity,reorder_level) VALUES (?,?,DATE_ADD(CURDATE(),INTERVAL 75 DAY),10,40,4,1)', [mid, 'ZZ-75D']);
  r = await admin('GET', '/inventory/expired'); ok(r.body.data.some(b => b.batch_id === ex.insertId && b.expiry_status === 'EXPIRED' && b.days_to_expiry === -3), 'expired list includes expired batch (-3 days)');
  ok(r.body.totals.units >= 12 && r.body.totals.value_at_risk >= 120, 'expired totals report units and value at risk');
  const ids = async (d) => (await admin('GET', `/inventory/expiring?days=${d}`)).body.data.map(b => b.batch_number);
  ok((await ids(30)).includes('ZZ-A1') === false && (await ids(60)).includes('ZZ-75D') === false && (await ids(90)).includes('ZZ-75D'), 'expiring windows 30/60/90 are correct (75-day batch only in 90)');
  ok((await ids(30)).includes('ZZ-A1') === false, 'ZZ-A1 (expires in 40 days) not in 30-day window'); ok((await ids(60)).includes('ZZ-A1'), 'ZZ-A1 in 60-day window');
  ok(!(await ids(90)).includes('ZZ-EXPIRED'), 'expired batches are not listed as "expiring"');
  r = await anon('GET', `/medicines?q=${stamp}`); ok(r.body.data.length === 1 && Number(r.body.data[0].stock_available) === 97, 'public stock excludes the expired batch (93 + 4)');
  ok((await admin('POST', '/inventory/adjust', { batch_id: ex.insertId, type: 'RETURN', quantity: 1, remarks: 'x' })).status === 409, 'cannot add stock to an expired batch');
  r = await admin('GET', '/inventory?status=expired&q=' + stamp); ok(r.body.data.length === 1, 'inventory filter status=expired');
  r = await admin('GET', '/inventory?status=expiring&q=' + stamp); ok(r.body.data.length === 2, 'inventory filter status=expiring (40d + 75d batches)');
  r = await admin('GET', '/inventory?status=out&q=' + stamp); ok(r.body.data.length === 1 && r.body.data[0].batch_number === 'ZZ-RACE', 'inventory filter status=out');
  ok((await admin('GET', '/inventory?sort=quantity;DROP TABLE users&dir=desc')).status === 200, 'sort is whitelisted');

  // --- summary + low stock + alerts
  r = await admin('GET', '/inventory/summary'); ok(r.status === 200 && r.body.data.expired_batches >= 1 && r.body.data.expiring_90 >= 2 && r.body.data.expiring_90 >= r.body.data.expiring_60 && r.body.data.expiring_60 >= r.body.data.expiring_30, 'summary counts are cumulative and sane');
  await admin('POST', '/inventory/adjust', { batch_id: bid, type: 'ADJUSTMENT', quantity: -85, remarks: 'drop to 8' }); // sellable = 8+0+4 = 12 <= reorder 50
  r = await admin('GET', '/inventory/low-stock'); const low = r.body.data.find(x => x.medicine_id === mid); ok(low && low.stock_status === 'LOW_STOCK' && low.sellable === 12, 'low-stock list: sellable 12 (expired batch excluded)');
  const [d10] = await db.execute('INSERT INTO medicine_batches (medicine_id,batch_number,expiry_date,purchase_price,selling_price,quantity,reorder_level) VALUES (?,?,DATE_ADD(CURDATE(),INTERVAL 10 DAY),10,40,3,1)', [mid, 'ZZ-10D']);
  await admin('POST', '/inventory/sync-alerts'); await admin('POST', '/inventory/sync-alerts');
  let n = (await admin('GET', '/notifications?limit=100')).body;
  ok(n.data.filter(x => x.type === 'low_stock' && x.title.includes('ZZ Stockmed')).length === 1, 'low-stock alert generated once (second sync is de-duplicated)');
  ok(n.data.some(x => x.type === 'expired' && x.title.includes('ZZ-EXPIRED')), 'expired alert generated');
  ok(n.data.some(x => x.type === 'expiring_soon' && x.title.includes('ZZ-10D')), 'expiring-soon alert generated for batch expiring in 10 days');
  ok(!n.data.some(x => x.type === 'expiring_soon' && x.title.includes('ZZ-A1')), 'no expiring alert for batch 40 days out (alerts only within 30 days)');
  ok((await pharm('GET', '/notifications?limit=100')).body.data.some(x => x.type === 'low_stock'), 'pharmacist also receives alerts');
  ok((await cust('GET', '/notifications')).body.data.length === 0, 'customer receives no staff alerts');
  ok((await pharm('GET', '/notifications?limit=100')).body.data.some(x => x.type === 'stock_adjustment'), 'stock-adjustment notification sent to the OTHER staff member');
  ok(!n.data.some(x => x.type === 'stock_adjustment'), 'actor is not notified about their own adjustment');
  const first = n.data.find(x => x.type === 'low_stock');
  ok((await pharm('PUT', `/notifications/${first.notification_id}/read`)).status === 404, "cannot mark someone else's notification read");
  ok((await admin('PUT', `/notifications/${first.notification_id}/read`)).status === 200, 'mark own notification read');
  const before = n.unread_count; ok((await admin('PUT', '/notifications/read-all')).status === 200 && (await admin('GET', '/notifications')).body.unread_count === 0 && before > 0, 'mark all read');
  await admin('POST', '/inventory/adjust', { batch_id: bid, type: 'ADJUSTMENT', quantity: -8, remarks: 'drop to 0' }); await admin('POST', '/inventory/adjust', { batch_id: (await admin('GET', `/inventory?q=ZZ-75D`)).body.data[0].batch_id, type: 'DAMAGED', quantity: 4, remarks: 'gone' }); await admin('POST', '/inventory/adjust', { batch_id: d10.insertId, type: 'DAMAGED', quantity: 3, remarks: 'gone' });
  r = await admin('GET', '/inventory/low-stock?status=out'); ok(r.body.data.some(x => x.medicine_id === mid && x.stock_status === 'OUT_OF_STOCK'), 'medicine with only expired stock left is OUT_OF_STOCK');
  await admin('POST', '/inventory/sync-alerts');
  ok((await admin('GET', '/notifications?limit=100')).body.data.some(x => x.type === 'out_of_stock' && x.title.includes('ZZ Stockmed')), 'out-of-stock alert generated');

  // --- write-off expired
  ok((await cust('POST', '/inventory/write-off-expired')).status === 403, 'customer cannot write off');
  r = await admin('POST', '/inventory/write-off-expired'); ok(r.status === 200 && r.body.data.batches >= 1, 'write off expired: ' + r.body.message);
  ok((await admin('GET', `/inventory/batches/${ex.insertId}`)).body.data.quantity === 0, 'expired batch zeroed');
  ok((await admin('GET', `/inventory/transactions?batch_id=${ex.insertId}&type=EXPIRED`)).body.data.length === 1, 'EXPIRED transaction recorded');
  ok((await admin('POST', '/inventory/write-off-expired')).body.data.batches === 0, 'second write-off is a no-op');

  // --- stockService guards used by Phase 4/5
  const { changeStock } = require('../backend/services/stockService'); const { withTransaction } = require('../backend/utils/db');
  const [fresh] = await db.execute('INSERT INTO medicine_batches (medicine_id,batch_number,expiry_date,purchase_price,selling_price,quantity) VALUES (?,?,DATE_SUB(CURDATE(),INTERVAL 1 DAY),1,1,5)', [mid, 'ZZ-SALE-EXP']);
  let msg = ''; try { await withTransaction(c => changeStock(c, { batchId: fresh.insertId, delta: -1, type: 'SALE', referenceId: 1 })); } catch (e) { msg = e.message; }
  ok(/expired/.test(msg), 'service refuses to SELL an expired batch');
  let rolled = false; try { await withTransaction(async c => { await changeStock(c, { batchId: bid, delta: 1, type: 'PURCHASE' }); throw new Error('boom'); }); } catch { rolled = true; }
  ok(rolled && (await admin('GET', `/inventory/batches/${bid}`)).body.data.quantity === 0, 'failed transaction rolls back stock change');

  // --- cleanup
  await db.execute('DELETE FROM inventory_transactions WHERE medicine_id = ?', [mid]);
  await db.execute('DELETE FROM medicine_batches WHERE medicine_id = ?', [mid]);
  await db.execute('DELETE FROM medicines WHERE medicine_id = ?', [mid]);
  await db.execute('DELETE FROM suppliers WHERE supplier_id = ?', [sid]);
  await db.execute("DELETE FROM notifications WHERE title LIKE '%ZZ%' OR message LIKE '%ZZ Stockmed%'");
  await db.execute('DELETE FROM users WHERE email LIKE "zz%@test.com"');
  console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
