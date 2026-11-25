const { chromium } = require('playwright');
const { spawnSync } = require('node:child_process');
const BASE = process.env.P27B_BASE_URL || 'http://127.0.0.1:6012';
const PASSWORD = process.env.P27B_PASSWORD || 'P27B-StrongPass!';
const CONN = process.env.DAR_TEST_DATABASE || '';
if (!CONN) { console.error('P27B_FAIL missing DB'); process.exit(2); }
const PROD_HOSTS = ['dar-elemam-hafs.rigxhardware.com', '31.220.76.171'];
try { const u=new URL(BASE); if(PROD_HOSTS.includes(u.hostname.toLowerCase())||!['127.0.0.1','localhost','::1','[::1]'].includes(u.hostname.toLowerCase())){console.error('P27B_FAIL non-test URL');process.exit(2);} } catch { console.error('P27B_FAIL invalid URL'); process.exit(2); }
function pgEnv(){const e={...process.env};for(const p of CONN.split(';')){const i=p.indexOf('=');if(i<0)continue;const k=p.slice(0,i).trim().toLowerCase(),v=p.slice(i+1).trim();if(k==='host')e.PGHOST=v;if(k==='port')e.PGPORT=v;if(k==='database')e.PGDATABASE=v;if(k==='username')e.PGUSER=v;if(k==='password')e.PGPASSWORD=v;}return e;}
function psql(s){const r=spawnSync('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',s],{env:pgEnv(),encoding:'utf8'});if(r.status!==0)throw new Error('psql: '+(r.stderr||'').trim());return (r.stdout||'').trim();}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage();
 try{
  const login=await page.request.post(BASE+'/api/auth/login',{data:{username:'p27b_admin',password:PASSWORD}}); if(!login.ok())throw new Error('login '+login.status());
  const badBackup=await page.request.post(BASE+'/api/admin/backups',{data:{scopes:['not-a-scope']}});
  if(badBackup.status()!==400)throw new Error('backup invalid scopes expected 400 got '+badBackup.status());
  const badBackupBody=await badBackup.json();
  if(!badBackupBody.errors || !Array.isArray(badBackupBody.errors.scopes))throw new Error('backup 400 shape changed: '+JSON.stringify(badBackupBody));
  if(!/[\u0600-\u06FF]/.test(badBackupBody.errors.scopes.join(' ')))throw new Error('backup validation is not Arabic');
  const badExport=await page.request.get(BASE+'/api/admin/export?scopes=not-a-scope');
  if(badExport.status()!==400)throw new Error('export invalid scopes expected 400 got '+badExport.status());
  const badExportBody=await badExport.json();
  if(typeof badExportBody.message!=='string' || !/[\u0600-\u06FF]/.test(badExportBody.message))throw new Error('export 400 shape/message changed');
  // Force an unhandled database failure after authentication and verify the generic 500 shape.
  psql('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND pid <> pg_backend_pid();');
  const drop=spawnSync('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c','DROP DATABASE IF EXISTS '+JSON.stringify(pgEnv().PGDATABASE)+' WITH (FORCE);'],{env:{...pgEnv(),PGDATABASE:'postgres'},encoding:'utf8'});
  if(drop.status!==0)throw new Error('drop test db failed: '+(drop.stderr||'').trim());
  const failed=await page.request.get(BASE+'/api/students');
  if(failed.status()!==500)throw new Error('unhandled failure expected 500 got '+failed.status()+': '+(await failed.text()).slice(0,250));
  const failedText=await failed.text();
  if(!/[\u0600-\u06FF]/.test(failedText))throw new Error('500 message is not Arabic: '+failedText.slice(0,250));
  if(/Npgsql|PostgreSQL|Exception|stack|database/i.test(failedText))throw new Error('500 leaked technical details: '+failedText.slice(0,250));
  console.log(JSON.stringify({ok:true,checks:5,backupShape:Object.keys(badBackupBody),exportShape:Object.keys(badExportBody)},null,2)); console.log('P27B_PASS');
 }catch(e){console.log(JSON.stringify({ok:false,error:String(e&&e.message||e)},null,2));process.exitCode=1}finally{await browser.close()}
})();
