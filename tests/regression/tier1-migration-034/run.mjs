import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { assertSafeTargets, pgEnv, psql } from '../../lib/index.mjs';

// FINAL: migration 034 must be narrow and idempotent.
const conn = process.env.DAR_TEST_DATABASE || '';
assertSafeTargets({ db: conn, requireDb: true, label: 'TIER1-034_FAIL' });
const env = pgEnv(conn);
const query = (sql) => psql(conn, sql);

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
