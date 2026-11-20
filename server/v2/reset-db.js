'use strict';
require('dotenv').config();
const {Pool}=require('pg');
if(process.env.ALLOW_DESTRUCTIVE_RESET!=='true'){console.error('Refusing reset: set ALLOW_DESTRUCTIVE_RESET=true explicitly.');process.exit(1);}
if(!process.env.DATABASE_URL){console.error('DATABASE_URL is required.');process.exit(1);}
const url=new URL(process.env.DATABASE_URL);
const dbName=decodeURIComponent(url.pathname.replace(/^\//,''));
if(!process.env.RESET_DATABASE_NAME||process.env.RESET_DATABASE_NAME!==dbName){console.error('Refusing reset: RESET_DATABASE_NAME must exactly match DATABASE_URL database name.');process.exit(1);}
if(process.env.NODE_ENV==='production'&&process.env.CONFIRM_PRODUCTION_RESET!=='I_UNDERSTAND_DATA_WILL_BE_DELETED'){console.error('Production reset confirmation missing.');process.exit(1);}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:undefined});
(async()=>{try{await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');console.log('Public schema reset completed.');}
catch(e){console.error('Reset failed:',e.message);process.exitCode=1;}finally{await pool.end();}})();
