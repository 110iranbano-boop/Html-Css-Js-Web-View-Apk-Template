'use strict';
require('dotenv').config();
const fs=require('node:fs');
const path=require('node:path');
const {Pool}=require('pg');
if(!process.env.DATABASE_URL){console.error('DATABASE_URL is required.');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:undefined});
(async()=>{try{await pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));console.log('Schema initialized; existing data preserved.');}
catch(e){console.error('DB init failed:',e.message);process.exitCode=1;}finally{await pool.end();}})();
