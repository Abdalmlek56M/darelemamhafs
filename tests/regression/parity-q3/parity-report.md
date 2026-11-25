# Q-3 backend parity report

- commit: `bc7e405`
- generated: `2026-11-25T10:01:28.731Z`
- database: `disposable` (disposable)

## Summary

| Metric | Value |
|---|---:|
| Scenarios executed | 12 |
| Matching | 7 |
| Mismatches | 5 |
| Known/expected differences | 1 |

## Scenario results

| Scenario | Legacy HTTP | New HTTP | Differences |
|---|---:|---:|---|
| absence_approve | 200 | 200 | none |
| cancellation_approve | 200 | 200 | none |
| correction_absent_to_present | 200 | 200 | none |
| correction_present_to_absent | 200 | 200 | none |
| absence_reject | 200 | 200 | none |
| already_reviewed | 409 | 409 | none |
| missing_slot | 400 | 400 | none |
| absence_locked | 409 | 409 | response |
| cancellation_locked | 409 | 409 | response |
| correction_locked | 409 | 409 | response |
| outside_scope_403 | 200 | 403 | httpStatus, response, dbState |
| direct_adjust_present_to_30 | 200 | 200 | dbState |

## Differences (not fixed)

### absence_locked

Legacy HTTP 409 / New HTTP 409

- **response**
  - legacy: `{"message":"مسير رواتب هذا الشهر مقفل. افتح المسير قبل اعتماد الطلب."}`
  - new: `{"message":"مسير رواتب هذا الشهر مقفل. افتح المسير قبل تعديل الحضور أو الأجر."}`

### cancellation_locked

Legacy HTTP 409 / New HTTP 409

- **response**
  - legacy: `{"message":"مسير رواتب هذا الشهر مقفل. افتح المسير قبل اعتماد الطلب."}`
  - new: `{"message":"مسير رواتب هذا الشهر مقفل. افتح المسير قبل تعديل الحضور أو الأجر."}`

### correction_locked

Legacy HTTP 409 / New HTTP 409

- **response**
  - legacy: `{"message":"مسير رواتب هذا الشهر مقفل. افتح المسير قبل اعتماد الطلب."}`
  - new: `{"message":"مسير رواتب هذا الشهر مقفل. افتح المسير قبل تعديل الحضور أو الأجر."}`

### outside_scope_403

Legacy HTTP 200 / New HTTP 403 (known difference)

- **httpStatus**
  - legacy: `200`
  - new: `403`
- **response**
  - legacy: `{"status":"approved"}`
  - new: `{"message":"هذا الطلب خارج نطاقك."}`
- **dbState**
  - legacy: `{"attendance":{"actualDurationMinutes":0,"durationMinutes":60,"isTrashed":false,"payBasis":"manual","payableAmount":0,"status":"absent"},"notificationCount":0,"requestStatus":"approved","reviewNote":"Q3 fixture","sessionStatus":"cancelled"}`
  - new: `{"attendance":null,"notificationCount":0,"requestStatus":"pending","reviewNote":null,"sessionStatus":"in_progress"}`

### direct_adjust_present_to_30

Legacy HTTP 200 / New HTTP 200

- **dbState**
  - legacy: `{"durationMinutes":30,"payBasis":"actual","payableAmount":30,"sessionPayBasis":"actual","sessionPayableMinutes":60,"status":"present"}`
  - new: `{"durationMinutes":30,"payBasis":"manual","payableAmount":30,"sessionPayBasis":"manual","sessionPayableMinutes":30,"status":"present"}`

## Not comparable / gaps

- **payroll_lock_unlock**: New API has no payroll lock/unlock endpoint; lock is only checked internally.
- **payments_and_void**: Payments and void endpoints exist only in legacy API; deferred to Q-7/Q-8.

## Not tested

- payments/void (new endpoint does not exist)
- payroll lock/unlock (new endpoint does not exist)
- concurrent/race scenarios
- production data
