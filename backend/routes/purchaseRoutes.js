const router = require('express').Router();
const { body, param } = require('express-validator');
const c = require('../controllers/purchaseController');
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');
const validate = require('../middleware/validationMiddleware');

const id = param('id').isInt({ min: 1 }).withMessage('Invalid purchase id');
const iso = (v) => v.isISO8601({ strict: true, strictSeparator: true });
// Totals are NOT accepted from the client: they are computed on the server from quantity x purchase price.
const rules = [
  body('supplier_id').isInt({ min: 1 }).withMessage('Select a supplier'),
  iso(body('purchase_date').optional({ checkFalsy: true })).withMessage('Purchase date must be a valid date (YYYY-MM-DD)'),
  body('invoice_number').optional({ nullable: true }).trim().isLength({ max: 50 }).withMessage('Invoice number too long (max 50)'),
  body('notes').optional({ nullable: true }).trim().isLength({ max: 500 }).withMessage('Notes too long (max 500)'),
  body('items').isArray({ min: 1, max: 100 }).withMessage('Add at least one item (max 100)'),
  body('items.*.medicine_id').isInt({ min: 1 }).withMessage('Select a medicine'),
  body('items.*.batch_number').trim().notEmpty().withMessage('Batch number is required').isLength({ max: 50 }).withMessage('Batch number too long (max 50)'),
  iso(body('items.*.expiry_date')).withMessage('Expiry date must be a valid date (YYYY-MM-DD)'),
  iso(body('items.*.manufacturing_date').optional({ checkFalsy: true })).withMessage('Manufacturing date must be a valid date (YYYY-MM-DD)'),
  body('items.*.quantity').isInt({ min: 1, max: 1000000 }).withMessage('Quantity must be a whole number of at least 1'),
  body('items.*.purchase_price').isFloat({ min: 0, max: 99999999 }).withMessage('Purchase price must be a positive number'),
  body('items.*.selling_price').optional({ checkFalsy: true }).isFloat({ min: 0, max: 99999999 }).withMessage('Selling price must be a positive number'),
  body('items.*.reorder_level').optional({ checkFalsy: true }).isInt({ min: 0, max: 1000000 }).withMessage('Reorder level must be a whole number'),
  body('confirm').optional().isBoolean().withMessage('confirm must be true or false')
];
router.use(auth, role('admin', 'pharmacist'));
router.get('/', c.list);
router.post('/', rules, validate, c.create);
router.get('/:id', [id], validate, c.get);
router.put('/:id', [id, ...rules], validate, c.update);
router.post('/:id/confirm', [id], validate, c.confirm);
router.post('/:id/cancel', [id, body('reason').optional({ nullable: true }).trim().isLength({ max: 200 }).withMessage('Reason too long (max 200)')], validate, c.cancel);
module.exports = router;
