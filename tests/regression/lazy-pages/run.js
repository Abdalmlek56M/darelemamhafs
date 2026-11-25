const { chromium } = require('playwright');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const BASE = process.env.P28B_BASE_URL || '';
const LEGACY_ORIGIN = process.env.P28B_LEGACY_URL || '';
const NEW_ORIGIN = process.env.P28B_NEW_URL || '';
const CONN = process.env.DAR_TEST_DATABASE || '';
const SETUP_TOKEN = process.env.P28B_SETUP_TOKEN || '';
const PASSWORD = process.env.P28B_PASSWORD || 'P28B-StrongPass!';
const PROD_HOSTS = ['dar-elemam-hafs.rigxhardware.com', '31.220.76.171'];
for (const raw of [BASE, LEGACY_ORIGIN, NEW_ORIGIN]) { try { const u=new URL(raw); if(PROD_HOSTS.includes(u.hostname.toLowerCase())||!['127.0.0.1','localhost','::1','[::1]'].includes(u.hostname.toLowerCase())){console.error('P28B_FAIL non-test URL');process.exit(2);} } catch { console.error('P28B_FAIL invalid URL');process.exit(2);} }
if (!CONN || !SETUP_TOKEN) { console.error('P28B_FAIL missing env'); process.exit(2); }
if (/database\s*=\s*dareltahfeez\b/i.test(CONN)) { console.error('P28B_FAIL production database'); process.exit(2); }

function pgEnv(){const e={...process.env};for(const part of CONN.split(';')){const i=part.indexOf('=');if(i<0)continue;const k=part.slice(0,i).trim().toLowerCase(),v=part.slice(i+1).trim();if(k==='host')e.PGHOST=v;if(k==='port')e.PGPORT=v;if(k==='database')e.PGDATABASE=v;if(k==='username')e.PGUSER=v;if(k==='password')e.PGPASSWORD=v;}return e;}
const PGENV=pgEnv();
function psql(sql){const r=spawnSync('psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{env:PGENV,encoding:'utf8'});if(r.status!==0)throw new Error('psql: '+(r.stderr||'').trim());return (r.stdout||'').trim();}
function q(v){return "'"+String(v).replaceAll("'","''")+"'";}
async function login(username,password,path='/api/auth/login'){
 const r=await fetch(BASE+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
 if(!r.ok) throw new Error('login '+username+' '+r.status+': '+(await r.text()).slice(0,200));
 const cookies=r.headers.getSetCookie?r.headers.getSetCookie():[r.headers.get('set-cookie')];
 return cookies.filter(Boolean).map(v=>v.split(';')[0]).join('; ');
}
function seedBase(){const teacher=randomUUID(),circle=randomUUID(),slot=randomUUID(),tag=teacher.slice(0,8);psql('INSERT INTO teachers(id,teacher_code,full_name,status,hourly_rate) VALUES ('+q(teacher)+','+q('P28B-T-'+tag)+",'P28B Teacher','active',60);"+'INSERT INTO circles(id,circle_code,name,teacher_id,monthly_fee,is_active,starts_on) VALUES ('+q(circle)+','+q('P28B-C-'+tag)+",'P28B Circle',"+q(teacher)+',0,TRUE,DATE \'2026-01-01\');'+"INSERT INTO circle_schedule_slots(id,circle_id,day_of_week,starts_at,duration_minutes,is_active) VALUES ("+q(slot)+','+q(circle)+",1,'10:00',60,TRUE);");return{teacher,circle,slot};}

(async()=>{
 // Same-origin proxy: page/legacy on LEGACY_ORIGIN, new API under /api/v1.
 const baseUrl=new URL(BASE), legacyUrl=new URL(LEGACY_ORIGIN), newUrl=new URL(NEW_ORIGIN);
 const proxy=http.createServer((req,res)=>{const target=req.url.startsWith('/api/v1')?newUrl:legacyUrl;const opts={hostname:target.hostname,port:target.port,path:req.url,method:req.method,headers:{...req.headers,host:target.host}};const up=http.request(opts,r=>{res.writeHead(r.statusCode||502,r.headers);r.pipe(res)});up.on('error',e=>{res.writeHead(502);res.end('proxy error '+e.message)});req.pipe(up)});
 await new Promise((resolve)=>proxy.listen(Number(baseUrl.port),baseUrl.hostname,resolve));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const results=[];
 try{
  const setup=await fetch(BASE+'/api/setup/admin',{method:'POST',headers:{'content-type':'application/json','X-Setup-Token':SETUP_TOKEN},body:JSON.stringify({username:'p28b_admin',displayName:'P28B Admin',password:PASSWORD})});
  if(![200,409].includes(setup.status)) throw new Error('setup '+setup.status+': '+(await setup.text()).slice(0,200));
  const base=seedBase();
  psql('INSERT INTO school_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;');
  psql("UPDATE app_users SET avatar_data=decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'), avatar_content_type='image/png' WHERE username='p28b_admin';");
  psql("INSERT INTO user_permissions(user_id, permission_code) SELECT id, 'meet.bot.control' FROM app_users WHERE username='p28b_admin' ON CONFLICT DO NOTHING;");
  const adminCookie=await login('p28b_admin',PASSWORD);
  async function createUser(username,displayName,permissions,teacherId){const r=await fetch(BASE+'/api/admin/users',{method:'POST',headers:{'content-type':'application/json',cookie:adminCookie},body:JSON.stringify({username,displayName,password:PASSWORD,permissionCodes:permissions,teacherId})});if(![201,409].includes(r.status))throw new Error('create '+username+' '+r.status+': '+(await r.text()).slice(0,200));}
  const teacherPerms=['teacher.portal','teacher.attendance','teacher.requests','teacher.calendar','teacher.history.self','teacher.earnings.self','teacher.subscriptions.read','account.password.self'];
  const supervisorPerms=['supervisor.portal','supervisor.students.read','supervisor.students.create','supervisor.circles.read','supervisor.teachers.read','supervisor.teachers.notes','supervisor.absences','supervisor.attendance.correct','supervisor.attendance.requests','supervisor.unpaid','supervisor.live','supervisor.communication','account.password.self'];
  await createUser('p28b_teacher','P28B Teacher',teacherPerms,base.teacher);
  await createUser('p28b_supervisor','P28B Supervisor',supervisorPerms,null);
  psql("UPDATE app_users SET avatar_data=decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'), avatar_content_type='image/png' WHERE username IN ('p28b_teacher','p28b_supervisor');");

  const expected={"لوحة التحكم":"DashboardPage-","الإشعارات":"NotificationsPage-","طلبات المعلمات":"AdminRequestsPage-","الطلاب":"StudentsPage-","المعلمات":"TeachersPage-","ملاحظات المعلمات":"TeacherNotesPage-","الحلقات":"CirclesPage-","المواعيد وحضور المعلمات":"SchedulePage-","الاشتراكات والتحصيل":"PaymentsPage-","التسجيل والمحاضرات":"MeetPage-","الحسابات والصلاحيات":"UsersPage-","النظام والنسخ الاحتياطي":"SystemPage-"};
  const labels=['لوحة التحكم','الإشعارات','طلبات المعلمات','الطلاب','المعلمات','ملاحظات المعلمات','الحلقات','المواعيد وحضور المعلمات','الاشتراكات والتحصيل','التسجيل والمحاضرات','الحسابات والصلاحيات','النظام والنسخ الاحتياطي'];
  const admin=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await admin.addInitScript(()=>sessionStorage.setItem('dar:lazy-chunk-reload','1'));
  const adminPage=await admin.newPage();
  const adminErrors=[]; const adminFailed=[]; adminPage.on('pageerror',e=>adminErrors.push('pageerror: '+e.message)); adminPage.on('console',m=>{if(m.type()==='error')adminErrors.push('console: '+m.text())}); adminPage.on('response',r=>{if(r.status()>=400)adminFailed.push(r.status()+' '+r.url())});
  const adminAssets=[]; adminPage.on('request',r=>{if(r.url().includes('/assets/'))adminAssets.push(new URL(r.url()).pathname.split('/').pop())});
  await adminPage.request.post(BASE+'/api/auth/login',{data:{username:'p28b_admin',password:PASSWORD}});
  await adminPage.goto(BASE+'/management',{waitUntil:'domcontentloaded',timeout:60000});
  await adminPage.waitForSelector('.nav-list',{timeout:60000});
  const initialAssets=[...adminAssets];
  if(!initialAssets.some(x=>x.startsWith('DashboardPage-'))) throw new Error('initial dashboard chunk missing: '+JSON.stringify(initialAssets));
  const guard=await adminPage.evaluate(()=>sessionStorage.getItem('dar:lazy-chunk-reload'));
  if(guard!==null) throw new Error('successful load did not clear reload guard: '+guard);
  if(adminAssets.some(x=>x.startsWith('SystemPage-')||x.startsWith('MeetPage-'))) throw new Error('heavy chunks loaded before navigation');
  for(const label of labels){
   const before=new Set(adminAssets);
   const btn=adminPage.locator('.nav-list').getByRole('button',{name:label,exact:true});
   if(await btn.count()===0) throw new Error('nav button missing: '+label);
   await btn.click();
   await adminPage.waitForTimeout(900);
   const after=adminAssets.filter(x=>!before.has(x));
   const title=await adminPage.locator('.topbar h1, header h1, .system-title, h1').first().innerText().catch(()=>'');
   if(label!=='لوحة التحكم' && !after.some(x=>x.startsWith(expected[label]))) throw new Error('expected chunk for '+label+' ('+expected[label]+') missing; loaded='+JSON.stringify(after)+' title='+title);
   if(label==='النظام والنسخ الاحتياطي' && !after.some(x=>x.startsWith('SystemPage-'))) throw new Error('SystemPage chunk not loaded on open');
   if(label==='التسجيل والمحاضرات' && !after.some(x=>x.startsWith('MeetPage-'))) throw new Error('MeetPage chunk not loaded on open');
   results.push({page:label,newChunks:after});
  }
  if (adminErrors.length) throw new Error('admin console/page errors: '+JSON.stringify(adminErrors));
  if (adminFailed.length) throw new Error('admin failed responses: '+JSON.stringify(adminFailed));
  await admin.close();

  async function openPortal(path, username, waitSelector) {
    const ctx=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
    await ctx.addInitScript(()=>sessionStorage.setItem('dar:lazy-chunk-reload','1'));
    const page=await ctx.newPage(); const errors=[]; const failed=[]; const assets=[];
    page.on('pageerror',e=>errors.push('pageerror: '+e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text())});
    page.on('response',r=>{if(r.status()>=400)failed.push(r.status()+' '+r.url())});
    page.on('request',r=>{if(r.url().includes('/assets/'))assets.push(new URL(r.url()).pathname.split('/').pop())});
    const login=await page.request.post(BASE+'/api/v1/auth/password',{data:{username,password:PASSWORD}});
    if(!login.ok()) throw new Error('portal login '+username+' '+login.status()+': '+(await login.text()).slice(0,160));
    await page.goto(BASE+path,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForSelector(waitSelector,{timeout:60000});
    const guard=await page.evaluate(()=>sessionStorage.getItem('dar:lazy-chunk-reload'));
    if(guard!==null) throw new Error(path+' did not clear reload guard: '+guard);
    return {ctx,page,errors,failed,assets};
  }

  const teacher=await openPortal('/teacher','p28b_teacher','.teacher-nav');
  if(!teacher.assets.some(x=>x.startsWith('TeacherHome-'))) throw new Error('TeacherHome chunk missing: '+JSON.stringify(teacher.assets));
  async function teacherClick(label, expectedChunk) {
    const before=new Set(teacher.assets); const btn=teacher.page.locator('.teacher-nav').getByRole('button',{name:label,exact:true});
    if(await btn.count()===0) throw new Error('teacher nav missing: '+label);
    await btn.click(); await teacher.page.waitForTimeout(700);
    const after=teacher.assets.filter(x=>!before.has(x));
    if(expectedChunk && !after.some(x=>x.startsWith(expectedChunk))) throw new Error('teacher chunk '+expectedChunk+' not loaded for '+label+' loaded='+JSON.stringify(after));
    results.push({portal:'teacher',page:label,newChunks:after});
  }
  await teacherClick('التنبيهات','TeacherNotifications-');
  await teacherClick('الطلبات','TeacherRequests-');
  await teacherClick('حسابي','TeacherAccount-');
  await teacherClick('اليوم');
  const calendarBtn=teacher.page.getByRole('button',{name:/تقويم الأسبوع/}).first();
  await calendarBtn.click(); await teacher.page.waitForTimeout(700);
  if(!teacher.assets.some(x=>x.startsWith('TeacherCalendar-'))) throw new Error('TeacherCalendar chunk missing');
  results.push({portal:'teacher',page:'التقويم',newChunks:['TeacherCalendar-']});
  await teacherClick('اليوم');
  await teacher.page.getByRole('button',{name:/سجلي/}).first().click(); await teacher.page.waitForTimeout(700);
  if(!teacher.assets.some(x=>x.startsWith('TeacherHistory-'))) throw new Error('TeacherHistory chunk missing');
  results.push({portal:'teacher',page:'السجل',newChunks:['TeacherHistory-']});
  await teacherClick('اليوم');
  await teacher.page.getByRole('button',{name:/الاشتراكات/}).first().click(); await teacher.page.waitForTimeout(700);
  if(!teacher.assets.some(x=>x.startsWith('TeacherSubscriptions-'))) throw new Error('TeacherSubscriptions chunk missing');
  results.push({portal:'teacher',page:'الاشتراكات',newChunks:['TeacherSubscriptions-']});
  if(teacher.failed.length) throw new Error('teacher failed responses: '+JSON.stringify(teacher.failed));
  if(teacher.errors.length) throw new Error('teacher console/page errors: '+JSON.stringify(teacher.errors));
  await teacher.ctx.close();

  const supervisor=await openPortal('/supervisor','p28b_supervisor','.supervisor-app');
  if(!supervisor.assets.some(x=>x.startsWith('SupervisorWorkspace-'))) throw new Error('SupervisorWorkspace chunk missing: '+JSON.stringify(supervisor.assets));
  const supBtn=supervisor.page.locator('.sup-side-nav').getByRole('button',{name:'الطالبات',exact:true}).first();
  if(await supBtn.count()>0){await supBtn.click();await supervisor.page.waitForTimeout(700)}
  results.push({portal:'supervisor',page:'نظرة عامة',newChunks:['SupervisorWorkspace-']});
  if(supervisor.failed.length) throw new Error('supervisor failed responses: '+JSON.stringify(supervisor.failed));
  if(supervisor.errors.length) throw new Error('supervisor console/page errors: '+JSON.stringify(supervisor.errors));
  await supervisor.ctx.close();
  await browser.close();
  console.log(JSON.stringify({ok:true,checks:labels.length,adminErrors,adminFailed,teacherFailed:teacher.failed,teacherErrors:teacher.errors,supervisorFailed:supervisor.failed,supervisorErrors:supervisor.errors,results},null,2));console.log('P28B_ALL_PASS');
 }catch(e){console.log(JSON.stringify({ok:false,error:String(e&&e.message||e),adminErrors:typeof adminErrors!=='undefined'?adminErrors:[],adminFailed:typeof adminFailed!=='undefined'?adminFailed:[]},null,2));process.exitCode=1;await browser.close().catch(()=>{})}
 finally{proxy.close();}
})();
