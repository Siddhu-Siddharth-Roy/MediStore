const AppError = require('../utils/AppError');
module.exports = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : next(new AppError('Forbidden: insufficient permissions', 403));
