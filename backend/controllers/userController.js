const bcrypt = require('bcrypt');
const db = require('../config/database');
const AppError = require('../utils/AppError');
const { paginate, meta, like } = require('../utils/pagination');

const COLS = 'user_id, name, email, phone, role, status, created_at, updated_at';
const findUser = async (id) => {
  const [r] = await db.execute(`SELECT ${COLS} FROM users WHERE user_id = ?`, [id]);
  if (!r.length) throw new AppError('User not found', 404);
  return r[0];
};
const notSelf = (req, msg) => { if (Number(req.params.id) === req.user.user_id) throw new AppError(msg, 400); };

// ---------- Own profile (any logged-in role) ----------
exports.getMe = async (req, res, next) => { try { res.json({ success: true, data: await findUser(req.user.user_id) }); } catch (e) { next(e); } };

exports.updateMe = async (req, res, next) => {
  try {
    const { name, email, phone } = req.body;
    const [dup] = await db.execute('SELECT 1 FROM users WHERE email = ? AND user_id <> ?', [email, req.user.user_id]);
    if (dup.length) throw new AppError('Email already in use', 409);
    await db.execute('UPDATE users SET name=?, email=?, phone=? WHERE user_id=?', [name, email, phone || null, req.user.user_id]);
    res.json({ success: true, message: 'Profile updated', data: await findUser(req.user.user_id) });
  } catch (e) { next(e); }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    const [r] = await db.execute('SELECT password FROM users WHERE user_id = ?', [req.user.user_id]);
    if (!(await bcrypt.compare(current_password, r[0].password))) throw new AppError('Current password is incorrect', 400);
    if (current_password === new_password) throw new AppError('New password must differ from the current one', 400);
    await db.execute('UPDATE users SET password=? WHERE user_id=?', [await bcrypt.hash(new_password, 12), req.user.user_id]);
    res.json({ success: true, message: 'Password changed' });
  } catch (e) { next(e); }
};

// ---------- Admin user management ----------
exports.list = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req);
    const where = [], params = [];
    if (req.query.q) { where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)'); const l = like(req.query.q); params.push(l, l, l); }
    if (['admin', 'pharmacist', 'customer'].includes(req.query.role)) { where.push('role = ?'); params.push(req.query.role); }
    if (['active', 'inactive'].includes(req.query.status)) { where.push('status = ?'); params.push(req.query.status); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [[{ total }]] = await db.execute(`SELECT COUNT(*) total FROM users ${w}`, params);
    const [rows] = await db.execute(`SELECT ${COLS} FROM users ${w} ORDER BY created_at DESC, user_id DESC LIMIT ${limit} OFFSET ${offset}`, params);
    res.json({ success: true, data: rows, pagination: meta(page, limit, total) });
  } catch (e) { next(e); }
};

exports.get = async (req, res, next) => { try { res.json({ success: true, data: await findUser(req.params.id) }); } catch (e) { next(e); } };

exports.create = async (req, res, next) => {
  try {
    const { name, email, phone, password, role } = req.body;
    const [dup] = await db.execute('SELECT 1 FROM users WHERE email = ?', [email]);
    if (dup.length) throw new AppError('Email already registered', 409);
    const [r] = await db.execute('INSERT INTO users (name,email,phone,password,role) VALUES (?,?,?,?,?)',
      [name, email, phone || null, await bcrypt.hash(password, 12), role]);
    res.status(201).json({ success: true, message: 'User created', data: await findUser(r.insertId) });
  } catch (e) { next(e); }
};

exports.update = async (req, res, next) => {
  try {
    const cur = await findUser(req.params.id);
    const { name, email, phone, role, password } = req.body;
    if (role !== cur.role) notSelf(req, 'You cannot change your own role');
    const [dup] = await db.execute('SELECT 1 FROM users WHERE email = ? AND user_id <> ?', [email, cur.user_id]);
    if (dup.length) throw new AppError('Email already in use', 409);
    await db.execute('UPDATE users SET name=?, email=?, phone=?, role=? WHERE user_id=?', [name, email, phone || null, role, cur.user_id]);
    if (password) await db.execute('UPDATE users SET password=? WHERE user_id=?', [await bcrypt.hash(password, 12), cur.user_id]);
    res.json({ success: true, message: 'User updated', data: await findUser(cur.user_id) });
  } catch (e) { next(e); }
};

exports.setStatus = async (req, res, next) => {
  try {
    await findUser(req.params.id);
    if (req.body.status === 'inactive') notSelf(req, 'You cannot deactivate your own account');
    await db.execute('UPDATE users SET status=? WHERE user_id=?', [req.body.status, req.params.id]);
    res.json({ success: true, message: `User ${req.body.status === 'active' ? 'activated' : 'deactivated'}`, data: await findUser(req.params.id) });
  } catch (e) { next(e); }
};

exports.remove = async (req, res, next) => {
  try {
    await findUser(req.params.id);
    notSelf(req, 'You cannot delete your own account');
    // Users with orders are protected by the orders FK (mapped to 409 by the error handler): deactivate instead.
    await db.execute('DELETE FROM users WHERE user_id=?', [req.params.id]);
    res.json({ success: true, message: 'User deleted' });
  } catch (e) { next(e); }
};
