const router = require('express').Router();
const { body, param } = require('express-validator');
const c = require('../controllers/supplierController');
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');
const validate = require('../middleware/validationMiddleware');
const v = require('../utils/validators');

const id = param('id').isInt({ min: 1 }).withMessage('Invalid id');
const rules = [
  v.name('supplier_name', 'Supplier name', 150), v.optText('company_name', 150), v.optText('contact_person', 100),
  v.phone(), v.optText('address', 1000), v.optText('gst_number', 30),
  body('email').optional({ checkFalsy: true }).trim().isEmail().withMessage('Invalid email').normalizeEmail(v.NORM)
];
router.use(auth, role('admin', 'pharmacist'));
router.get('/', c.list);
router.post('/', rules, validate, c.create);
router.get('/:id', [id], validate, c.get);
router.put('/:id', [id, ...rules], validate, c.update);
router.patch('/:id/status', [id, body('status').isIn(['active', 'inactive']).withMessage('Invalid status')], validate, c.setStatus);
router.delete('/:id', [id], validate, c.remove);
router.get('/:id/purchases', [id], validate, c.purchases);
router.get('/:id/medicines', [id], validate, c.medicines);
module.exports = router;
