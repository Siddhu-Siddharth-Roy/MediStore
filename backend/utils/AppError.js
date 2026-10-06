class AppError extends Error {
  // `errors` (optional) is a list of {field, message} so forms can highlight individual inputs, same shape as validation errors.
  constructor(message, status = 400, errors = null) { super(message); this.status = status; if (errors) this.errors = errors; }
}
module.exports = AppError;
