const { chromium } = require('playwright');
const { spawnSync } = require('node:child_process');
const LEGACY = process.env.P27C_LEGACY_URL || 'http://127.0.0.1:6013';
const NEW = process.env.P27C_NEW_URL || 'http://127.0.0.1:6014';
const PASSWORD = process.env.P27C_PASSWORD || 'P27C-StrongPass!';
const CONN = process.env.DAR_TEST_DATABASE || '';
const PROD_HOSTS = ['dar-elemam-hafs.rigxhardware.com', '31.220.76.171'];
if (!CONN) { console.error('P27C_FAIL missing DB'); process.exit(2); }
for (const base of [LEGACY, NEW]) { try { const u=new URL(base); if(PROD_HOSTS.includes(u.hostname.toLowerCase())||!['127.0.0.1','localhost','::1','[::1]'].includes(u.hostname.toLowerCase())){console.error('P27C_FAIL non-test URL');process.exit(2);} } catch { console.error('P27C_FAIL invalid URL'); process.exit(2); } }
function pgEnv(){const e={...process.env};for(const p of CONN.split(';')){const i=p.indexOf('=');if(i<0)continue;const k=p.slice(0,i).trim().toLowerCase(),v=p.slice(i+1).trim();if(k==='host')e.PGHOST=v;if(k==='port')e.PGPORT=v;if(k==='database')e.PGDATABASE=v;if(k==='username')e.PGUSER=v;if(k==='password')e.PGPASSWORD=v;}return e;}
function breakStudentsTable(){const r=spawnSync('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c','DROP TABLE IF EXISTS students CASCADE;'],{env:pgEnv(),encoding:'utf8'});if(r.status!==0)throw new Error('drop table failed: '+(r.stderr||'').trim());}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage();
 try{
  const login=await page.request.post(LEGACY+'/api/auth/login',{data:{username:'p27c_admin',password:PASSWORD}}); if(!login.ok())throw new Error('login '+login.status());
  const list=await page.request.get(NEW+'/api/v1/students?page=1&pageSize=5'); if(list.status()!==200)throw new Error('new API list expected 200 got '+list.status()+': '+(await list.text()).slice(0,200));
  const invalid=await page.request.post(NEW+'/api/v1/students',{data:{studentCode:null,fullName:'P27C API',ageYears:10,phone:'010ABC',guardianName:null,guardianPhone:null,joinedOn:'2026-01-01',status:'active',notes:null}});
  if(invalid.status()!==422)throw new Error('new API validation expected 422 got '+invalid.status()+': '+(await invalid.text()).slice(0,200));
  const invalidBody=await invalid.json(); if(!invalidBody.errors)throw new Error('new API 422 shape changed: '+JSON.stringify(invalidBody));
  breakStudentsTable();
  const failed=await page.request.get(NEW+'/api/v1/students?page=1&pageSize=5');
  if(failed.status()!==500)throw new Error('new API unexpected expected 500 got '+failed.status()+': '+(await failed.text()).slice(0,250));
  const text=await failed.text();
  if(!/[\u0600-\u06FF]/.test(text))throw new Error('new API 500 is not Arabic: '+text.slice(0,250));
  if(/Exception|Npgsql|PostgreSQL|stack|database|at Dar\./i.test(text))throw new Error('new API 500 leaked technical detail: '+text.slice(0,250));
  console.log(JSON.stringify({ok:true,checks:5,statuses:{list:200,validation:422,unexpected:500}},null,2)); console.log('P27C_PASS');
 }catch(e){console.log(JSON.stringify({ok:false,error:String(e&&e.message||e)},null,2));process.exitCode=1}finally{await browser.close()}
})();
