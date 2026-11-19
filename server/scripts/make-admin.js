// استفاده:  npm run make-admin -- 09123456789
require('dotenv').config();
const { Pool } = require('pg');

const toLatin = (s) => String(s)
  .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

(async () => {
  const phone = toLatin(process.argv[2] || '').trim();
  if (!/^09\d{9}$/.test(phone)) {
    console.error('شماره معتبر بده. مثال: npm run make-admin -- 09123456789');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  try {
    const r = await pool.query("UPDATE profiles SET role='admin' WHERE username=$1 RETURNING id, username", [phone]);
    if (!r.rows.length) console.error('کاربری با این شماره پیدا نشد (اول در اپ ثبت‌نام کن).');
    else console.log('✅ ادمین شد:', r.rows[0].username);
  } catch (e) {
    console.error('❌', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
