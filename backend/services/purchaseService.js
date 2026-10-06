// Purchases from suppliers. Lifecycle: Draft -> Confirmed (stock added) -> optionally Cancelled (stock reversed).
// Confirmation is ONE DB transaction: lock purchase, re-validate, create/top-up batches, add stock + PURCHASE movements, mark Confirmed.
// If any line fails, nothing is applied (rule 15).
const AppError = require('../utils/AppError');
const { withTransaction } = require('../utils/db');
const { changeStock } = require('./stockService');
const { notifyStaff, syncAlertsSoon } = require('./alertService');

const paise = (v) => Math.round(Number(v) * 100);
const money = (p) => (p / 100).toFixed(2);
const day = (d) => (d ? String(d).slice(0, 10) : null);

// Validates a purchase payload against the CURRENT state of suppliers/medicines and returns normalised items + total (computed here, never trusted from the client).
async function checkItems(conn, d, items) {
  const errs = [], add = (i, field, msg) => errs.push({ field: `items[${i}].${field}`, message: `Line ${i + 1}: ${msg}` });
  const [[{ today }]] = await conn.execute('SELECT CURDATE() AS today');
  const [sup] = await conn.execute('SELECT status FROM suppliers WHERE supplier_id = ?', [d.supplier_id]);
  if (!sup.length) throw new AppError('Supplier not found', 404);
  if (sup[0].status !== 'active') throw new AppError('Supplier is inactive. Activate the supplier before purchasing from them', 409);
  if (d.purchase_date && day(d.purchase_date) > today) throw new AppError('Purchase date cannot be in the future', 422, [{ field: 'purchase_date', message: 'Purchase date cannot be in the future' }]);

  const ids = [...new Set(items.map(i => Number(i.medicine_id)))];
  const [meds] = await conn.query('SELECT medicine_id, name, mrp, selling_price, status FROM medicines WHERE medicine_id IN (?)', [ids]);
  const byId = new Map(meds.map(m => [m.medicine_id, m]));
  const seen = new Set(); let totalPaise = 0, units = 0;
  const out = items.map((it, i) => {
    const m = byId.get(Number(it.medicine_id)), expiry = day(it.expiry_date), mfg = day(it.manufacturing_date), batchNo = String(it.batch_number || '').trim();
    if (!m) { add(i, 'medicine_id', 'medicine not found'); return null; }
    if (m.status !== 'active') add(i, 'medicine_id', `${m.name} is inactive. Reactivate it before purchasing`);
    if (expiry < today) add(i, 'expiry_date', `${m.name} batch ${batchNo} has already expired`);
    if (mfg && mfg > today) add(i, 'manufacturing_date', 'manufacturing date cannot be in the future');
    if (mfg && mfg >= expiry) add(i, 'expiry_date', 'expiry date must be after the manufacturing date');
    const selling = it.selling_price === undefined || it.selling_price === null || it.selling_price === '' ? Number(m.selling_price) : Number(it.selling_price);
    if (selling > Number(m.mrp)) add(i, 'selling_price', `selling price ${selling} exceeds MRP ${m.mrp} for ${m.name}`);
    const key = `${m.medicine_id}|${batchNo.toLowerCase()}`;
    if (seen.has(key)) add(i, 'batch_number', `${m.name} batch ${batchNo} appears twice in this purchase. Combine the quantities`);
    seen.add(key);
    const pp = paise(it.purchase_price), qty = Number(it.quantity);
    totalPaise += pp * qty; units += qty;
    return { medicine_id: m.medicine_id, name: m.name, batch_number: batchNo, manufacturing_date: mfg, expiry_date: expiry, quantity: qty,
      purchase_price: money(pp), selling_price: selling.toFixed(2), reorder_level: it.reorder_level === undefined || it.reorder_level === null || it.reorder_level === '' ? null : Number(it.reorder_level), subtotal: money(pp * qty) };
  });
  if (errs.length) throw new AppError(errs[0].message + (errs.length > 1 ? ` (and ${errs.length - 1} more)` : ''), 422, errs);
  return { items: out, total: money(totalPaise), units };
}

async function insertItems(conn, purchaseId, items) {
  for (const it of items) {
    await conn.execute(`INSERT INTO purchase_items (purchase_id, medicine_id, batch_number, manufacturing_date, expiry_date, quantity, purchase_price, selling_price, reorder_level, subtotal)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [purchaseId, it.medicine_id, it.batch_number, it.manufacturing_date, it.expiry_date, it.quantity, it.purchase_price, it.selling_price, it.reorder_level, it.subtotal]);
  }
}

async function lockDraft(conn, id) {
  const [p] = await conn.execute('SELECT * FROM purchases WHERE purchase_id = ? FOR UPDATE', [id]);
  if (!p.length) throw new AppError('Purchase not found', 404);
  return p[0];
}

async function confirmInTx(conn, user, id) {
  const p = await lockDraft(conn, id);
  if (p.status !== 'Draft') throw new AppError(`This purchase is already ${p.status.toLowerCase()}`, 409);
  const [rows] = await conn.execute('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY medicine_id, batch_number', [id]);
  if (!rows.length) throw new AppError('A purchase needs at least one item', 422);
  // Re-validate against today's reality: the supplier/medicine may have been deactivated or the batch expired since the draft was saved.
  const v = await checkItems(conn, { supplier_id: p.supplier_id, purchase_date: p.purchase_date }, rows);
  for (let i = 0; i < v.items.length; i++) {
    const it = v.items[i], row = rows[i];
    const [ex] = await conn.execute('SELECT batch_id, expiry_date FROM medicine_batches WHERE medicine_id = ? AND batch_number = ? FOR UPDATE', [it.medicine_id, it.batch_number]);
    let batchId;
    if (ex.length) { // same lot delivered again: top up the existing batch, but only if it is really the same lot (same expiry)
      if (day(ex[0].expiry_date) !== it.expiry_date) throw new AppError(`${it.name}: batch ${it.batch_number} already exists with expiry ${day(ex[0].expiry_date)}, but this purchase says ${it.expiry_date}. Check the batch number`, 409);
      batchId = ex[0].batch_id;
    } else {
      const [b] = await conn.execute(`INSERT INTO medicine_batches (medicine_id, supplier_id, batch_number, manufacturing_date, expiry_date, purchase_price, selling_price, quantity, reorder_level)
        VALUES (?,?,?,?,?,?,?,0,?)`, [it.medicine_id, p.supplier_id, it.batch_number, it.manufacturing_date, it.expiry_date, it.purchase_price, it.selling_price, it.reorder_level ?? 10]);
      batchId = b.insertId;
    }
    await changeStock(conn, { batchId, delta: it.quantity, type: 'PURCHASE', referenceId: id, remarks: `Purchase #${id}${p.invoice_number ? ' (invoice ' + p.invoice_number + ')' : ''}` });
    await conn.execute('UPDATE purchase_items SET batch_id = ?, selling_price = ? WHERE purchase_item_id = ?', [batchId, it.selling_price, row.purchase_item_id]);
  }
  await conn.execute("UPDATE purchases SET status = 'Confirmed', total_amount = ?, confirmed_by = ?, confirmed_at = NOW() WHERE purchase_id = ?", [v.total, user.user_id, id]);
  return { purchase_id: id, supplier_id: p.supplier_id, total: v.total, lines: v.items.length, units: v.units };
}

async function afterConfirm(user, r) {
  try {
    const [[s]] = await require('../config/database').execute('SELECT supplier_name FROM suppliers WHERE supplier_id = ?', [r.supplier_id]);
    await notifyStaff('new_purchase', `Purchase #${r.purchase_id} received`, `${user.name} confirmed purchase #${r.purchase_id} from ${s.supplier_name}: ${r.units} unit(s) across ${r.lines} line(s), ₹${r.total}. Stock updated.`, { dedupe: false, excludeUserId: user.user_id });
    syncAlertsSoon();
  } catch (e) { console.error('Purchase notification failed:', e.message); }
}

exports.create = async (user, d) => {
  const out = await withTransaction(async (conn) => {
    const v = await checkItems(conn, d, d.items);
    const [r] = await conn.execute('INSERT INTO purchases (supplier_id, total_amount, purchase_date, status, invoice_number, notes, created_by) VALUES (?,?,COALESCE(?, CURDATE()),?,?,?,?)',
      [d.supplier_id, v.total, d.purchase_date || null, 'Draft', d.invoice_number || null, d.notes || null, user.user_id]);
    await insertItems(conn, r.insertId, v.items);
    return { id: r.insertId, confirmed: d.confirm ? await confirmInTx(conn, user, r.insertId) : null };
  });
  if (out.confirmed) await afterConfirm(user, out.confirmed);
  return out;
};

exports.update = async (user, id, d) => {
  const out = await withTransaction(async (conn) => {
    const p = await lockDraft(conn, id);
    if (p.status !== 'Draft') throw new AppError(`Only draft purchases can be edited (this one is ${p.status.toLowerCase()})`, 409);
    const v = await checkItems(conn, d, d.items);
    await conn.execute('UPDATE purchases SET supplier_id = ?, total_amount = ?, purchase_date = COALESCE(?, purchase_date), invoice_number = ?, notes = ? WHERE purchase_id = ?',
      [d.supplier_id, v.total, d.purchase_date || null, d.invoice_number || null, d.notes || null, id]);
    await conn.execute('DELETE FROM purchase_items WHERE purchase_id = ?', [id]);
    await insertItems(conn, id, v.items);
    return { id, confirmed: d.confirm ? await confirmInTx(conn, user, id) : null };
  });
  if (out.confirmed) await afterConfirm(user, out.confirmed);
  return out;
};

exports.confirm = async (user, id) => {
  const r = await withTransaction(conn => confirmInTx(conn, user, id));
  await afterConfirm(user, r);
  return r;
};

// Draft: simply discarded. Confirmed: stock is reversed (admin only), allowed only if every purchased unit is still in stock.
exports.cancel = async (user, id, reason) => {
  const info = await withTransaction(async (conn) => {
    const p = await lockDraft(conn, id);
    if (p.status === 'Cancelled') throw new AppError('This purchase is already cancelled', 409);
    if (p.status === 'Confirmed') {
      if (user.role !== 'admin') throw new AppError('Only an admin can cancel a confirmed purchase', 403);
      if (!reason) throw new AppError('A reason is required to cancel a confirmed purchase', 422, [{ field: 'reason', message: 'A reason is required' }]);
      const [items] = await conn.execute('SELECT batch_id, quantity FROM purchase_items WHERE purchase_id = ? ORDER BY batch_id', [id]);
      for (const it of items) {
        try { await changeStock(conn, { batchId: it.batch_id, delta: -it.quantity, type: 'PURCHASE', referenceId: id, remarks: `Purchase #${id} cancelled (reversal)` }); }
        catch (e) { if (e.status === 409) throw new AppError(`Cannot cancel: ${e.message}. Some of these units have already been sold or adjusted`, 409); throw e; }
      }
    }
    const note = reason ? `Cancelled: ${String(reason).slice(0, 200)}` : null;
    await conn.execute("UPDATE purchases SET status = 'Cancelled', notes = LEFT(CONCAT_WS(' | ', notes, ?), 500) WHERE purchase_id = ?", [note, id]);
    return { was: p.status, supplier_id: p.supplier_id };
  });
  if (info.was === 'Confirmed') {
    try { await notifyStaff('purchase_cancelled', `Purchase #${id} cancelled`, `${user.name} cancelled confirmed purchase #${id}. Stock was reversed. Reason: ${reason}`, { dedupe: false, excludeUserId: user.user_id }); syncAlertsSoon(); } catch (e) { console.error(e.message); }
  }
  return info;
};
