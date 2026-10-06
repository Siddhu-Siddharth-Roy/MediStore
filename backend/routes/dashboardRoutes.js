const router = require('express').Router();
const c = require('../controllers/dashboardController');
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');
router.use(auth, role('admin', 'pharmacist'));
router.get('/summary', c.summary);
router.get('/sales', c.sales);
router.get('/inventory', c.inventory);
module.exports = router;
