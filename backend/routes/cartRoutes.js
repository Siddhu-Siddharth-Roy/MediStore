const router = require('express').Router();
const { body, param } = require('express-validator');
const c = require('../controllers/cartController');
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');
const validate = require('../middleware/validationMiddleware');

const mid = param('medicineId').isInt({ min: 1 }).withMessage('Invalid medicine');
const qty = body('quantity').isInt({ min: 1, max: 1000 }).withMessage('Quantity must be a whole number between 1 and 1000');
router.use(auth, role('customer')); // carts belong to customers
router.get('/', c.get);
router.post('/items', [body('medicine_id').isInt({ min: 1 }).withMessage('Invalid medicine'), body('quantity').optional().isInt({ min: 1, max: 1000 }).withMessage('Quantity must be a whole number between 1 and 1000')], validate, c.add);
router.put('/items/:medicineId', [mid, qty], validate, c.setQuantity);
router.delete('/items/:medicineId', [mid], validate, c.remove);
router.delete('/', c.clear);
module.exports = router;
