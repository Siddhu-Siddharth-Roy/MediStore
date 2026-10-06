// The ONLY place that changes batch quantities. Every change locks the batch row, refuses to go below zero,
// and writes an inventory_transactions row in the same DB transaction (business rules 4, 5, 6, 15).
// Phase 4 (orders) and Phase 5 (purchases) call changeStock with their own connection/transaction.
const AppError = require('../utils/AppError');

exports.TYPES = ['PURCHASE', 'SALE', 'RETURN', 'EXPIRED', 'DAMAGED', 'ADJUSTMENT'];

// allowExpiredIncrease: used when goods physically come back (cancelled order) into a batch that has since expired.
exports.changeStock = async (conn, { batchId, delta, type, referenceId = null, remarks = null, allowExpiredIncrease = false }) => {
  if (!exports.TYPES.includes(type)) throw new AppError('Invalid transaction type', 400);
  if (!Number.isInteger(delta) || delta === 0) throw new AppError('Quantity must be a non-zero whole number', 422);
  const [rows] = await conn.execute(
    'SELECT batch_id, medicine_id, batch_number, quantity, expiry_date, (expiry_date < CURDATE()) AS is_expired FROM medicine_batches WHERE batch_id = ? FOR UPDATE', [batchId]);
  if (!rows.length) throw new AppError('Batch not found', 404);
  const b = rows[0], after = b.quantity + delta;
  if (after < 0) throw new AppError(`Not enough stock in batch ${b.batch_number} (available: ${b.quantity})`, 409);
  if (type === 'SALE' && b.is_expired) throw new AppError(`Batch ${b.batch_number} has expired and cannot be sold`, 409);
  if (delta > 0 && b.is_expired && type !== 'PURCHASE' && !allowExpiredIncrease) throw new AppError(`Batch ${b.batch_number} has expired; stock cannot be added to it`, 409);
  await conn.execute('UPDATE medicine_batches SET quantity = ? WHERE batch_id = ?', [after, batchId]);
  const [t] = await conn.execute(
    'INSERT INTO inventory_transactions (medicine_id, batch_id, transaction_type, quantity, reference_id, remarks) VALUES (?,?,?,?,?,?)',
    [b.medicine_id, batchId, type, delta, referenceId, remarks ? String(remarks).slice(0, 255) : null]);
  return { transaction_id: t.insertId, medicine_id: b.medicine_id, batch_id: batchId, batch_number: b.batch_number, before: b.quantity, after };
};
