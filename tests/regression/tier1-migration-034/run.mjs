import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';

// FINAL: migration 034 must be narrow and idempotent.
const conn = process.env.DAR_TEST_DATABASE || '';
const env = { ...process.env };
for (const part of conn.split(';')) {
  const index = part.indexOf('=');
  if (index < 0) continue;
  const key = part.slice(0, index).trim().toLowerCase();
  const value = part.slice(index + 1).trim();
  if (key === 'host') env.PGHOST = value;
  if (key === 'port') env.PGPORT = value;
  if (key === 'database') env.PGDATABASE = value;
  if (key === 'username') env.PGUSER = value;
  if (key === 'password') env.PGPASSWORD = value;
}
const query = (sql) => {
  const run = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', env });
  assert.equal(run.status, 0, 'psql failed: ' + (run.stderr || '').slice(0, 500));
  return (run.stdout || '').trim();
};

const targetUnique = query(`
  SELECT count(*) FROM pg_constraint
  WHERE conrelid='public.teacher_attendance'::regclass AND contype='u'
    AND regexp_replace(pg_get_constraintdef(oid), '\\s+', '', 'g')
        IN ('UNIQUE(schedule_slot_id,session_date)','UNIQUE(session_date,schedule_slot_id)');`);
assert.equal(targetUnique, '0', 'the old non-partial unique constraint still exists');

const indexDefinition = query("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='ux_teacher_attendance_slot_date_live';");
assert.match(indexDefinition, /UNIQUE INDEX/, 'replacement index is not unique: ' + indexDefinition);
assert.match(indexDefinition, /is_trashed = false/i, 'replacement index is not partial over live rows: ' + indexDefinition);

// Other schema invariants must not be casualties of the migration.
assert.equal(query("SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='uq_circle_enrollments_active_student_circle';"), '1', 'unrelated required unique index disappeared');
assert.ok(Number(query("SELECT count(*) FROM pg_constraint WHERE contype='u';")) > 0, 'all unique constraints disappeared');

// Re-running the migration on the already-migrated schema must be a harmless no-op.
const rerun = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', 'database/034_teacher_attendance_partial_unique.sql'], { encoding: 'utf8', env });
assert.equal(rerun.status, 0, 'migration 034 is not idempotent: ' + (rerun.stderr || '').slice(0, 600));
assert.equal(query("SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='ux_teacher_attendance_slot_date_live';"), '1');

console.log(JSON.stringify({ suite: 'tier1-migration-034', ok: true, cases: 4 }));
