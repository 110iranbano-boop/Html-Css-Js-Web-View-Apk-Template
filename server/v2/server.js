'use strict';
require('dotenv').config();
const express=require('express');
const helmet=require('helmet');
const cors=require('cors');
const rateLimit=require('express-rate-limit');
const {Pool}=require('pg');
if(!process.env.DATABASE_URL||!process.env.JWT_SECRET)throw new Error('DATABASE_URL and JWT_SECRET are required.');
const app=express();
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:undefined});
app.disable('x-powered-by');app.use(helmet());
app.use(cors({origin:process.env.CORS_ORIGIN?process.env.CORS_ORIGIN.split(','):true}));
app.use(express.json({limit:'1mb'}));
app.use('/api',rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:'draft-7',legacyHeaders:false}));
app.get('/api/health',async(_req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true,service:'simorgh-api-v2',database:'connected'});}
catch(_e){res.status(503).json({ok:false,service:'simorgh-api-v2',database:'unavailable'});}});
app.get('/api',(_req,res)=>res.json({name:'Simorgh API',version:2}));
app.use((err,_req,res,_next)=>{console.error('API error:',err.message);res.status(500).json({error:'خطای داخلی سرور'});});
const port=Number(process.env.PORT||3000);
const server=app.listen(port,()=>console.log('Simorgh API v2 listening on',port));
async function shutdown(){server.close(async()=>{await pool.end();process.exit(0);});}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
