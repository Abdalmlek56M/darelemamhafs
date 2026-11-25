import { setup, review, insertRequest, seedAttendance, snapshot, normalize, req, one, q, OLD } from './common.mjs';



const c = await setup();
const results = [];

function assertCase(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);


  results.push({ name, ok, actual, expected });
  if (!ok) throw new Error(name + ' mismatch: ' + JSON.stringify({ actual,
 expected }));

}

function attendRow(row) {
  return row ? { status: row.status, duration: row.duration_minutes,
 payable: row.payable_amount, trashed: row.is_trashed } : null;

}

function sessionRow(row) {
  return row ? { status: row.status,
 actual: row.actual_duration_minutes, payableDuration: row.payable_duration_minutes } : null;

}

const absence = insertRequest('absence',
 '2026-12-28');
const before = normalize(snapshot(absence));

const approved = await review(OLD, c.revOld,
 absence);
const reopen = await req(OLD, c.revOld, 'POST', '/api/admin/requests/' + absence + '/reopen',
 {});

const after = normalize(snapshot(absence));
assertCase('reopen_absence_status', reopen.status,
 200);

assertCase('reopen_absence_request', after.request.status, 'pending');
assertCase('reopen_absence_effect',
 [after.request.effect_before, after.request.effect_after], [null, null]);

assertCase('reopen_absence_attendance',
 attendRow(after.attendance), { status: 'absent', duration: 60, payable: 0, trashed: true });

assertCase('reopen_absence_before_empty',
 attendRow(before.attendance), null);

const corrDate = '2027-02-08';

const corrAtt = seedAttendance(corrDate);

const corr = insertRequest('correction', corrDate, corrAtt, { durationMinutes: 45, status: 'present' });


const corrBefore = normalize(snapshot(corr));
const corrApproved = await review(OLD, c.revOld, corr);


const corrReopen = await req(OLD, c.revOld, 'POST', '/api/admin/requests/' + corr + '/reopen', {});

const corrAfter = normalize(snapshot(corr));

assertCase('reopen_correction_status', corrReopen.status,
 200);
assertCase('reopen_correction_request', corrAfter.request.status, 'pending');

assertCase('reopen_correction_effect',
 [corrAfter.request.effect_before, corrAfter.request.effect_after], [null, null]);

assertCase('reopen_correction_attendance',
 attendRow(corrAfter.attendance), attendRow(corrBefore.attendance));

assertCase('reopen_correction_session',
 sessionRow(corrAfter.session), sessionRow(corrBefore.session));

assertCase('reopen_correction_approved_attendance',
 attendRow(corrApproved.db.attendance), { status: 'present', duration: 45, payable: 45, trashed: false });



const approvedDel = insertRequest('absence', '2027-02-15');
await review(OLD, c.revOld, approvedDel);


const approvedDelResp = await req(OLD, c.revOld, 'POST', '/api/admin/requests/' + approvedDel + '/delete',
 {});

assertCase('delete_approved_status', approvedDelResp.status, 409);
assertCase('delete_approved_trashed',
 one('SELECT is_trashed FROM attendance_requests WHERE id=' + q(approvedDel) + ';'), 'f');


const rejectedDel = insertRequest('absence',
 '2027-02-22');
await review(OLD, c.revOld, rejectedDel, false, 'no');

const rejectedDelResp = await req(OLD,
 c.revOld, 'POST', '/api/admin/requests/' + rejectedDel + '/delete', {});

assertCase('delete_rejected_status',
 rejectedDelResp.status, 200);
assertCase('delete_rejected_trashed',
  one('SELECT is_trashed FROM attendance_requests WHERE id=' + q(rejectedDel) + ';'),
 't');


const cancelledDel = insertRequest('absence', '2027-03-01');
one("UPDATE attendance_requests SET status='cancelled' WHERE id=" + q(cancelledDel) + ';');


const cancelledDelResp = await req(OLD, c.revOld, 'POST', '/api/admin/requests/' + cancelledDel + '/delete',
 {});

assertCase('delete_cancelled_status', cancelledDelResp.status, 200);
assertCase('delete_cancelled_trashed',
 one('SELECT is_trashed FROM attendance_requests WHERE id=' + q(cancelledDel) + ';'), 't');


for (const status of ['approved',
 'rejected', 'cancelled']) {
  const day = status === 'approved' ? '08' : status === 'rejected' ? '15' : '22';
  const id = insertRequest('absence', '2027-03-' + day);


  if (status === 'approved') await review(OLD, c.revOld, id);
  else if (status === 'rejected') await review(OLD,
 c.revOld, id, false, 'no');

  else one("UPDATE attendance_requests SET status='cancelled' WHERE id=" + q(id) + ';');

  const resp = await req(OLD, c.revOld, 'PUT', '/api/admin/requests/' + id, { reason: 'edited after review',
 date: '2027-03-29', payload: '{}' });

  assertCase('edit_' + status + '_status', resp.status, 409);

  assertCase('edit_' + status + '_db', one('SELECT status FROM attendance_requests WHERE id=' + q(id) + ';'),
 status);

}

console.log(JSON.stringify({ suite: 'admin-actions', count: results.length, results }, null,
 2));

