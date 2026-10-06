const pool = require('../config/database');
// Runs fn(conn) inside a transaction: commit on success, rollback on any error.
// Concurrent orders can occasionally deadlock on stock rows; MySQL aborts one side, so we simply retry it (max 3 attempts).
exports.withTransaction = async (fn) => {
  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (e) {
      await conn.rollback().catch(() => {});
      if (e.code === 'ER_LOCK_DEADLOCK' && attempt < 3) continue;
      throw e;
    } finally { conn.release(); }
  }
};
