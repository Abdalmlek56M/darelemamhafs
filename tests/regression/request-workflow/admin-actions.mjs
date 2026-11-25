import { setup, review, insertRequest, seedAttendance, snapshot, normalize, req, one, q, OLD } from './common.mjs';

const c = await setup();
const results = [];
const add = (name, value) => results.push({ name, value });

const roundTrip = insertRequest('absence', '2026-12-28');
const before = normalize(snapshot(roundTrip));
const approved = await review(OLD, c.revOld, roundTrip);
const reopen = await req(OLD, c.revOld, 'POST', '/api/admin/requests/' + roundTrip + '/reopen', {});
const after = normalize(snapshot(roundTrip));
add('old_reopen_roundtrip', { before, approved, reopenStatus: reopen.status, reopenBody: reopen.text.slice(0, 240), after });

const deleted = insertRequest('absence', '2027-01-04');
const del = await req(OLD, c.revOld, 'POST', '/api/admin/requests/' + deleted + '/delete', {});
add('old_delete', { status: del.status, body: del.text.slice(0, 240), isTrashed: one("SELECT is_trashed FROM attendance_requests WHERE id=" + "'" + deleted + "';") });

const edited = insertRequest('absence', '2027-01-11');
const edit = await req(OLD, c.revOld, 'PUT', '/api/admin/requests/' + edited, { reason: 'edited reason', date: '2027-01-12', payload: '{}' });
const editedRow = one("SELECT jsonb_build_object('reason',reason,'date',request_date,'status',status)::text FROM attendance_requests WHERE id=" + "'" + edited + "';");
add('old_edit', { status: edit.status, body: edit.text.slice(0, 240), row: editedRow });


const corrDate = '2027-02-08'; const corrAtt = seedAttendance(corrDate); const corr = insertRequest('correction', corrDate, corrAtt, { durationMinutes: 45, status: 'present' }); const corrBefore = normalize(snapshot(corr)); const corrApprove = await review(OLD, c.revOld, corr); const corrReopen = await req(OLD, c.revOld, 'POST', '/api/admin/requests/' + corr + '/reopen', {}); const corrAfter = normalize(snapshot(corr)); add('old_reopen_correction', { before: corrBefore, approved: corrApprove, reopenStatus: corrReopen.status, after: corrAfter });

const approvedDel = insertRequest('absence', '2027-02-15'); await review(OLD, c.revOld, approvedDel); const approvedDelResp = await req(OLD, c.revOld, 'POST', '/api/admin/requests/' + approvedDel + '/delete', {}); add('old_delete_approved', { status: approvedDelResp.status, body: approvedDelResp.text.slice(0, 160), isTrashed: one("SELECT is_trashed FROM attendance_requests WHERE id=" + q(approvedDel) + ';') });
const rejectedDel = insertRequest('absence', '2027-02-22'); await review(OLD, c.revOld, rejectedDel, false, 'no'); const rejectedDelResp = await req(OLD, c.revOld, 'POST', '/api/admin/requests/' + rejectedDel + '/delete', {}); add('old_delete_rejected', { status: rejectedDelResp.status, isTrashed: one("SELECT is_trashed FROM attendance_requests WHERE id=" + q(rejectedDel) + ';') });
const cancelledDel = insertRequest('absence', '2027-03-01'); one("UPDATE attendance_requests SET status='cancelled' WHERE id=" + q(cancelledDel) + ';'); const cancelledDelResp = await req(OLD, c.revOld, 'POST', '/api/admin/requests/' + cancelledDel + '/delete', {}); add('old_delete_cancelled', { status: cancelledDelResp.status, isTrashed: one("SELECT is_trashed FROM attendance_requests WHERE id=" + q(cancelledDel) + ';') });

for (const [name, date, status] of [['approved', '2027-03-08', 'approved'], ['rejected', '2027-03-15', 'rejected'], ['cancelled', '2027-03-22', 'cancelled']]) { const id = insertRequest('absence', date); if (status === 'approved') await review(OLD, c.revOld, id); else if (status === 'rejected') await review(OLD, c.revOld, id, false, 'no'); else one("UPDATE attendance_requests SET status='cancelled' WHERE id=" + q(id) + ';'); const resp = await req(OLD, c.revOld, 'PUT', '/api/admin/requests/' + id, { reason: 'edited after review', date: '2027-03-29', payload: '{}' }); add('old_edit_' + name, { status: resp.status, body: resp.text.slice(0, 160), dbStatus: one("SELECT status FROM attendance_requests WHERE id=" + q(id) + ';') }); }

console.log(JSON.stringify({ suite: 'admin-actions', ok: true, count: results.length, results }, null, 2));
