const db = require('../config/database');
const AppError = require('../utils/AppError');

const find = async (id) => {
  const [r] = await db.execute('SELECT * FROM categories WHERE category_id = ?', [id]);
  if (!r.length) throw new AppError('Category not found', 404);
  return r[0];
};
exports.list = async (req, res, next) => {
  try {
    const [rows] = await db.execute(`SELECT c.*, COUNT(m.medicine_id) AS medicine_count
      FROM categories c LEFT JOIN medicines m ON m.category_id = c.category_id
      GROUP BY c.category_id ORDER BY c.category_name`);
    res.json({ success: true, data: rows });
  } catch (e) { next(e); }
};
exports.create = async (req, res, next) => {
  try {
    const [r] = await db.execute('INSERT INTO categories (category_name, description) VALUES (?,?)', [req.body.category_name, req.body.description || null]);
    res.status(201).json({ success: true, message: 'Category created', data: await find(r.insertId) });
  } catch (e) { next(e); }
};
exports.update = async (req, res, next) => {
  try {
    await find(req.params.id);
    await db.execute('UPDATE categories SET category_name=?, description=? WHERE category_id=?', [req.body.category_name, req.body.description || null, req.params.id]);
    res.json({ success: true, message: 'Category updated', data: await find(req.params.id) });
  } catch (e) { next(e); }
};
exports.remove = async (req, res, next) => {
  try {
    await find(req.params.id); // medicines in this category keep existing with category = NULL (ON DELETE SET NULL)
    await db.execute('DELETE FROM categories WHERE category_id=?', [req.params.id]);
    res.json({ success: true, message: 'Category deleted' });
  } catch (e) { next(e); }
};
