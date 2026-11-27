/**
 * Preview of the teacher session pay rules shown on the live-session screen.
 *
 * This mirrors the server policy in `Money.TryCalculateTeacherSessionPay`:
 * - reaching/exceeding the scheduled duration pays the scheduled duration,
 * - ending early pays the actual whole minutes,
 * - a zero-minute actual duration pays zero (owner decision, FINAL B3 — no 1-minute minimum).
 *
 * The live screen is a preview only; the server recomputes and stores the authoritative amount.
 */
export function teacherLivePayableMinutes(scheduledMinutes: number, actualMinutes: number): number {
  const scheduled = Math.max(1, Math.floor(scheduledMinutes))
  const actual = Math.max(0, Math.floor(actualMinutes))
  return actual >= scheduled ? scheduled : actual
}
