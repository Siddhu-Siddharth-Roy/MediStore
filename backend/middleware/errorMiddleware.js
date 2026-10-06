// Maps common MySQL errors to friendly HTTP responses so controllers don't each have to.
const DB = {
  ER_DUP_ENTRY: [409, 'A record with the same unique value already exists'],
  ER_NO_REFERENCED_ROW_2: [400, 'Referenced record does not exist'],
  ER_ROW_IS_REFERENCED_2: [409, 'Record is in use by other data. Deactivate it instead of deleting'],
  ER_CHECK_CONSTRAINT_VIOLATED: [400, 'A value violates a database rule (check prices/quantities)'],
  ER_CONSTRAINT_FAILED: [400, 'A value violates a database rule (check prices/quantities)']
};
exports.notFound = (req, res) => res.status(404).json({ success: false, message: 'Route not found' });
exports.errorHandler = (err, req, res, next) => {
  let status = err.status || 500, message = err.message;
  if (err.code && DB[err.code]) [status, message] = DB[err.code];
  if (status === 500) { console.error(err); message = 'Internal server error'; }
  res.status(status).json({ success: false, message, ...(err.errors && status < 500 ? { errors: err.errors } : {}) });
};
