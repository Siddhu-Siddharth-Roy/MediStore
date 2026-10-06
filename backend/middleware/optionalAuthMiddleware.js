// Like authMiddleware, but anonymous visitors are allowed through (req.user stays undefined).
const jwt = require('jsonwebtoken');
const db = require('../config/database');
module.exports = async (req, res, next) => {
  try {
    const token = req.cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
    if (token) {
      const p = jwt.verify(token, process.env.JWT_SECRET);
      const [rows] = await db.execute('SELECT user_id, name, email, role, status FROM users WHERE user_id = ?', [p.id]);
      if (rows.length && rows[0].status === 'active') req.user = rows[0];
    }
  } catch { /* invalid/expired token => treat as anonymous */ }
  next();
};
