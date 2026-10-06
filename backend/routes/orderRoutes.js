const router = require('express').Router();
const { body, param } = require('express-validator');
const c = require('../controllers/orderController');
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');
const validate = require('../middleware/validationMiddleware');
const { STATUSES } = require('../services/orderService');

const id = param('id').isInt({ min: 1 }).withMessage('Invalid order id');
router.use(auth);
router.get('/', c.list);
router.get('/:id', [id], validate, c.get);
// Note: the request body deliberately has no prices or totals - those are computed on the server from the cart (rule 14).
router.post('/', role('customer'), [
  body('delivery_address').trim().isLength({ min: 10, max: 500 }).withMessage('Please enter a complete delivery address (10–500 characters)'),
  body('delivery_phone').trim().matches(/^[0-9+\-\s]{7,15}$/).withMessage('Enter a valid contact phone number'),
  body('notes').optional({ nullable: true }).trim().isLength({ max: 500 }).withMessage('Notes too long (max 500 characters)')], validate, c.place);
router.put('/:id/status', role('admin', 'pharmacist'), [id, body('status').isIn(STATUSES).withMessage('Invalid status'),
  body('note').optional({ nullable: true }).trim().isLength({ max: 255 }).withMessage('Note too long')], validate, c.updateStatus);
router.post('/:id/cancel', role('customer'), [id, body('reason').optional({ nullable: true }).trim().isLength({ max: 200 }).withMessage('Reason too long')], validate, c.cancelOwn);
module.exports = router;
