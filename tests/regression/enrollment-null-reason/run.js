const { chromium } = require('playwright');
const { spawnSync } = require('node:child_process');
const BASE = process.env.P21R_BASE_URL || 'http://127.0.0.1:6011';
const PASSWORD = process.env.P21R_PASSWORD || 'P21R-StrongPass!';
const CONN = process.env.DAR_TEST_DATABASE || '';
const PROD_HOSTS = ['dar-elemam-hafs.rigxhardware.com', '31.220.76.171'];
if (!CONN) { console.error('P21R_FAIL missing DB'); process.exit(2); }
try { const u=new URL(BASE); if(PROD_HOSTS.includes(u.hostname.toLowerCase())||!['127.0.0.1','localhost','::1','[::1]'].includes(u.hostname.toLowerCase())){console.error('P21R_FAIL non-test URL');process.exit(2);} } catch { console.error('P21R_FAIL invalid URL'); process.exit(2); }
function pgEnv(){const e={...process.env};for(const p of CONN.split(';')){const i=p.indexOf('=');if(i<0)continue;const k=p.slice(0,i).trim().toLowerCase(),v=p.slice(i+1).trim();if(k==='host')e.PGHOST=v;if(k==='port')e.PGPORT=v;if(k==='database')e.PGDATABASE=v;if(k==='username')e.PGUSER=v;if(k==='password')e.PGPASSWORD=v;}return e;}
function psql(s){const r=spawnSync('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',s],{env:pgEnv(),encoding:'utf8'});if(r.status!==0)throw new Error('psql: '+(r.stderr||'').trim());return (r.stdout||'').trim();}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1400,height:950}});
 try{
  const login=await page.request.post(BASE+'/api/auth/login',{data:{username:'p21r_admin',password:PASSWORD}}); if(!login.ok())throw new Error('login '+login.status());
  const enrollment=psql("SELECT ce.id FROM circle_enrollments ce JOIN students s ON s.id=ce.student_id WHERE s.student_code='P21R-STUDENT' AND ce.status='active' LIMIT 1;");
  if(!enrollment)throw new Error('seed enrollment missing');
  const today=new Date().toISOString().slice(0,10);
  const pause=await page.request.patch(BASE+'/api/enrollments/'+enrollment+'/pause',{data:{effectiveOn:today,reason:null}});
  if(pause.status()!==200)throw new Error('pause null reason expected 200 got '+pause.status()+': '+(await pause.text()).slice(0,300));
  const paused=psql("SELECT status FROM circle_enrollments WHERE id='"+enrollment+"';"); if(paused!=='paused')throw new Error('pause status not saved: '+paused);
  const resume=await page.request.patch(BASE+'/api/enrollments/'+enrollment+'/resume',{data:{effectiveOn:today,reason:null}});
  if(resume.status()!==200)throw new Error('resume null reason expected 200 got '+resume.status()+': '+(await resume.text()).slice(0,300));
  const resumed=psql("SELECT status FROM circle_enrollments WHERE id='"+enrollment+"';"); if(resumed!=='active')throw new Error('resume status not saved: '+resumed);
  const auditCount=psql("SELECT count(*) FROM audit_log WHERE entity_id='"+enrollment+"' AND entity_type='enrollment' AND action_code IN ('enrollment.pause','enrollment.resume');");
  if(auditCount!=='2')throw new Error('expected 2 status audit rows got '+auditCount);
  console.log(JSON.stringify({ok:true,checks:4,auditCount},null,2)); console.log('P21R_PASS');
 }catch(e){console.log(JSON.stringify({ok:false,error:String(e&&e.message||e)},null,2));process.exitCode=1}finally{await browser.close()}
})();
