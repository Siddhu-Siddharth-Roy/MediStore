const router = require('express').Router();
const { body, param } = require('express-validator');
const c = require('../controllers/medicineController');
const auth = require('../middleware/authMiddleware');
const optionalAuth = require('../middleware/optionalAuthMiddleware');
const role = require('../middleware/roleMiddleware');
const validate = require('../middleware/validationMiddleware');
const v = require('../utils/validators');

const id = param('id').isInt({ min: 1 }).withMessage('Invalid id');
const staff = [auth, role('admin', 'pharmacist')];
const rules = [
  v.name('name', 'Medicine name', 150),
  v.optText('generic_name', 150), v.optText('brand', 100), v.optText('manufacturer', 150),
  v.optText('description', 5000), v.optText('dosage_form', 50), v.optText('strength', 50),
  body('category_id').optional({ checkFalsy: true }).isInt({ min: 1 }).withMessage('Invalid category'),
  body('mrp').isFloat({ min: 0, max: 99999999 }).withMessage('MRP must be a positive number'),
  body('selling_price').isFloat({ min: 0, max: 99999999 }).withMessage('Selling price must be a positive number'),
  body('status').optional().isIn(['active', 'inactive']).withMessage('Invalid status')
];
router.get('/', optionalAuth, c.list);                 // public: customers only ever see active, in-stock medicines
router.get('/manufacturers', optionalAuth, c.manufacturers);
router.get('/:id', [id], validate, optionalAuth, c.get);
router.post('/', staff, rules, validate, c.create);
router.put('/:id', staff, [id, ...rules], validate, c.update);
router.delete('/:id', staff, [id], validate, c.remove); // soft delete (deactivate)
module.exports = router;
