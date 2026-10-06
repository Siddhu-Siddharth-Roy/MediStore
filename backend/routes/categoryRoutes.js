const router = require('express').Router();
const { body, param } = require('express-validator');
const c = require('../controllers/categoryController');
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');
const validate = require('../middleware/validationMiddleware');
const v = require('../utils/validators');

const id = param('id').isInt({ min: 1 }).withMessage('Invalid id');
const rules = [v.name('category_name', 'Category name'), v.optText('description', 1000)];
router.get('/', c.list); // public: used by catalog filters
router.post('/', auth, role('admin', 'pharmacist'), rules, validate, c.create);
router.put('/:id', auth, role('admin', 'pharmacist'), [id, ...rules], validate, c.update);
router.delete('/:id', auth, role('admin', 'pharmacist'), [id], validate, c.remove);
module.exports = router;
