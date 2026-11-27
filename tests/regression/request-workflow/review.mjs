#!/usr/bin/env node
// Q-6 request review parity (FINAL 2.16): this suite used to always print ok:true.
// It now compares the legacy and new review effects for every scenario, collects failures
// and exits non-zero when any case diverges or does not reach the expected state.
import { setup, review, insertRequest, seedAttendance, seedSession, OLD, NEW } from './common.mjs';

const c = await setup();
const results = [];
const failures = [];

function comparable(db) {
  const request = db && db.request;
  const attendance = db && db.attendance;
  const session = db && db.session;
  return {
    requestStatus: request ? request.status : null,
    attendance: attendance
      ? {
          status: attendance.status,
          durationMinutes: attendance.duration_minutes,
          payableAmount: attendance.payable_amount,
          actualDurationMinutes: attendance.actual_duration_minutes,
          payBasis: attendance.pay_basis,
          isTrashed: attendance.is_trashed
        }
      : null,
    sessionStatus: session ? session.status : null
  };
}

function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures.push({ name, detail });
}

async function runSide(base, cookie, requestId, approve, note) {
  return review(base, cookie, requestId, approve, note);
}

async function expectReviewPair(name, oldRequestId, newRequestId, expectedRequestStatus, approve = true, note = 'ok') {
  const oldResult = await runSide(OLD, c.revOld, oldRequestId, approve, note);
  const newResult = await runSide(NEW, c.revNew, newRequestId, approve, note);
  check(name + '.old_http', oldResult.status === 200, 'legacy HTTP ' + oldResult.status + ' ' + oldResult.body);
  check(name + '.new_http', newResult.status === 200, 'new HTTP ' + newResult.status + ' ' + newResult.body);
  check(name + '.old_request_status', oldResult.db.request && oldResult.db.request.status === expectedRequestStatus, JSON.stringify(oldResult.db.request && oldResult.db.request.status));
  check(name + '.new_request_status', newResult.db.request && newResult.db.request.status === expectedRequestStatus, JSON.stringify(newResult.db.request && newResult.db.request.status));
  const oldState = comparable(oldResult.db);
  const newState = comparable(newResult.db);
  check(name + '.db_parity', JSON.stringify(oldState) === JSON.stringify(newState), JSON.stringify({ legacy: oldState, new: newState }));
  return { oldResult, newResult };
}

await expectReviewPair('absence_approve', insertRequest('absence', '2026-11-02'), insertRequest('absence', '2026-11-03'), 'approved');
await expectReviewPair('cancellation_approve', insertRequest('cancellation', '2026-11-16'), insertRequest('cancellation', '2026-11-17'), 'approved');

const oldCorrDate = '2026-11-30';
const oldCorrAtt = seedAttendance(oldCorrDate);
const oldCorr = insertRequest('correction', oldCorrDate, oldCorrAtt, { durationMinutes: 45, status: 'present' });
const newCorrDate = '2026-12-07';
const newCorrAtt = seedAttendance(newCorrDate);
const newCorr = insertRequest('correction', newCorrDate, newCorrAtt, { durationMinutes: 45, status: 'present' });
await expectReviewPair('correction_to_present', oldCorr, newCorr, 'approved');

await expectReviewPair('absence_reject', insertRequest('absence', '2026-12-14'), insertRequest('absence', '2026-12-15'), 'rejected', false, 'no');

// Approved absence must create the absent attendance and cancel the session on both sides.
// The cancellation path only touches sessions that are actually in progress, so seed one.
const absenceOldDate = '2026-12-20';
const absenceNewDate = '2026-12-21';
seedSession(absenceOldDate);
seedSession(absenceNewDate);
const absenceOld = await review(OLD, c.revOld, insertRequest('absence', absenceOldDate));
const absenceNew = await review(NEW, c.revNew, insertRequest('absence', absenceNewDate));
check('absence_approve.old_attendance_absent', absenceOld.db.attendance && absenceOld.db.attendance.status === 'absent', JSON.stringify(absenceOld.db.attendance));
check('absence_approve.new_attendance_absent', absenceNew.db.attendance && absenceNew.db.attendance.status === 'absent', JSON.stringify(absenceNew.db.attendance));
check('absence_approve.old_session_cancelled', absenceOld.db.session && absenceOld.db.session.status === 'cancelled', JSON.stringify(absenceOld.db.session && absenceOld.db.session.status));
check('absence_approve.new_session_cancelled', absenceNew.db.session && absenceNew.db.session.status === 'cancelled', JSON.stringify(absenceNew.db.session && absenceNew.db.session.status));

// Approved correction must apply 45 minutes at the snapshot rate on both sides.
const corrOld = await review(OLD, c.revOld, insertRequest('correction', '2026-12-27', seedAttendance('2026-12-27'), { durationMinutes: 45, status: 'present' }));
const corrNew = await review(NEW, c.revNew, insertRequest('correction', '2026-12-28', seedAttendance('2026-12-28'), { durationMinutes: 45, status: 'present' }));
check('correction_approve.old_applied', corrOld.db.attendance && Number(corrOld.db.attendance.duration_minutes) === 45 && Number(corrOld.db.attendance.payable_amount) === 45, JSON.stringify(corrOld.db.attendance));
check('correction_approve.new_applied', corrNew.db.attendance && Number(corrNew.db.attendance.duration_minutes) === 45 && Number(corrNew.db.attendance.payable_amount) === 45, JSON.stringify(corrNew.db.attendance));

// A rejected request keeps the session in progress and creates no attendance effect.
const rejectDate = '2027-01-03';
seedSession(rejectDate);
const rejectOld = await review(OLD, c.revOld, insertRequest('absence', rejectDate), false, 'no');
check('reject.old_session_in_progress', rejectOld.db.session && rejectOld.db.session.status === 'in_progress', JSON.stringify(rejectOld.db.session && rejectOld.db.session.status));
check('reject.old_request_rejected', rejectOld.db.request && rejectOld.db.request.status === 'rejected', JSON.stringify(rejectOld.db.request && rejectOld.db.request.status));
check('reject.old_no_attendance', rejectOld.db.attendance === null, JSON.stringify(rejectOld.db.attendance));

console.log(JSON.stringify({ suite: 'q6-review', ok: failures.length === 0, count: results.length, failed: failures.length, failures, results }, null, 2));
if (failures.length > 0) {
  console.error('Q6_REVIEW_FAIL ' + JSON.stringify(failures));
  process.exit(1);
}
console.log('Q6_REVIEW_PASS');
