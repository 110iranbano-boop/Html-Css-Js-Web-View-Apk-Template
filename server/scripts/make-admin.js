// استفاده: npm run make-admin -- 09123456789
require('dotenv').config();
const {Pool}=require('pg');
const toLatin=s=>String(s||'').replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
(async()=>{
 const phone=toLatin(process.argv[2]);
 if(!/^09\d{9}$/.test(phone)){console.error('شماره معتبر نیست؛ ابتدا شماره ثبت‌شده را وارد کنید.');process.exit(1);}
 if(!process.env.DATABASE_URL){console.error('DATABASE_URL تنظیم نشده است.');process.exit(1);}
 const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:(process.env.DB_SSL||process.env.PGSSL)==='true'?{rejectUnauthorized:false}:false});
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const u=(await c.query('SELECT id,phone FROM users WHERE phone=$1 FOR UPDATE',[phone])).rows[0];
  if(!u)throw new Error('کاربری با این شماره پیدا نشد؛ ابتدا در اپ ثبت‌نام کنید.');
  const role=(await c.query("SELECT id FROM roles WHERE code='admin'")).rows[0];
  if(!role)throw new Error('نقش admin در جدول roles وجود ندارد.');
  await c.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[u.id,role.id]);
  await c.query('COMMIT');
  console.log('دسترسی مدیریت برای شماره ثبت‌شده فعال شد:',u.phone);
 }catch(e){await c.query('ROLLBACK');console.error('خطا:',e.message);process.exitCode=1;}
 finally{c.release();await pool.end();}
})();
