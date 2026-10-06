// Upgrades an existing database to the current schema (Phase 4 order columns + Phase 5 purchase columns). Safe to run repeatedly.
// Fresh installs don't need it (schema.sql already includes these changes).   Usage: node database/migrate.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../backend/config/database');

const COLUMNS = [
  ['orders', 'delivery_phone', 'VARCHAR(20) NULL AFTER delivery_address'],
  ['orders', 'notes', 'VARCHAR(500) NULL AFTER delivery_phone'],
  ['orders', 'prescription_confirmed', 'BOOLEAN NOT NULL DEFAULT FALSE AFTER notes'],
  // Phase 5
  ['purchases', 'invoice_number', 'VARCHAR(50) NULL'], ['purchases', 'notes', 'VARCHAR(500) NULL'], ['purchases', 'created_by', 'INT NULL'],
  ['purchases', 'confirmed_by', 'INT NULL'], ['purchases', 'confirmed_at', 'TIMESTAMP NULL'],
  ['purchase_items', 'batch_number', 'VARCHAR(50) NULL'], ['purchase_items', 'manufacturing_date', 'DATE NULL'], ['purchase_items', 'expiry_date', 'DATE NULL'],
  ['purchase_items', 'selling_price', 'DECIMAL(10,2) NULL'], ['purchase_items', 'reorder_level', 'INT NULL']
];
// [table, constraint name, DDL] - MySQL ignores inline REFERENCES, so foreign keys / indexes are added explicitly.
const CONSTRAINTS = [
  ['purchases', 'fk_purchases_created_by', 'ADD CONSTRAINT fk_purchases_created_by FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL'],
  ['purchases', 'fk_purchases_confirmed_by', 'ADD CONSTRAINT fk_purchases_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users(user_id) ON DELETE SET NULL'],
  ['purchases', 'idx_purchase_status', 'ADD INDEX idx_purchase_status (status)'],
  ['purchases', 'idx_purchase_date', 'ADD INDEX idx_purchase_date (purchase_date)'],
  ['purchase_items', 'uq_purchase_batch', 'ADD UNIQUE KEY uq_purchase_batch (purchase_id, medicine_id, batch_number)']
];
const HISTORY = `CREATE TABLE IF NOT EXISTS order_status_history (
  history_id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  status ENUM('Pending','Confirmed','Processing','Packed','Dispatched','Out for Delivery','Delivered','Cancelled') NOT NULL,
  changed_by INT NULL,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_osh_order (order_id)
)`;
(async () => {
  for (const [table, col, def] of COLUMNS) {
    const [r] = await db.execute('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, col]);
    if (r.length) { console.log(`skip   ${table}.${col} (exists)`); continue; }
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); console.log(`added  ${table}.${col}`);
  }
  for (const [table, name, ddl] of CONSTRAINTS) {
    const [r] = await db.execute(`SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
      UNION SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`, [table, name, table, name]);
    if (r.length) { console.log(`skip   ${table}.${name} (exists)`); continue; }
    await db.query(`ALTER TABLE ${table} ${ddl}`); console.log(`added  ${table}.${name}`);
  }
  await db.query(HISTORY); console.log('ok     order_status_history');
  // Orders that existed before this migration get a starting history row so their timeline isn't empty.
  const [n] = await db.query(`INSERT INTO order_status_history (order_id, status, note, created_at)
    SELECT o.order_id, o.order_status, 'Migrated', o.order_date FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.order_id)`);
  console.log(`backfilled ${n.affectedRows} order(s)`); process.exit(0);
})().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
