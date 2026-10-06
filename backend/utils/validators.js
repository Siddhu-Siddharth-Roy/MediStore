const { body } = require('express-validator');
// Lower-cases only (no Gmail dot-stripping) so stored emails match what the user typed.
const NORM = { gmail_remove_dots: false, gmail_remove_subaddress: false, outlookdotcom_remove_subaddress: false, yahoo_remove_subaddress: false, icloud_remove_subaddress: false };
exports.email = (f = 'email') => body(f).trim().isEmail().withMessage('Valid email required').bail().normalizeEmail(NORM);
exports.phone = (f = 'phone') => body(f).optional({ checkFalsy: true }).trim().matches(/^[0-9+\-\s]{7,15}$/).withMessage('Invalid phone');
exports.password = (f = 'password') => body(f).isLength({ min: 8, max: 72 }).matches(/\d/).withMessage('Password needs 8-72 chars and a number');
exports.name = (f = 'name', label = 'Name', max = 100) => body(f).trim().notEmpty().withMessage(label + ' is required').isLength({ max }).withMessage(label + ' too long');
exports.optText = (f, max) => body(f).optional({ nullable: true }).trim().isLength({ max }).withMessage(f + ' too long');
exports.NORM = NORM;
