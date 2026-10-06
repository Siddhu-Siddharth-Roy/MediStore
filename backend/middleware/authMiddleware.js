const jwt = require('jsonwebtoken');
const db = require('../config/database');
const AppError = require('../utils/AppError');

module.exports = async (req, res, next) => {
  try {
    const token = req.cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) throw new AppError('Authentication required', 401);
    let payload;
    try { payload = jwt.verify(token, process.env.JWT_SECRET); }
    catch { throw new AppError('Invalid or expired token', 401); }
    const [rows] = await db.execute('SELECT user_id, name, email, role, status FROM users WHERE user_id = ?', [payload.id]);
    if (!rows.length || rows[0].status !== 'active') throw new AppError('Account unavailable', 401);
    req.user = rows[0];
    next();
  } catch (e) { next(e); }
};
