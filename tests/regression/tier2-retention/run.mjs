import { strict as assert } from 'node:assert';
import { setup, one, q, req, NEW } from '../request-workflow/common.mjs';

const c = await setup();

// FINAL 2.4: expired auth/notification/communication rows are pruned; audit_log is never touched.
const userId = c.adminId;
one(`INSERT INTO auth_sessions(id,user_id,ticket,expires_at) VALUES (gen_random_uuid(),${q(userId)},'old-ticket',now() - INTERVAL '30 days');`);
one(`INSERT INTO auth_sessions(id,user_id,ticket,expires_at) VALUES (gen_random_uuid(),${q(userId)},'fresh-ticket',now() + INTERVAL '30 days');`);
one(`INSERT INTO auth_email_otps(id,email,code_hash,expires_at) VALUES (gen_random_uuid(),'old@example.invalid','x',now() - INTERVAL '30 days');`);
one(`INSERT INTO auth_email_otps(id,email,code_hash,expires_at) VALUES (gen_random_uuid(),'fresh@example.invalid','x',now() + INTERVAL '5 minutes');`);
one(`INSERT INTO notifications(id,role_scope,category,status,severity,title,body,dedupe_key,resolved_at)
  VALUES (gen_random_uuid(),'supervisor','system','resolved','info','old','old','t2-ret-old',now() - INTERVAL '365 days');`);
one(`INSERT INTO notifications(id,role_scope,category,status,severity,title,body,dedupe_key)
  VALUES (gen_random_uuid(),'supervisor','system','open','info','fresh','fresh','t2-ret-fresh');`);
one(`INSERT INTO communication_log(id,recipient_type,recipient_id,phone,template_key,created_at)
  VALUES (gen_random_uuid(),'teacher',gen_random_uuid(),'01000000000','t2-ret',now() - INTERVAL '730 days');`);
one(`INSERT INTO communication_log(id,recipient_type,recipient_id,phone,template_key,created_at)
  VALUES (gen_random_uuid(),'student_guardian',gen_random_uuid(),'01000000001','payment-reminder',now() - INTERVAL '730 days');`);
one(`INSERT INTO communication_log(id,recipient_type,recipient_id,phone,template_key,created_at)
  VALUES (gen_random_uuid(),'student_guardian',gen_random_uuid(),'01000000002','subscription-due',now() - INTERVAL '730 days');`);
one(`INSERT INTO audit_log(actor_user_id,action_code,entity_type,entity_id,details)
  VALUES (${q(userId)},'retention.audit.test','app_user',${q(userId)},'{}'::jsonb);`);
const auditBefore = one(`SELECT count(*) FROM audit_log WHERE action_code='retention.audit.test';`);

const response = await req(NEW, c.admin, 'POST', '/api/v1/system/retention/run');
assert.equal(response.status, 200, 'retention endpoint ' + response.text.slice(0, 300));

assert.equal(one("SELECT count(*) FROM auth_sessions WHERE ticket='old-ticket';"), '0', 'expired session kept');
assert.equal(one("SELECT count(*) FROM auth_sessions WHERE ticket='fresh-ticket';"), '1', 'fresh session deleted');
assert.equal(one("SELECT count(*) FROM auth_email_otps WHERE email='old@example.invalid';"), '0', 'expired otp kept');
assert.equal(one("SELECT count(*) FROM auth_email_otps WHERE email='fresh@example.invalid';"), '1', 'fresh otp deleted');
assert.equal(one("SELECT count(*) FROM notifications WHERE dedupe_key='t2-ret-old';"), '0', 'resolved old notification kept');
assert.equal(one("SELECT count(*) FROM notifications WHERE dedupe_key='t2-ret-fresh';"), '1', 'fresh notification deleted');
assert.equal(one("SELECT count(*) FROM communication_log WHERE template_key='t2-ret';"), '0', 'old general communication log kept');
assert.equal(one("SELECT count(*) FROM communication_log WHERE template_key='payment-reminder';"), '1', 'money-related communication log was pruned');
assert.equal(one("SELECT count(*) FROM communication_log WHERE template_key='subscription-due';"), '1', 'subscription communication log was pruned');
assert.equal(one("SELECT count(*) FROM audit_log WHERE action_code='retention.audit.test';"), auditBefore, 'retention pruned audit_log');

console.log(JSON.stringify({ suite: 'tier2-retention', ok: true, cases: 6 }));
