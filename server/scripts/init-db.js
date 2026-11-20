require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  try {
    await pool.query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
    console.log('✅ جدول‌ها آماده شدند');
  } catch (e) {
    console.error('❌', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
