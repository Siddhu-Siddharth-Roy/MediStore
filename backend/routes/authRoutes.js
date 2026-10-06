const router = require('express').Router();
const { body } = require('express-validator');
const c = require('../controllers/authController');
const auth = require('../middleware/authMiddleware');
const validate = require('../middleware/validationMiddleware');
const v = require('../utils/validators');

router.post('/register', [v.name(), v.email(), v.phone(), v.password()], validate, c.register);
router.post('/login', [v.email(), body('password').notEmpty().withMessage('Password required')], validate, c.login);
router.post('/logout', c.logout);
router.get('/me', auth, c.me);
module.exports = router;
