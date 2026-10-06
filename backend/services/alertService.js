// Generates staff notifications for low stock, out of stock, expired and soon-to-expire batches.
// syncAlerts() is idempotent: the same alert is not re-sent to a user within 24h (reminder while the problem persists).
const db = require('../config/database');
const { lowStockRows } = require('./inventoryService');

// Insert one notification per active staff user, skipping users who already got the same alert in the last 24h.
async function pushToStaff(type, title, message, { dedupe = true, excludeUserId = null } = {}) {
  await db.execute(
    `INSERT INTO notifications (user_id, title, message, type)
     SELECT u.user_id, ?, ?, ? FROM users u
     WHERE u.role IN ('admin','pharmacist') AND u.status = 'active' AND u.user_id <> ?
       AND (? = 0 OR NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.user_id AND n.type = ? AND n.title = ?
            AND n.created_at > NOW() - INTERVAL 1 DAY))`,
    [title.slice(0, 150), message, type, excludeUserId ?? 0, dedupe ? 1 : 0, type, title.slice(0, 150)]);
}
exports.notifyStaff = pushToStaff;
exports.notifyUser = (userId, type, title, message) =>
  db.execute('INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,?)', [userId, title.slice(0, 150), message, type]);
// One notification for one user (used for customer order updates). Never throws: a failed notification must not undo an order.
exports.notifyUser = async (userId, type, title, message) => {
  try { await db.execute('INSERT INTO notifications (user_id, title, message, type) VALUES (?,?,?,?)', [userId, title.slice(0, 150), message, type]); }
  catch (e) { console.error('notifyUser failed:', e.message); }
};

let running = false;
exports.syncAlerts = async () => {
  if (running) return; running = true;
  try {
    await db.execute('DELETE FROM notifications WHERE is_read = 1 AND created_at < NOW() - INTERVAL 90 DAY');
    for (const m of await lowStockRows()) {
      const label = `${m.name}${m.strength ? ' ' + m.strength : ''}`;
      if (m.stock_status === 'OUT_OF_STOCK') await pushToStaff('out_of_stock', `Out of stock: ${label}`, `${label} has no sellable stock left.`);
      else await pushToStaff('low_stock', `Low stock: ${label}`, `${label} has ${m.sellable} unit(s) left (reorder level ${m.reorder_level}).`);
    }
    const [batches] = await db.execute(
      `SELECT b.batch_number, b.expiry_date, b.quantity, m.name, DATEDIFF(b.expiry_date, CURDATE()) AS days
       FROM medicine_batches b JOIN medicines m ON m.medicine_id = b.medicine_id
       WHERE b.quantity > 0 AND b.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)`);
    for (const b of batches) {
      if (b.days < 0) await pushToStaff('expired', `Expired: ${b.name} (batch ${b.batch_number})`, `${b.quantity} unit(s) expired on ${b.expiry_date}. Remove from sale and write off.`);
      else await pushToStaff('expiring_soon', `Expiring soon: ${b.name} (batch ${b.batch_number})`, `${b.quantity} unit(s) expire on ${b.expiry_date} (${b.days} day(s) left).`);
    }
  } catch (e) { console.error('Alert sync failed:', e.message); }
  finally { running = false; }
};
// Fire-and-forget helper for request handlers: never delays or fails the response.
exports.syncAlertsSoon = () => { exports.syncAlerts().catch(() => {}); };
