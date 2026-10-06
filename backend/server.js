require('dotenv').config();
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set in .env and be at least 32 characters'); process.exit(1);
}
const app = require('./app');
const db = require('./config/database');
const PORT = process.env.PORT || 3000;
const { syncAlerts } = require('./services/alertService');
db.query('SELECT 1').then(() => app.listen(PORT, () => {
  console.log(`MediStore running on http://localhost:${PORT}`);
  syncAlerts(); setInterval(syncAlerts, 60 * 60 * 1000); // stock/expiry alerts on start, then hourly
}))
  .catch(e => { console.error('Database connection failed:', e.message); process.exit(1); });
