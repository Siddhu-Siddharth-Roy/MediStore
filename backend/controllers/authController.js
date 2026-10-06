const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const AppError = require('../utils/AppError');

const sign = (u) => jwt.sign({ id: u.user_id, role: u.role }, process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '1d' });
const setCookie = (res, token) => res.cookie('token', token, {
  httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
  maxAge: 24 * 60 * 60 * 1000 });

exports.register = async (req, res, next) => {
  try {
    const { name, email, phone, password } = req.body;
    const [dup] = await db.execute('SELECT 1 FROM users WHERE email = ?', [email]);
    if (dup.length) throw new AppError('Email already registered', 409);
    const hash = await bcrypt.hash(password, 12);
    // Public registration always creates a customer; staff are created by Admin.
    const [r] = await db.execute(
      'INSERT INTO users (name, email, phone, password, role) VALUES (?,?,?,?,"customer")',
      [name, email, phone || null, hash]);
    res.status(201).json({ success: true, message: 'Registered successfully', data: { user_id: r.insertId } });
  } catch (e) { next(e); }
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
    const u = rows[0];
    if (!u || !(await bcrypt.compare(password, u.password))) throw new AppError('Invalid email or password', 401);
    if (u.status !== 'active') throw new AppError('Account is deactivated', 403);
    setCookie(res, sign(u));
    res.json({ success: true, data: { user_id: u.user_id, name: u.name, email: u.email, role: u.role } });
  } catch (e) { next(e); }
};

exports.logout = (req, res) => { res.clearCookie('token'); res.json({ success: true, message: 'Logged out' }); };
exports.me = (req, res) => res.json({ success: true, data: req.user });
