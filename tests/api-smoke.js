// Usage: node tests/api-smoke.js   (server must be running; uses ADMIN_EMAIL / ADMIN_PASS or defaults)
// Creates throw-away records (prefixed "ZZ") and prints PASS/FAIL per check.
require('dotenv').config();
const db = require('../backend/config/database');
const BASE = process.env.BASE_URL || 'http://localhost:3000/api';
const ADMIN = [process.env.ADMIN_EMAIL || 'admin@medistore.com', process.env.ADMIN_PASS || 'StrongPass123'];
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
(async () => {
  const stamp = Date.now(), admin = client(), cust = client(), anon = client(), pharm = client();
  ok((await admin('POST', '/auth/login', { email: ADMIN[0], password: ADMIN[1] })).status === 200, 'admin login');
  ok((await admin('POST', '/auth/login', { email: ADMIN[0], password: 'wrong' })).status === 401, 'bad password rejected');

  // --- registration + validation
  ok((await anon('POST', '/auth/register', { name: 'x', email: 'bad', password: 'short' })).status === 422, 'register validation');
  const email = `zz${stamp}@test.com`;
  ok((await cust('POST', '/auth/register', { name: "ZZ O'Brien & Co", email, password: 'Passw0rdd' })).status === 201, 'customer register');
  ok((await cust('POST', '/auth/register', { name: 'dup', email, password: 'Passw0rdd' })).status === 409, 'duplicate email -> 409');
  await cust('POST', '/auth/login', { email, password: 'Passw0rdd' });

  // --- RBAC
  ok((await anon('GET', '/users')).status === 401, 'anonymous cannot list users');
  ok((await cust('GET', '/users')).status === 403, 'customer cannot list users');
  ok((await cust('POST', '/medicines', { name: 'x', mrp: 1, selling_price: 1 })).status === 403, 'customer cannot add medicine');
  ok((await cust('GET', '/suppliers')).status === 403, 'customer cannot view suppliers');
  ok((await anon('POST', '/categories', { category_name: 'x' })).status === 401, 'anonymous cannot add category');

  // --- own profile
  let r = await cust('GET', '/users/me'); ok(r.status === 200 && r.body.data.name === "ZZ O'Brien & Co", 'profile returns raw (unescaped) name');
  r = await cust('PUT', '/users/me', { name: 'ZZ Cust', email, phone: '9876543210' }); ok(r.status === 200 && r.body.data.phone === '9876543210', 'edit profile');
  ok((await cust('PUT', '/users/me/password', { current_password: 'nope', new_password: 'Newpass123' })).status === 400, 'change password: wrong current');
  ok((await cust('PUT', '/users/me/password', { current_password: 'Passw0rdd', new_password: 'Newpass123' })).status === 200, 'change password');
  ok((await client()('POST', '/auth/login', { email, password: 'Newpass123' })).status === 200, 'login with new password');

  // --- admin user management
  r = await admin('POST', '/users', { name: 'ZZ Pharma', email: `zzp${stamp}@test.com`, password: 'Pharma1234', role: 'pharmacist' });
  ok(r.status === 201 && r.body.data.role === 'pharmacist', 'admin creates pharmacist'); const pid = r.body.data.user_id;
  ok((await admin('POST', '/users', { name: 'bad', email: `b${stamp}@t.com`, password: 'Pharma1234', role: 'god' })).status === 422, 'invalid role rejected');
  r = await admin('GET', '/users?q=ZZ&role=pharmacist'); ok(r.body.data.length >= 1 && r.body.pagination.total >= 1, 'search + role filter');
  ok((await admin('PUT', `/users/${pid}`, { name: 'ZZ Pharma 2', email: `zzp${stamp}@test.com`, phone: '', role: 'pharmacist' })).status === 200, 'edit user');
  const me = (await admin('GET', '/users/me')).body.data;
  ok((await admin('PATCH', `/users/${me.user_id}/status`, { status: 'inactive' })).status === 400, 'admin cannot deactivate self');
  ok((await admin('DELETE', `/users/${me.user_id}`)).status === 400, 'admin cannot delete self');
  ok((await admin('PUT', `/users/${me.user_id}`, { name: me.name, email: me.email, role: 'customer' })).status === 400, 'admin cannot demote self');
  await pharm('POST', '/auth/login', { email: `zzp${stamp}@test.com`, password: 'Pharma1234' });
  ok((await pharm('GET', '/users')).status === 403, 'pharmacist cannot manage users');
  ok((await pharm('GET', '/users/me')).status === 200, 'pharmacist can view own profile');
  await admin('PATCH', `/users/${pid}/status`, { status: 'inactive' });
  ok((await pharm('GET', '/users/me')).status === 401, 'deactivated user is locked out immediately');
  ok((await client()('POST', '/auth/login', { email: `zzp${stamp}@test.com`, password: 'Pharma1234' })).status === 403, 'deactivated user cannot log in');
  ok((await admin('DELETE', `/users/${pid}`)).status === 200, 'delete user without history');

  // --- categories
  r = await admin('POST', '/categories', { category_name: 'ZZ Cat ' + stamp }); ok(r.status === 201, 'create category'); const cid = r.body.data.category_id;
  ok((await admin('POST', '/categories', { category_name: 'ZZ Cat ' + stamp })).status === 409, 'duplicate category -> 409');
  ok((await anon('GET', '/categories')).body.data.some(c => c.category_id === cid), 'categories are public');

  // --- medicines
  const med = { name: 'ZZ Paracetamol ' + stamp, generic_name: 'Paracetamol', brand: 'ZZBrand', category_id: cid, manufacturer: 'ZZ Pharma Ltd', dosage_form: 'Tablet', strength: '500mg', mrp: 30, selling_price: 25, prescription_required: false };
  ok((await admin('POST', '/medicines', { ...med, selling_price: 99 })).status === 422, 'selling price > MRP rejected');
  ok((await admin('POST', '/medicines', { ...med, category_id: 999999 })).status === 400, 'unknown category -> 400');
  r = await admin('POST', '/medicines', med); ok(r.status === 201, 'create medicine'); const mid = r.body.data.medicine_id;
  ok((await anon('GET', '/medicines?q=' + stamp)).body.data.length === 0, 'no stock => hidden from public');
  ok((await anon('GET', '/medicines/' + mid)).status === 404, 'no stock => detail 404 for public');
  ok((await admin('GET', '/medicines?q=' + stamp)).body.data.length === 1, 'staff see medicine without stock');
  // add batches directly (Phase 3 will add the API): one valid, one expired
  const [b1] = await db.execute('INSERT INTO medicine_batches (medicine_id,batch_number,expiry_date,purchase_price,selling_price,quantity) VALUES (?,?,DATE_ADD(CURDATE(),INTERVAL 200 DAY),20,25,40)', [mid, 'ZZ-OK']);
  await db.execute('INSERT INTO medicine_batches (medicine_id,batch_number,expiry_date,purchase_price,selling_price,quantity) VALUES (?,?,DATE_SUB(CURDATE(),INTERVAL 1 DAY),20,25,500)', [mid, 'ZZ-EXP']);
  r = await anon('GET', '/medicines?q=' + stamp); ok(r.body.data.length === 1 && Number(r.body.data[0].stock_available) === 40, 'public sees only non-expired stock (40, not 540)');
  r = await anon('GET', `/medicines?category_id=${cid}&manufacturer=${encodeURIComponent('ZZ Pharma Ltd')}&sort=selling_price&dir=desc`); ok(r.status === 200 && r.body.data.length === 1, 'category + manufacturer filter + sort');
  ok((await anon('GET', '/medicines?sort=name;DROP TABLE users')).status === 200, 'sort param is whitelisted (no SQL injection)');
  ok((await anon('GET', "/medicines?q=' OR 1=1 --")).body.data.length === 0, 'search is parameterized');
  r = await admin('GET', '/medicines/' + mid); ok(r.body.data.batches.length === 2 && r.body.data.batches.some(b => b.expiry_status === 'EXPIRED'), 'staff detail shows batches + EXPIRED status');
  ok(!(await anon('GET', '/medicines/' + mid)).body.data.batches, 'public detail hides batch data');
  ok((await admin('PUT', '/medicines/' + mid, { ...med, name: med.name + ' v2', prescription_required: true })).body.data.prescription_required === 1, 'edit medicine');
  ok((await admin('DELETE', '/medicines/' + mid)).status === 200, 'delete = deactivate');
  ok((await anon('GET', '/medicines/' + mid)).status === 404, 'inactive medicine hidden from public');
  ok((await admin('GET', '/medicines?status=inactive&q=' + stamp)).body.data.length === 1, 'staff can still list inactive');
  ok((await anon('GET', '/medicines/abc')).status === 422, 'bad id -> 422');

  // --- suppliers
  r = await admin('POST', '/suppliers', { supplier_name: 'ZZ Supplier', company_name: 'ZZ Co', phone: '9999999999', email: `s${stamp}@zz.com`, gst_number: '27ABCDE1234F1Z5' });
  ok(r.status === 201, 'create supplier'); const sid = r.body.data.supplier_id;
  ok((await admin('POST', '/suppliers', { supplier_name: 'ZZ', phone: 'abc' })).status === 422, 'supplier phone validated');
  ok((await admin('GET', '/suppliers?q=ZZ Supp')).body.data.length >= 1, 'search suppliers');
  ok((await admin('PATCH', `/suppliers/${sid}/status`, { status: 'inactive' })).body.data.status === 'inactive', 'deactivate supplier');
  await db.execute('UPDATE medicine_batches SET supplier_id=? WHERE batch_id=?', [sid, b1.insertId]);
  r = await admin('GET', `/suppliers/${sid}/medicines`); ok(r.body.data.length === 1 && Number(r.body.data[0].quantity_in_stock) === 40, 'medicines supplied by supplier');
  ok(Array.isArray((await admin('GET', `/suppliers/${sid}/purchases`)).body.data), 'supplier purchase history endpoint');
  ok((await admin('DELETE', `/suppliers/${sid}`)).status === 409, 'supplier with stock history cannot be hard-deleted');
  await db.execute('DELETE FROM medicine_batches WHERE medicine_id=?', [mid]);
  ok((await admin('DELETE', `/suppliers/${sid}`)).status === 200, 'supplier without history deleted');

  // --- cleanup
  await db.execute('DELETE FROM medicines WHERE medicine_id=?', [mid]);
  ok((await admin('DELETE', '/categories/' + cid)).status === 200, 'delete category');
  // 1. Delete the dependent orders first using a subquery
await db.query('DELETE FROM orders WHERE customer_id IN (SELECT user_id FROM users WHERE email LIKE "zz%@test.com")');

// 2. Now it is safe to delete the users (Line 106)
await db.query('DELETE FROM users WHERE email LIKE "zz%@test.com"');
  await db.execute('DELETE FROM users WHERE email LIKE "zz%@test.com"');
  console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
