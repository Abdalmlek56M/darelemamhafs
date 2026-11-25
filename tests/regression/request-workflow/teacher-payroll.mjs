import { setup, insertRequest, review, req, one, q, OLD, NEW } from './common.mjs';

const c = await setup();


const results = [];

function assertCase(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);


  results.push({ name, ok, actual, expected });
  if (!ok) throw new Error(name + ' mismatch: ' + JSON.stringify({ actual,
 expected }));

}

const pending = insertRequest('absence', '2027-01-18');
const cancel = await req(NEW,
 c.teacher, 'POST', '/api/v1/teacher/requests/' + pending + '/cancel', {});

assertCase('cancel_pending_status',
 cancel.status, 200);
assertCase('cancel_pending_db', one('SELECT status FROM attendance_requests WHERE id=' + q(pending) + ';'),
 'cancelled');


for (const status of ['approved', 'rejected', 'cancelled']) {
  const id = insertRequest('absence',
 '2027-03-' + (status === 'approved' ? '08' : status === 'rejected' ? '15' : '22'));

  if (status === 'approved') await review(OLD,
 c.revOld, id);
  else if (status === 'rejected') await review(OLD, c.revOld, id, false, 'no');

  else one("UPDATE attendance_requests SET status='cancelled' WHERE id=" + q(id) + ';');

  const resp = await req(NEW, c.teacher, 'POST', '/api/v1/teacher/requests/' + id + '/cancel', {});

  assertCase('cancel_' + status + '_status',
 resp.status, 404);
  assertCase('cancel_' + status + '_db', one('SELECT status FROM attendance_requests WHERE id=' + q(id) + ';'),
 status);

}

one("INSERT INTO payroll_locks(billing_month,is_locked,locked_by) VALUES "
  + "(DATE '2027-02-01',TRUE," + q(c.adminId) + ") "
  + "ON CONFLICT (billing_month) DO UPDATE SET is_locked=TRUE;");


const oldId = insertRequest('absence', '2027-02-01');
const newId = insertRequest('absence', '2027-02-08');


const oldLock = await review(OLD, c.revOld, oldId);
const newLock = await review(NEW, c.revNew, newId);


assertCase('payroll_lock_old', [oldLock.status, oldLock.db.request.status, oldLock.db.attendance], [409,
 'pending', null]);

assertCase('payroll_lock_new', [newLock.status, newLock.db.request.status, newLock.db.attendance],
 [409, 'pending', null]);


console.log(JSON.stringify({ suite: 'teacher-payroll', count: results.length,
 results }, null, 2));

