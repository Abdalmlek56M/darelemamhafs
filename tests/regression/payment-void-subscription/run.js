const BASE = process.env.P21_BASE_URL || 'http://127.0.0.1:6010';
const PASSWORD = process.env.P21_PASSWORD || 'P21-StrongPass!';
const CONN = process.env.DAR_TEST_DATABASE || '';
let psql, q; // assigned from the shared test library before any test code runs
function assert(c,m){if(!c)throw new Error(m)}
function eq(a,b,m){if(a!==b)throw new Error(m+': got '+a+' expected '+b)}
async function login(ctx){const r=await ctx.post(BASE+'/api/auth/login',{data:{username:'p21_admin',password:PASSWORD}});if(!r.ok())throw new Error('login '+r.status()+': '+(await r.text()).slice(0,200));}

(async()=>{
 const { assertSafeTargets, psql: libPsql, q: libQ, requireEnv } = await import('../../lib/index.mjs');
 requireEnv(['DAR_TEST_DATABASE','P21_BASE_URL'], 'P21_FAIL');
 assertSafeTargets({ db: CONN, urls: [BASE], requireDb: true, label: 'P21_FAIL' });
 psql = (sql) => libPsql(CONN, sql);
 q = (v) => libQ(v);
 const { chromium } = require('playwright');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1400,height:950}});
 const page=await context.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(String(e&&e.message||e)));
 try{
  await login(page.request);
  const ids={
   active: psql("SELECT p.id FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN students s ON s.id=ce.student_id WHERE s.student_code='P21-ACTIVE';"),
   ended: psql("SELECT p.id FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN students s ON s.id=ce.student_id WHERE s.student_code='P21-ENDED';"),
   paused: psql("SELECT p.id FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN students s ON s.id=ce.student_id WHERE s.student_code='P21-PAUSED';"),
   pausedStudent: psql("SELECT p.id FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN students s ON s.id=ce.student_id WHERE s.student_code='P21-PAUSED-STUDENT';"),
   movedOld: psql("SELECT p.id FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN students s ON s.id=ce.student_id WHERE s.student_code='P21-MOVED' AND ce.status='ended';"),
   movedNew: psql("SELECT p.id FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN students s ON s.id=ce.student_id WHERE s.student_code='P21-MOVED' AND ce.status='active';"),
   today: psql("SELECT p.id FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN students s ON s.id=ce.student_id WHERE s.student_code='P21-TODAY';"),
   locked: psql("SELECT p.id FROM payments p JOIN monthly_charges mc ON mc.id=p.monthly_charge_id JOIN circle_enrollments ce ON ce.id=mc.enrollment_id JOIN students s ON s.id=ce.student_id WHERE s.student_code='P21-LOCKED';"),
   endedStudent: psql("SELECT s.id FROM students s WHERE s.student_code='P21-ENDED';")
  };
  async function attempt(key){const r=await page.request.post(BASE+'/api/payments/'+ids[key]+'/void',{data:{reason:'P2-1 test correction'}});return r.status();}
  eq(await attempt('active'),200,'active payment should void');
  eq(await attempt('today'),200,'ends_on today should void');
  eq(await attempt('locked'),200,'payroll-locked month active subscription should void');
  eq(await attempt('ended'),409,'ended enrollment/payment should be blocked');
  eq(await attempt('paused'),409,'paused enrollment should be blocked');
  eq(await attempt('pausedStudent'),409,'paused student should be blocked');
  eq(await attempt('movedOld'),409,'old enrollment after move should be blocked');
  eq(await attempt('movedNew'),200,'new active enrollment payment should void');
  for(const key of ['ended','paused','pausedStudent','movedOld']){ eq(psql("SELECT voided_at IS NULL FROM payments WHERE id="+q(ids[key])+";"),'t','blocked payment '+key+' changed'); }
  const history=await (await page.request.get(BASE+'/api/students/'+ids.endedStudent+'/history')).json();
  const payment=history.charges.flatMap(c=>c.payments).find(p=>p.id===ids.ended);
  assert(payment,'ended payment missing from history');
  assert(payment.voidBlockedReason && payment.voidBlockedReason.includes('انتهت'),'missing Arabic blocked reason: '+JSON.stringify(payment));
  await page.goto(BASE+'/management',{waitUntil:'domcontentloaded',timeout:60000}); await page.waitForTimeout(3000);
  await page.getByRole('button',{name:/الطلاب/}).first().click(); await page.waitForTimeout(500);
  await page.locator('input[placeholder*="ابحث"]').first().fill('P21-ENDED'); await page.waitForTimeout(500);
  await page.locator('button.student-name-link').first().click(); await page.waitForTimeout(1200);
  const blockedButton=page.locator('button[title*="انتهت فترة اشتراك الطالب"]');
  assert(await blockedButton.count()===1,'blocked void button with reason missing');
  assert(await blockedButton.isDisabled(),'blocked void button is not disabled');
  if(errors.length) throw new Error('page errors: '+errors.join(' | ').slice(0,500));
  console.log(JSON.stringify({ok:true,checks:14,errors},null,2)); console.log('P21_PASS');
 }catch(e){let body='';try{body=(await page.locator('body').innerText()).slice(0,500)}catch{};console.log(JSON.stringify({ok:false,error:String(e&&e.message||e),body},null,2));process.exitCode=1}finally{await browser.close()}
})();
