// Parses ?page & ?limit into safe integers. Values are validated here, so they are safe to inline in LIMIT/OFFSET.
exports.paginate = (req, defaultLimit = 10, maxLimit = 100) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || defaultLimit, 1), maxLimit);
  return { page, limit, offset: (page - 1) * limit };
};
exports.meta = (page, limit, total) => ({ page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) });
// Escape % and _ so user search text is matched literally inside LIKE.
exports.like = (s) => '%' + String(s).replace(/[\\%_]/g, '\\$&') + '%';
