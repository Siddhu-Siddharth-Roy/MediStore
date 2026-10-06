const router = require('express').Router();
const { body, param } = require('express-validator');
const c = require('../controllers/inventoryController');
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');
const validate = require('../middleware/validationMiddleware');

const id = param('id').isInt({ min: 1 }).withMessage('Invalid id');
const date = (f, optional) => { const v = body(f); return (optional ? v.optional({ checkFalsy: true }) : v).isISO8601({ strict: true, strictSeparator: true }).withMessage(`${f.replace(/_/g, ' ')} must be a valid date (YYYY-MM-DD)`); };
const money = (f) => body(f).isFloat({ min: 0, max: 99999999 }).withMessage(`${f.replace(/_/g, ' ')} must be a positive number`);
const batchRules = [
  date('expiry_date'), date('manufacturing_date', true), money('purchase_price'), money('selling_price'),
  body('supplier_id').optional({ checkFalsy: true }).isInt({ min: 1 }).withMessage('Invalid supplier'),
  body('reorder_level').optional({ checkFalsy: true }).isInt({ min: 0, max: 1000000 }).withMessage('Reorder level must be a whole number')
];

router.use(auth, role('admin', 'pharmacist')); // business rule 8: only authorised staff touch inventory
router.get('/', c.list);
router.get('/summary', c.summary);
router.get('/low-stock', c.lowStock);
router.get('/expired', c.expired);
router.get('/expiring', c.expiring);
router.get('/transactions', c.transactions);
router.get('/batches/:id', [id], validate, c.getOne);
router.post('/batches', [
  body('medicine_id').isInt({ min: 1 }).withMessage('Select a medicine'),
  body('batch_number').trim().notEmpty().isLength({ max: 50 }).withMessage('Batch number is required (max 50 chars)'),
  body('quantity').isInt({ min: 1, max: 1000000 }).withMessage('Quantity must be a whole number of at least 1'), ...batchRules], validate, c.addBatch);
router.put('/batches/:id', [id, ...batchRules], validate, c.updateBatch);
router.post('/adjust', [
  body('batch_id').isInt({ min: 1 }).withMessage('Select a batch'),
  body('type').isIn(['ADJUSTMENT', 'DAMAGED', 'EXPIRED', 'RETURN']).withMessage('Invalid adjustment type'),
  body('quantity').isInt({ min: -1000000, max: 1000000 }).custom(v => Number(v) !== 0).withMessage('Quantity must be a non-zero whole number'),
  body('remarks').trim().notEmpty().withMessage('A reason is required').isLength({ max: 150 }).withMessage('Reason too long (max 150 chars)')], validate, c.adjust);
router.post('/write-off-expired', c.writeOffExpired);
router.post('/sync-alerts', c.syncAlerts);
module.exports = router;
