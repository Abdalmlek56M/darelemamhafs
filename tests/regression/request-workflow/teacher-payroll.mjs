import { setup, insertRequest, review, req, one, q, OLD, NEW } from './common.mjs';

const c = await setup();
const results = [];
const add = (name, value) => results.push({ name, value });

const cancelId = insertRequest('absence', '2027-01-18');
const cancel = await req(NEW, c.teacher, 'POST', '/api/v1/teacher/requests/' + cancelId + '/cancel', {});
add('teacher_cancel', { status: cancel.status, body: cancel.text.slice(0, 240), dbStatus: one("SELECT status FROM attendance_requests WHERE id=" + q(cancelId) + ';') });

one("INSERT INTO payroll_locks(billing_month,is_locked,locked_by) VALUES (DATE '2027-02-01',TRUE," + q(c.adminId) + ") ON CONFLICT (billing_month) DO UPDATE SET is_locked=TRUE;");
const oldId = insertRequest('absence', '2027-02-01');
const newId = insertRequest('absence', '2027-02-08');
add('payroll_lock_old', await review(OLD, c.revOld, oldId));
add('payroll_lock_new', await review(NEW, c.revNew, newId));


for (const [name, date, status] of [['approved', '2027-03-08', 'approved'], ['rejected', '2027-03-15', 'rejected'], ['cancelled', '2027-03-22', 'cancelled']]) { const id = insertRequest('absence', date); if (status === 'approved') await review(OLD, c.revOld, id); else if (status === 'rejected') await review(OLD, c.revOld, id, false, 'no'); else one("UPDATE attendance_requests SET status='cancelled' WHERE id=" + q(id) + ';'); const resp = await req(NEW, c.teacher, 'POST', '/api/v1/teacher/requests/' + id + '/cancel', {}); add('teacher_cancel_' + name, { status: resp.status, body: resp.text.slice(0, 160), dbStatus: one("SELECT status FROM attendance_requests WHERE id=" + q(id) + ';') }); }

console.log(JSON.stringify({ suite: 'teacher-payroll', ok: true, count: results.length, results }, null, 2));
