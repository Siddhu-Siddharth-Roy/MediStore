const router = require('express').Router();
const { param, query } = require('express-validator');
const c = require('../controllers/reportController');
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');
const validate = require('../middleware/validationMiddleware');
const { TYPES } = require('../services/reportService');

router.use(auth, role('admin', 'pharmacist'));
router.get('/:type', [
  param('type').isIn(TYPES).withMessage('Unknown report'),
  query('format').optional().isIn(['json', 'csv']).withMessage('format must be json or csv'),
  query('from').optional({ checkFalsy: true }).isISO8601({ strict: true, strictSeparator: true }).withMessage('From date must be YYYY-MM-DD'),
  query('to').optional({ checkFalsy: true }).isISO8601({ strict: true, strictSeparator: true }).withMessage('To date must be YYYY-MM-DD')
], validate, c.get);
module.exports = router;
