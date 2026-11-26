const { chromium } = require('playwright');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const BASE = process.env.P29_BASE_URL || '';
const LEGACY_ORIGIN = process.env.P29_LEGACY_URL || '';
const NEW_ORIGIN = process.env.P29_NEW_URL || '';
const CONN = process.env.DAR_TEST_DATABASE || '';
const SETUP_TOKEN = process.env.P29_SETUP_TOKEN || '';
const PASSWORD = process.env.P29_PASSWORD || 'P29-StrongPass!';
const PROD_HOSTS = (process.env.DAR_FORBIDDEN_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
for (const raw of [BASE, LEGACY_ORIGIN, NEW_ORIGIN]) { try { const u=new URL(raw); if(PROD_HOSTS.includes(u.hostname.toLowerCase())||!['127.0.0.1','localhost','::1','[::1]'].includes(u.hostname.toLowerCase())){console.error('P29_FAIL non-test URL');process.exit(2);} } catch { console.error('P29_FAIL invalid URL');process.exit(2);} }
if (!CONN || !SETUP_TOKEN) { console.error('P29_FAIL missing env'); process.exit(2); }
if (new RegExp('database\\s*=\\s*' + (process.env.DAR_FORBIDDEN_DB || '__forbidden_db__') + '\\b', 'i').test(CONN)) { console.error('P29_FAIL production database'); process.exit(2); }

function pgEnv(){const e={...process.env};for(const part of CONN.split(';')){const i=part.indexOf('=');if(i<0)continue;const k=part.slice(0,i).trim().toLowerCase(),v=part.slice(i+1).trim();if(k==='host')e.PGHOST=v;if(k==='port')e.PGPORT=v;if(k==='database')e.PGDATABASE=v;if(k==='username')e.PGUSER=v;if(k==='password')e.PGPASSWORD=v;}return e;}
const PGENV=pgEnv();
function psql(sql){const r=spawnSync('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{env:PGENV,encoding:'utf8'});if(r.status!==0)throw new Error('psql: '+(r.stderr||'').trim());return (r.stdout||'').trim();}
function q(v){return "'"+String(v).replaceAll("'","''")+"'";}
async function login(username,password){const r=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});if(!r.ok)throw new Error('login '+username+' '+r.status());const cookies=r.headers.getSetCookie?r.headers.getSetCookie():[r.headers.get('set-cookie')];return cookies.filter(Boolean).map(v=>v.split(';')[0]).join('; ');}
function seedBase(){const teacher=randomUUID(),circle=randomUUID(),slot=randomUUID(),tag=teacher.slice(0,8);psql('INSERT INTO teachers(id,teacher_code,full_name,status,hourly_rate) VALUES ('+q(teacher)+','+q('P29-T-'+tag)+",'P29 Teacher','active',60);"+'INSERT INTO circles(id,circle_code,name,teacher_id,monthly_fee,is_active,starts_on) VALUES ('+q(circle)+','+q('P29-C-'+tag)+",'P29 Circle',"+q(teacher)+',0,TRUE,DATE \'2026-01-01\');'+"INSERT INTO circle_schedule_slots(id,circle_id,day_of_week,starts_at,duration_minutes,is_active) VALUES ("+q(slot)+','+q(circle)+",1,'10:00',60,TRUE);");return{teacher,circle,slot};}

(async()=>{
 const baseUrl=new URL(BASE), legacyUrl=new URL(LEGACY_ORIGIN), newUrl=new URL(NEW_ORIGIN);
 const proxy=http.createServer((req,res)=>{const target=req.url.startsWith('/api/v1')?newUrl:legacyUrl;const opts={hostname:target.hostname,port:target.port,path:req.url,method:req.method,headers:{...req.headers,host:target.host}};const up=http.request(opts,r=>{res.writeHead(r.statusCode||502,r.headers);r.pipe(res)});up.on('error',e=>{res.writeHead(502);res.end('proxy error')});req.pipe(up)});
 await new Promise((resolve)=>proxy.listen(Number(baseUrl.port),baseUrl.hostname,resolve));
 console.log('STEP_PROXY');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 let errors=[];
 try{
  const setup=await fetch(BASE+'/api/setup/admin',{method:'POST',headers:{'content-type':'application/json','X-Setup-Token':SETUP_TOKEN},body:JSON.stringify({username:'p29_admin',displayName:'P29 Admin',password:PASSWORD})});
  if(![200,409].includes(setup.status)) throw new Error('setup '+setup.status);
  const base=seedBase();
  psql('INSERT INTO school_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;');
  psql("UPDATE app_users SET avatar_data=decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'), avatar_content_type='image/png' WHERE username='p29_admin';");
  psql("INSERT INTO user_permissions(user_id, permission_code) SELECT id, 'meet.bot.control' FROM app_users WHERE username='p29_admin' ON CONFLICT DO NOTHING;");
  const adminCookie=await login('p29_admin',PASSWORD);
  async function createUser(username,permissions,teacherId){const r=await fetch(BASE+'/api/admin/users',{method:'POST',headers:{'content-type':'application/json',cookie:adminCookie},body:JSON.stringify({username,displayName:username,password:PASSWORD,permissionCodes:permissions,teacherId})});if(![201,409].includes(r.status))throw new Error('create '+username+' '+r.status());}
  await createUser('p29_teacher',['teacher.portal','teacher.attendance','teacher.requests','teacher.calendar','teacher.history.self','teacher.earnings.self','teacher.subscriptions.read','account.password.self'],base.teacher);
  await createUser('p29_supervisor',['supervisor.portal','supervisor.students.read','supervisor.students.create','supervisor.circles.read','supervisor.teachers.read','supervisor.teachers.notes','supervisor.absences','supervisor.attendance.correct','supervisor.attendance.requests','supervisor.unpaid','supervisor.live','supervisor.communication','account.password.self'],null);
  psql("UPDATE app_users SET avatar_data=decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'), avatar_content_type='image/png' WHERE username IN ('p29_teacher','p29_supervisor');");

  const checks=[];
  function assert(c,m){if(!c)throw new Error(m)}
  async function openAdmin(){const ctx=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});const page=await ctx.newPage();const logs=[];const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',async m=>{if(m.type()==='error' && m.text().includes('[DAR_UI_ERROR]')){try{const values=await Promise.all(m.args().map(a=>a.jsonValue()));logs.push(values)}catch{}}});await page.request.post(BASE+'/api/auth/login',{data:{username:'p29_admin',password:PASSWORD}});await page.goto(BASE+'/management',{waitUntil:'domcontentloaded',timeout:60000});await page.waitForSelector('.nav-list',{timeout:60000});await page.waitForTimeout(500);return{ctx,page,logs,pageErrors};}
  console.log('STEP_SETUP');
  const admin=await openAdmin();
  console.log('STEP_ADMIN');
  // Open a form that lives outside the page boundary.
  await admin.page.getByRole('button',{name:'تغيير كلمة المرور'}).first().click();
  await admin.page.waitForSelector('input[type=password]');
  const inputs=admin.page.locator('input[type=password]');
  await inputs.nth(0).fill('current-secret-value');
  await inputs.nth(1).fill('new-secret-value');
  // Page-level error: page fallback, dialog and values must remain.
  await admin.page.evaluate(()=>window.dispatchEvent(new CustomEvent('dar:zz-error',{detail:'page'})));
  await admin.page.waitForTimeout(500);
  let body=await admin.page.locator('body').innerText();
  assert(body.includes('تعذر عرض هذه الصفحة'),'page fallback missing');
  assert(!body.includes('ZZ intentional') && !body.includes('at Error'),'technical error shown');
  const values=await inputs.evaluateAll(nodes=>nodes.map(n=>n.value));
  assert(values[0]==='current-secret-value' && values[1]==='new-secret-value','open form values were lost');
  assert(await admin.page.locator('.nav-list').count()===1,'admin nav disappeared after page error');
  checks.push('page_error_fallback_and_form_preserved');
  // The modal is above the page fallback; close it explicitly, then retry.
  await admin.page.keyboard.press('Escape');
  await admin.page.waitForTimeout(300);
  await admin.page.getByRole('button',{name:'إعادة المحاولة'}).click();
  await admin.page.waitForTimeout(400);
  assert(await admin.page.locator('.nav-list').count()===1,'retry did not restore page');
  assert(await admin.page.locator('input[type=password]').count()===0,'dialog did not close');
  checks.push('page_retry');
  // Dialog-level error: page/nav remains.
  await admin.page.getByRole('button',{name:'تغيير كلمة المرور'}).first().click();
  await admin.page.waitForSelector('input[type=password]');
  await admin.page.evaluate(()=>window.dispatchEvent(new CustomEvent('dar:zz-error',{detail:'dialog'})));
  await admin.page.waitForTimeout(500);
  body=await admin.page.locator('body').innerText();
  assert(body.includes('تعذر عرض هذه الصفحة'),'dialog fallback missing');
  assert(await admin.page.locator('.nav-list').count()===1,'page/nav disappeared after dialog error');
  checks.push('dialog_error_isolated');
  await admin.page.getByRole('button',{name:'إعادة المحاولة'}).click();
  await admin.page.waitForTimeout(300);
  // App-level error: full fallback with home/retry.
  await admin.page.evaluate(()=>window.dispatchEvent(new CustomEvent('dar:zz-error',{detail:'app'})));
  await admin.page.waitForTimeout(500);
  body=await admin.page.locator('body').innerText();
  assert(body.includes('تعذر عرض هذه الصفحة'),'app fallback missing');
  assert(body.includes('العودة للرئيسية') && body.includes('إعادة المحاولة'),'app fallback buttons missing');
  assert(admin.logs.length>0,'no structured console log');
  for(const entry of admin.logs){const obj=entry[1]||{};const keys=Object.keys(obj).sort();assert(JSON.stringify(keys)===JSON.stringify(['componentStack','page','scope']),'log keys changed: '+JSON.stringify(keys));assert(!JSON.stringify(obj).includes('secret-value'),'form value leaked to console');}
  assert(admin.pageErrors.length===0,'unexpected pageerror: '+admin.pageErrors.join('; '));
  checks.push('app_error_and_structured_log');
  await admin.ctx.close();

  async function portal(path,user,waitSel,expectedNav){const ctx=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const r=await page.request.post(BASE+'/api/v1/auth/password',{data:{username:user,password:PASSWORD}});if(!r.ok())throw new Error('portal login '+user+' '+r.status());await page.goto(BASE+path,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForSelector(waitSel,{timeout:60000});await page.waitForTimeout(400);return{ctx,page,errors,expectedNav};}
  console.log('STEP_AFTER_ADMIN');
  const teacher=await portal('/teacher','p29_teacher','.teacher-nav','.teacher-nav');
  await teacher.page.evaluate(()=>window.dispatchEvent(new CustomEvent('dar:zz-error',{detail:'page'})));
  await teacher.page.waitForTimeout(500);
  body=await teacher.page.locator('body').innerText();
  assert(body.includes('تعذر عرض هذه الصفحة'),'teacher fallback missing');
  assert(await teacher.page.locator('.teacher-nav').count()===1,'teacher nav disappeared');
  assert(teacher.errors.length===0,'teacher pageerror: '+teacher.errors.join('; '));
  checks.push('teacher_page_error'); await teacher.ctx.close();

  console.log('STEP_TEACHER');
  const supervisor=await portal('/supervisor','p29_supervisor','.supervisor-app','.supervisor-app');
  await supervisor.page.evaluate(()=>window.dispatchEvent(new CustomEvent('dar:zz-error',{detail:'page'})));
  await supervisor.page.waitForTimeout(500);
  body=await supervisor.page.locator('body').innerText();
  assert(body.includes('تعذر عرض هذه الصفحة'),'supervisor fallback missing');
  assert(await supervisor.page.locator('.sup-side-nav').count()===1,'supervisor nav disappeared');
  assert(supervisor.errors.length===0,'supervisor pageerror: '+supervisor.errors.join('; '));
  checks.push('supervisor_page_error'); await supervisor.ctx.close();

  console.log('STEP_SUPERVISOR');
  console.log(JSON.stringify({ok:true,checks,logCount:admin.logs.length,logSample:admin.logs[0],adminPageErrors:admin.pageErrors},null,2));console.log('P29_PASS');
 }catch(e){console.log(JSON.stringify({ok:false,error:String(e&&e.message||e)},null,2));process.exitCode=1;await browser.close().catch(()=>{})}
 finally{proxy.closeAllConnections?.(); proxy.close();}
setTimeout(()=>process.exit(process.exitCode||0),800).unref();
})();
