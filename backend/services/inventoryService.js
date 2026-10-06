const db = require('../config/database');

// Sellable stock per medicine = units in non-expired batches. Reorder level = highest reorder level set on its batches.
exports.sellableStockSql = 'SUM(CASE WHEN b.expiry_date >= CURDATE() THEN b.quantity ELSE 0 END)';

// Active medicines that have been stocked before and are now at/below reorder level (or at zero).
exports.lowStockRows = async () => {
  const [rows] = await db.execute(
    `SELECT m.medicine_id, m.name, m.strength, m.dosage_form, m.manufacturer,
            ${exports.sellableStockSql} AS sellable, MAX(b.reorder_level) AS reorder_level,
            CASE WHEN ${exports.sellableStockSql} = 0 THEN 'OUT_OF_STOCK' ELSE 'LOW_STOCK' END AS stock_status
     FROM medicines m JOIN medicine_batches b ON b.medicine_id = m.medicine_id
     WHERE m.status = 'active'
     GROUP BY m.medicine_id
     HAVING sellable <= reorder_level
     ORDER BY sellable ASC, m.name`);
  return rows.map(r => ({ ...r, sellable: Number(r.sellable), reorder_level: Number(r.reorder_level) }));
};

// Join that exposes s.stock = sellable (non-expired) units per medicine. Use with alias m for medicines.
exports.STOCK_JOIN = `LEFT JOIN (SELECT medicine_id, SUM(quantity) AS stock FROM medicine_batches
  WHERE expiry_date >= CURDATE() GROUP BY medicine_id) s ON s.medicine_id = m.medicine_id`;

// Headline inventory numbers (used by the inventory page tiles and the dashboard).
exports.getSummary = async () => {
  const [[s]] = await db.execute(`SELECT
      COALESCE(SUM(CASE WHEN expiry_date >= CURDATE() THEN quantity END),0) AS sellable_units,
      COALESCE(SUM(CASE WHEN expiry_date >= CURDATE() THEN quantity * purchase_price END),0) AS stock_value,
      COALESCE(SUM(CASE WHEN expiry_date < CURDATE() AND quantity > 0 THEN 1 END),0) AS expired_batches,
      COALESCE(SUM(CASE WHEN expiry_date < CURDATE() THEN quantity END),0) AS expired_units,
      COALESCE(SUM(CASE WHEN expiry_date < CURDATE() THEN quantity * purchase_price END),0) AS expired_value,
      COALESCE(SUM(CASE WHEN quantity > 0 AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 1 END),0) AS expiring_30,
      COALESCE(SUM(CASE WHEN quantity > 0 AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 60 DAY) THEN 1 END),0) AS expiring_60,
      COALESCE(SUM(CASE WHEN quantity > 0 AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY) THEN 1 END),0) AS expiring_90,
      COUNT(*) AS total_batches FROM medicine_batches`);
  const low = await exports.lowStockRows();
  return { ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)])),
    low_stock_medicines: low.filter(r => r.stock_status === 'LOW_STOCK').length, out_of_stock_medicines: low.filter(r => r.stock_status === 'OUT_OF_STOCK').length };
};
