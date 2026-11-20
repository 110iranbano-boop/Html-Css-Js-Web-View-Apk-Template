'use strict';
require('dotenv').config();
const bcrypt=require('bcryptjs');
const {Pool}=require('pg');
const phone=process.env.ADMIN_PHONE;
const password=process.env.ADMIN_INITIAL_PASSWORD;
if(!process.env.DATABASE_URL||!phone||!password){console.error('DATABASE_URL, ADMIN_PHONE and ADMIN_INITIAL_PASSWORD are required.');process.exit(1);}
if(password.length<12){console.error('ADMIN_INITIAL_PASSWORD must be at least 12 characters.');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:undefined});
(async()=>{try{
 const hash=await bcrypt.hash(password,12); const client=await pool.connect();
 try{await client.query('BEGIN');
 const q='INSERT INTO users(phone,password_hash,role) VALUES($1,$2,$3) ON CONFLICT(phone) DO UPDATE SET password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,updated_at=now() RETURNING id';
 const r=await client.query(q,[phone,hash,'admin']);
 await client.query("INSERT INTO profiles(user_id,display_name) VALUES($1,'مدیر سیمرغ') ON CONFLICT(user_id) DO NOTHING",[r.rows[0].id]);
 await client.query('COMMIT'); console.log('Administrator seeded; password was not displayed.');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}catch(e){console.error('Admin seed failed:',e.message);process.exitCode=1;}finally{await pool.end();}})();
