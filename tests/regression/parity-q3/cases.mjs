export const reviewCases = [
  { name: 'absence_approve', type: 'absence', date: '2026-12-07', initial: 'none', payload: '{}', approve: true },
  { name: 'cancellation_approve', type: 'cancellation', date: '2026-12-08', initial: 'none', payload: '{}', approve: true },
  { name: 'correction_absent_to_present', type: 'correction', date: '2026-12-09', initial: 'absent', payload: '{"durationMinutes":30,"status":"present"}', approve: true },
  { name: 'correction_present_to_absent', type: 'correction', date: '2026-12-10', initial: 'present', payload: '{"durationMinutes":45,"status":"absent"}', approve: true },
  { name: 'absence_reject', type: 'absence', date: '2026-12-13', initial: 'none', payload: '{}', approve: false },
  { name: 'already_reviewed', type: 'absence', date: '2026-12-14', initial: 'none', payload: '{}', approve: true, requestStatus: 'approved' },
  { name: 'missing_slot', type: 'absence', date: '2026-12-15', initial: 'none', payload: '{}', approve: true, missingSlot: true },
  { name: 'absence_locked', type: 'absence', date: '2026-10-07', initial: 'none', payload: '{}', approve: true, locked: true },
  { name: 'cancellation_locked', type: 'cancellation', date: '2026-10-08', initial: 'none', payload: '{}', approve: true, locked: true },
  { name: 'correction_locked', type: 'correction', date: '2026-10-09', initial: 'present', payload: '{"durationMinutes":30,"status":"present"}', approve: true, locked: true },
  { name: 'outside_scope_403', type: 'absence', date: '2026-12-16', initial: 'none', payload: '{}', approve: true, scope: 'outside', knownDifference: true }
]

export const adjustCase = {
  name: 'direct_adjust_present_to_30',
  date: '2026-12-17',
  initialDuration: 60,
  initialPayable: 60
}

export const notComparable = [
  { name: 'payroll_lock_unlock', reason: 'New API has no payroll lock/unlock endpoint; lock is only checked internally.' },
  { name: 'payments_and_void', reason: 'Payments and void endpoints exist only in legacy API; deferred to Q-7/Q-8.' }
]
