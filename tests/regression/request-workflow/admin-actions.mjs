import { setup, review, insertRequest, snapshot, normalize, req, one, OLD } from './common.mjs';

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

console.log(JSON.stringify({ suite: 'admin-actions', ok: true, count: results.length, results }, null, 2));
