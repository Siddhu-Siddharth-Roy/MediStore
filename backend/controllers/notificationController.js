const db = require('../config/database');
const AppError = require('../utils/AppError');
const { paginate, meta } = require('../utils/pagination');

// Users only ever see their own notifications (every query filters by req.user.user_id).
exports.list = async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req, 15), uid = req.user.user_id;
    const unreadOnly = req.query.unread === '1' ? ' AND is_read = 0' : '';
    const [[{ total }]] = await db.execute(`SELECT COUNT(*) total FROM notifications WHERE user_id = ?${unreadOnly}`, [uid]);
    const [[{ unread }]] = await db.execute('SELECT COUNT(*) unread FROM notifications WHERE user_id = ? AND is_read = 0', [uid]);
    const [rows] = await db.execute(`SELECT notification_id, title, message, type, is_read, created_at FROM notifications WHERE user_id = ?${unreadOnly}
      ORDER BY notification_id DESC LIMIT ${limit} OFFSET ${offset}`, [uid]);
    res.json({ success: true, data: rows, unread_count: Number(unread), pagination: meta(page, limit, total) });
  } catch (e) { next(e); }
};
exports.markRead = async (req, res, next) => {
  try {
    const [r] = await db.execute('UPDATE notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?', [req.params.id, req.user.user_id]);
    if (!r.affectedRows) throw new AppError('Notification not found', 404);
    res.json({ success: true, message: 'Marked as read' });
  } catch (e) { next(e); }
};
exports.markAllRead = async (req, res, next) => {
  try { await db.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.user_id]); res.json({ success: true, message: 'All marked as read' }); }
  catch (e) { next(e); }
};
