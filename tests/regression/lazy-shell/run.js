const { chromium } = require('playwright');
const BASE = process.env.P28A_BASE_URL || 'http://127.0.0.1:6015';
const APP_CHUNK = process.env.P28A_APP_CHUNK || '';
if (!APP_CHUNK) { console.error('P28A_FAIL missing APP_CHUNK'); process.exit(2); }
const PROD_HOSTS = (process.env.DAR_FORBIDDEN_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
try { const u=new URL(BASE); if(PROD_HOSTS.includes(u.hostname.toLowerCase())||!['127.0.0.1','localhost','::1','[::1]'].includes(u.hostname.toLowerCase())){console.error('P28A_FAIL non-test URL');process.exit(2);} } catch { console.error('P28A_FAIL invalid URL'); process.exit(2); }
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1400,height:950}, serviceWorkers:'block'});
 const page=await context.newPage();
 const assets=[]; page.on('request',(r)=>{ if(r.url().includes('/assets/')) assets.push(r.url()); });
 let navigations=0; page.on('framenavigated',()=>navigations++);
 try{
  await page.route('**/assets/'+APP_CHUNK, (route) => route.abort());
  await page.goto(BASE+'/management',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForTimeout(3500);
  const body=await page.locator('body').innerText();
  if(!body.includes('تعذر تحميل الصفحة'))throw new Error('Arabic lazy error UI missing: '+body.slice(0,400)+' assets='+JSON.stringify(assets));
  const key=await page.evaluate(()=>sessionStorage.getItem('dar:lazy-chunk-reload'));
  if(key!=='1')throw new Error('one-shot reload guard missing: '+key);
  if(navigations<2)throw new Error('boundary did not auto reload once; navigations='+navigations);
  console.log(JSON.stringify({ok:true,checks:3,navigations},null,2));console.log('P28A_PASS');
 }catch(e){console.log(JSON.stringify({ok:false,error:String(e&&e.message||e),navigations},null,2));process.exitCode=1}finally{await browser.close()}
})();
