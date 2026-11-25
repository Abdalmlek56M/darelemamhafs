import { randomUUID } from 'node:crypto'
import { psql, q } from './db.mjs'

export function seedReviewFixture(connectionString, testCase, path, reviewerId) {
  const ids = { teacher: randomUUID(), circle: randomUUID(), slot: randomUUID(), session: randomUUID(), attendance: randomUUID(), request: randomUUID() }
  const tag = ids.teacher.slice(0, 8)
  const month = testCase.date.slice(0, 7) + '-01'
  const lines = [
    `INSERT INTO teachers(id, teacher_code, full_name, status, hourly_rate) VALUES (${q(ids.teacher)},${q('Q3-' + path + '-T-' + tag)},'Q3 Test Teacher','active',60);`,
    `INSERT INTO circles(id, circle_code, name, teacher_id, monthly_fee, is_active, starts_on) VALUES (${q(ids.circle)},${q('Q3-' + path + '-C-' + tag)},'Q3 Test Circle',${q(ids.teacher)},0,TRUE,DATE '2026-01-01');`
  ]
  if (!testCase.missingSlot) {
    lines.push(`INSERT INTO circle_schedule_slots(id, circle_id, day_of_week, starts_at, duration_minutes, is_active) VALUES (${q(ids.slot)},${q(ids.circle)},1,'10:00',60,TRUE);`)
    lines.push(`INSERT INTO teacher_sessions(id, teacher_id, circle_id, schedule_slot_id, session_date, started_at, ended_at, status, scheduled_duration_minutes, actual_duration_minutes, payable_duration_minutes, pay_basis) VALUES (${q(ids.session)},${q(ids.teacher)},${q(ids.circle)},${q(ids.slot)},${q(testCase.date)},now() - INTERVAL '10 minutes',${testCase.initial === 'none' ? 'NULL' : "now() + INTERVAL '60 minutes'"},${q(testCase.initial === 'none' ? 'in_progress' : 'completed')},60,60,60,'actual');`)
  }
  if (testCase.initial === 'present' || testCase.initial === 'absent') {
    const amount = testCase.initial === 'present' ? '60' : '0'
    const actual = testCase.initial === 'present' ? '60' : '0'
    lines.push(`INSERT INTO teacher_attendance(id, schedule_slot_id, circle_id, teacher_id, session_date, scheduled_start, duration_minutes, status, hourly_rate_snapshot, payable_amount, marked_by, teacher_session_id, actual_duration_minutes, pay_basis) VALUES (${q(ids.attendance)},${q(ids.slot)},${q(ids.circle)},${q(ids.teacher)},${q(testCase.date)},'10:00',60,${q(testCase.initial)},60,${amount},${q(reviewerId)},${q(ids.session)},${actual},'actual');`)
  }
  lines.push(`INSERT INTO attendance_requests(id, request_type, teacher_id, circle_id, schedule_slot_id, attendance_id, request_date, requested_by, reason, requested_payload, status) VALUES (${q(ids.request)},${q(testCase.type)},${q(ids.teacher)},${q(ids.circle)},${testCase.missingSlot ? 'NULL' : q(ids.slot)},${testCase.initial === 'present' || testCase.initial === 'absent' ? q(ids.attendance) : 'NULL'},${q(testCase.date)},${q(reviewerId)},'Q3 fixture',${q(testCase.payload)}::jsonb,${q(testCase.requestStatus || 'pending')});`)
  if (testCase.locked) {
    lines.push(`INSERT INTO payroll_locks(billing_month,is_locked,locked_by,locked_at) VALUES (${q(month)},TRUE,${q(reviewerId)},now()) ON CONFLICT (billing_month) DO UPDATE SET is_locked=TRUE,locked_at=now();`)
  }
  psql(connectionString, 'BEGIN;' + lines.join(' ') + 'COMMIT;')
  return ids
}

export function readReviewState(connectionString, ids, date) {
  const result = psql(connectionString, `SELECT json_build_object(
    'requestStatus',(SELECT status FROM attendance_requests WHERE id=${q(ids.request)}),
    'reviewNote',(SELECT review_note FROM attendance_requests WHERE id=${q(ids.request)}),
    'attendance',(SELECT json_build_object('status',status,'durationMinutes',duration_minutes,'payableAmount',payable_amount,'actualDurationMinutes',actual_duration_minutes,'payBasis',pay_basis,'isTrashed',is_trashed) FROM teacher_attendance WHERE schedule_slot_id=${q(ids.slot)} AND session_date=${q(date)}),
    'sessionStatus',(SELECT status FROM teacher_sessions WHERE id=${q(ids.session)}),
    'notificationCount',(SELECT count(*) FROM notifications WHERE dedupe_key='request:'||${q(ids.request)})
  )::text;`)
  return JSON.parse(result || '{}')
}

export function seedAdjustFixture(connectionString, testCase, path, reviewerId) {
  const ids = { teacher: randomUUID(), circle: randomUUID(), slot: randomUUID(), session: randomUUID(), attendance: randomUUID() }
  const tag = ids.teacher.slice(0, 8)
  psql(connectionString, 'BEGIN;' +
    `INSERT INTO teachers(id,teacher_code,full_name,status,hourly_rate) VALUES (${q(ids.teacher)},${q('Q3-' + path + '-A-T-' + tag)},'Q3 Adjust Teacher','active',60);` +
    `INSERT INTO circles(id,circle_code,name,teacher_id,monthly_fee,is_active,starts_on) VALUES (${q(ids.circle)},${q('Q3-' + path + '-A-C-' + tag)},'Q3 Adjust Circle',${q(ids.teacher)},0,TRUE,DATE '2026-01-01');` +
    `INSERT INTO circle_schedule_slots(id,circle_id,day_of_week,starts_at,duration_minutes,is_active) VALUES (${q(ids.slot)},${q(ids.circle)},1,'10:00',60,TRUE);` +
    `INSERT INTO teacher_sessions(id,teacher_id,circle_id,schedule_slot_id,session_date,started_at,ended_at,status,scheduled_duration_minutes,actual_duration_minutes,payable_duration_minutes,pay_basis) VALUES (${q(ids.session)},${q(ids.teacher)},${q(ids.circle)},${q(ids.slot)},${q(testCase.date)},now() - INTERVAL '10 minutes',now() + INTERVAL '60 minutes','completed',60,60,60,'actual');` +
    `INSERT INTO teacher_attendance(id,schedule_slot_id,circle_id,teacher_id,session_date,scheduled_start,duration_minutes,status,hourly_rate_snapshot,payable_amount,marked_by,teacher_session_id,actual_duration_minutes,pay_basis) VALUES (${q(ids.attendance)},${q(ids.slot)},${q(ids.circle)},${q(ids.teacher)},${q(testCase.date)},'10:00',${testCase.initialDuration},'present',60,${testCase.initialPayable},${q(reviewerId)},${q(ids.session)},60,'actual');` +
    'COMMIT;')
  return ids
}

export function readAdjustState(connectionString, attendanceId) {
  const result = psql(connectionString, `SELECT json_build_object(
    'status',status,'durationMinutes',duration_minutes,'payableAmount',payable_amount,'payBasis',pay_basis,
    'sessionPayableMinutes',(SELECT payable_duration_minutes FROM teacher_sessions WHERE id=teacher_attendance.teacher_session_id),
    'sessionPayBasis',(SELECT pay_basis FROM teacher_sessions WHERE id=teacher_attendance.teacher_session_id)
  )::text FROM teacher_attendance WHERE id=${q(attendanceId)};`)
  return JSON.parse(result || '{}')
}
