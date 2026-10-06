const router = require('express').Router();
const { body, param } = require('express-validator');
const c = require('../controllers/userController');
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');
const validate = require('../middleware/validationMiddleware');
const v = require('../utils/validators');

const id = param('id').isInt({ min: 1 }).withMessage('Invalid id');
const ROLES = ['admin', 'pharmacist', 'customer'];
router.use(auth);

// Own profile: every logged-in role. Must stay above the /:id routes.
router.get('/me', c.getMe);
router.put('/me', [v.name(), v.email(), v.phone()], validate, c.updateMe);
router.put('/me/password', [
  body('current_password').notEmpty().withMessage('Current password required'),
  v.password('new_password')
], validate, c.changePassword);

// Everything below: Admin only.
router.use(role('admin'));
router.get('/', c.list);
router.post('/', [v.name(), v.email(), v.phone(), v.password(), body('role').isIn(ROLES).withMessage('Invalid role')], validate, c.create);
router.get('/:id', [id], validate, c.get);
router.put('/:id', [id, v.name(), v.email(), v.phone(), body('role').isIn(ROLES).withMessage('Invalid role'),
  body('password').optional({ checkFalsy: true }).isLength({ min: 8, max: 72 }).matches(/\d/).withMessage('Password needs 8-72 chars and a number')], validate, c.update);
router.patch('/:id/status', [id, body('status').isIn(['active', 'inactive']).withMessage('Invalid status')], validate, c.setStatus);
router.delete('/:id', [id], validate, c.remove);
module.exports = router;
