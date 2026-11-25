import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const CONN = process.env.DAR_TEST_DATABASE || '';
const LEGACY = process.env.Q4_LEGACY_URL || '';
const SETUP = process.env.Q4_SETUP_TOKEN || '';
const PASSWORD = process.env.Q4_PASSWORD || 'Q4-StrongPass!';
const PROD_HOSTS = ['dar-elemam-hafs.rigxhardware.com', '31.220.76.171'];
if (!CONN || !LEGACY || !SETUP) { console.error('Q4_FAIL missing env'); process.exit(2); }
if (/database\s*=\s*dareltahfeez/i.test(CONN)) { console.error('Q4_FAIL production database'); process.exit(2); }
const dbHost = /host\s*=\s*([^;]+)/i.exec(CONN)?.[1]?.trim().toLowerCase() || '';
if (PROD_HOSTS.includes(dbHost)) { console.error('Q4_FAIL production database host'); process.exit(2); }
const url = new URL(LEGACY); if (PROD_HOSTS.includes(url.hostname.toLowerCase()) || !['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname.toLowerCase())) { console.error('Q4_FAIL non-loopback URL'); process.exit(2); }

function pgEnv() { const e = { ...process.env }; for (const part of CONN.split(';')) { const i = part.indexOf('='); if (i < 0) continue; const k = part.slice(0, i).trim().toLowerCase(), v = part.slice(i + 1).trim(); if (k==='host') e.PGHOST=v; if (k==='port') e.PGPORT=v; if (k==='database') e.PGDATABASE=v; if (k==='username') e.PGUSER=v; if (k==='password') e.PGPASSWORD=v; } return e; }
const PGE = pgEnv();
function psql(sql) { const r = spawnSync('psql', ['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',sql], { env: PGE, encoding: 'utf8' }); if (r.status !== 0) throw new Error('psql: ' + (r.stderr||'').trim()); return (r.stdout||'').trim(); }
const q = v => "'" + String(v).replaceAll("'", "''") + "'";

async function login() { const r = await fetch(LEGACY + '/api/auth/login', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ username:'q4_admin', password:PASSWORD }) }); if (!r.ok) throw new Error('login ' + r.status); const c = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]; return c.filter(Boolean).map(x=>x.split(';')[0]).join('; '); }
function seed(date, duration, status, amount, reviewerId) { const t=randomUUID(), c=randomUUID(), s=randomUUID(), sess=randomUUID(), att=randomUUID(); psql('BEGIN;' +
  'INSERT INTO teachers(id,teacher_code,full_name,status,hourly_rate) VALUES ('+q(t)+','+q('Q4-T-'+t.slice(0,8))+",'Q4 Teacher','active',60);" +
  'INSERT INTO circles(id,circle_code,name,teacher_id,monthly_fee,is_active,starts_on) VALUES ('+q(c)+','+q('Q4-C-'+c.slice(0,8))+",'Q4 Circle',"+q(t)+",0,TRUE,DATE '2026-01-01');" +
  "INSERT INTO circle_schedule_slots(id,circle_id,day_of_week,starts_at,duration_minutes,is_active) VALUES ("+q(s)+','+q(c)+",1,'10:00',60,TRUE);" +
  "INSERT INTO teacher_sessions(id,teacher_id,circle_id,schedule_slot_id,session_date,started_at,ended_at,status,scheduled_duration_minutes,actual_duration_minutes,payable_duration_minutes,pay_basis) VALUES ("+q(sess)+','+q(t)+','+q(c)+','+q(s)+","+q(date)+",now() - INTERVAL '10 minutes',now() + INTERVAL '60 minutes','completed',60,"+duration+','+duration+",'actual');" +
  'INSERT INTO teacher_attendance(id,schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,duration_minutes,status,hourly_rate_snapshot,payable_amount,marked_by,teacher_session_id,actual_duration_minutes,pay_basis) VALUES ('+q(att)+','+q(s)+','+q(c)+','+q(t)+','+q(date)+",'10:00',"+duration+','+q(status)+',60,'+amount+','+q(reviewerId)+','+q(sess)+','+duration+",'manual');" + 'COMMIT;'); return {t,c,s,att}; }
async function mark(slot, date, status) { return fetch(LEGACY + '/api/teacher-attendance', { method:'POST', headers:{'content-type':'application/json', cookie: await login()}, body: JSON.stringify({ scheduleSlotId: slot, sessionDate: date, status }) }); }

(async()=>{
 const setup = await fetch(LEGACY+'/api/setup/admin',{method:'POST',headers:{'content-type':'application/json','X-Setup-Token':SETUP},body:JSON.stringify({username:'q4_admin',displayName:'Q4 Admin',password:PASSWORD})}); if (![200,409].includes(setup.status)) throw new Error('setup '+setup.status);
 const reviewerId = psql("SELECT id FROM app_users WHERE username='q4_admin';");
 const present = seed('2026-11-02',30,'present',30,reviewerId);
 const r1 = await mark(present.s,'2026-11-02','present'); if (r1.status!==200) throw new Error('present mark '+r1.status+': '+(await r1.text()).slice(0,800));
 const a1 = JSON.parse(psql("SELECT json_build_object('duration',duration_minutes,'payable',payable_amount,'status',status)::text FROM teacher_attendance WHERE id="+q(present.att)+';'));
 if (Number(a1.duration)!==30 || Number(a1.payable)!==30) throw new Error('present re-mark changed: '+JSON.stringify(a1));
 const absent = seed('2026-11-09',45,'present',45,reviewerId);
 const r2 = await mark(absent.s,'2026-11-09','absent'); if (r2.status!==200) throw new Error('absent mark '+r2.status+': '+(await r2.text()).slice(0,800));
 const a2 = JSON.parse(psql("SELECT json_build_object('duration',duration_minutes,'payable',payable_amount,'status',status)::text FROM teacher_attendance WHERE id="+q(absent.att)+';'));
 if (Number(a2.duration)!==45 || Number(a2.payable)!==0 || a2.status!=='absent') throw new Error('absent re-mark changed: '+JSON.stringify(a2));
 console.log(JSON.stringify({ok:true,checks:6,present:a1,absent:a2},null,2)); console.log('Q4_MONEY_PASS');
})().catch(e=>{console.error('Q4_MONEY_FAIL '+String(e&&e.stack||e));process.exit(1)});
