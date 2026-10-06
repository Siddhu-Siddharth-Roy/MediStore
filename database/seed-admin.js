// Usage: node database/seed-admin.js admin@medistore.com StrongPass123
require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('../backend/config/database');
(async () => {
  const [email, pass] = [process.argv[2], process.argv[3]];
  if (!email || !pass) { console.log('Usage: node database/seed-admin.js <email> <password>'); process.exit(1); }
  await db.execute('INSERT INTO users (name,email,password,role) VALUES ("Administrator",?,?,"admin")', [email, await bcrypt.hash(pass, 12)]);
  console.log('Admin created'); process.exit(0);
})();
