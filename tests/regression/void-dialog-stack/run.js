const BASE = process.env.P26F_BASE_URL || 'http://127.0.0.1:6010';
const PASSWORD = process.env.P26F_PASSWORD || 'P26F-StrongPass!';
(async()=>{
 const { assertSafeTargets } = await import('../../lib/index.mjs');
 assertSafeTargets({ urls: [BASE], label: 'P26F_FAIL' });
 const { chromium } = require('playwright');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:1400,height:950}});
 try{
  const login=await page.request.post(BASE+'/api/auth/login',{data:{username:'p26f_admin',password:PASSWORD}});
  if(!login.ok())throw new Error('login '+login.status());
  await page.goto(BASE+'/management',{waitUntil:'domcontentloaded',timeout:60000}); await page.waitForTimeout(3000);
  await page.getByRole('button',{name:/الطلاب/}).first().click(); await page.waitForTimeout(500);
  await page.locator('input[placeholder*="ابحث"]').first().fill('P26F-STUDENT'); await page.waitForTimeout(500);
  await page.locator('button.student-name-link').first().click(); await page.waitForTimeout(1200);
  const voidButton=page.locator('button[title="إلغاء حركة التحصيل (Void) مع الاحتفاظ بالسجل"]').first();
  if(!(await voidButton.count()))throw new Error('void button missing');
  await voidButton.click(); await page.waitForTimeout(500);
  const dialog=page.locator('[role="dialog"]').filter({hasText:'إلغاء حركة التحصيل'});
  if(!(await dialog.count()))throw new Error('void dialog missing');
  const box=await dialog.boundingBox(); if(!box)throw new Error('void dialog not rendered');
  const historyDialog=page.locator('[role="dialog"]').filter({hasText:'ملف الطالب'});
  if(!(await historyDialog.count()))throw new Error('student history missing');
  const historyBox=await historyDialog.boundingBox();
  if(!historyBox)throw new Error('history not visible');
  // The void dialog must be interactable above the student history.
  await page.locator('#void-reason').fill('P2-6 modal stacking test');
  await page.getByRole('button',{name:/تأكيد الإلغاء/}).click(); await page.waitForTimeout(2500);
  if(await page.locator('[role="dialog"]').filter({hasText:'إلغاء حركة التحصيل'}).count())throw new Error('void dialog still open after submit');
  console.log(JSON.stringify({ok:true,voidBox:box,historyBox},null,2)); console.log('P26F_PASS');
 }catch(e){let body='';try{body=(await page.locator('body').innerText()).slice(0,700)}catch{};console.log(JSON.stringify({ok:false,error:String(e&&e.message||e),body},null,2));process.exitCode=1}finally{await browser.close()}
})();
