import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { setup, one, q, OLD } from '../request-workflow/common.mjs';

const c = await setup();

// FINAL 1.1: the purge was never called. A scheduled worker now runs it and a manual
// trigger exists; an expired, non-financial trash row must actually be deleted.
one(`INSERT INTO students(id,student_code,full_name,status,joined_on)
  VALUES (gen_random_uuid(),'T1-PURGE','Purge Student','active',DATE '2026-01-01');`);
const studentId = one("SELECT id FROM students WHERE student_code='T1-PURGE';");
const noteId = one(`INSERT INTO student_notes(id,student_id,note_text,created_by,is_trashed)
  VALUES (gen_random_uuid(),${q(studentId)},'expired note',${q(c.adminId)},TRUE) RETURNING id;`);
const trashId = one(`INSERT INTO trash_items(id,entity_type,entity_id,display_name,record_snapshot,deleted_at,expires_at)
  VALUES (gen_random_uuid(),'student-note',${q(noteId)},'expired note','{}'::jsonb,
          TIMESTAMPTZ '2026-01-01 00:00:00+02', TIMESTAMPTZ '2026-01-02 00:00:00+02') RETURNING id;`);

const response = await fetch(OLD + '/api/admin/trash/purge-expired', { method: 'POST', headers: { cookie: c.admin } });
assert.equal(response.status, 200, 'purge endpoint status ' + await response.text());
assert.equal(one('SELECT count(*) FROM student_notes WHERE id=' + q(noteId) + ';'), '0', 'expired trash row was not purged');
assert.equal(one('SELECT purged_at IS NOT NULL FROM trash_items WHERE id=' + q(trashId) + ';'), 't', 'trash row was not marked purged');

// The scheduled worker must be registered next to the existing background services.
const program = readFileSync('backend/DarEltahfeez.Api/Program.cs', 'utf8');
assert.match(program, /AddHostedService<[^>]*TrashPurgeWorker/, 'trash purge worker is not registered');
assert.match(program, /MapTrashPurge/, 'manual purge endpoint is not mapped');

console.log(JSON.stringify({ suite: 'tier1-trash-purge', ok: true, cases: 3 }));
