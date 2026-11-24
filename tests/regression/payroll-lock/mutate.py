import pathlib, sys
root = pathlib.Path('/tmp/q2-mut-src')
legacy_duration = root / 'backend/DarEltahfeez.Api/DomainEndpoints.ScheduleAttendance.cs'
legacy_payroll = root / 'backend/DarEltahfeez.Api/SystemAdminEndpoints.Payroll.cs'
legacy_money = root / 'backend/DarEltahfeez.Api/MoneyRules.cs'
new_money = root / 'src/Common/Dar.Common/Domain/Money.cs'
new_adjust = root / 'src/Modules/Teaching/Dar.Modules.Teaching/Features/Supervisor/AdjustEndpoint.cs'
name = sys.argv[1]

def replace(path, old, new):
    text = path.read_text()
    if old not in text:
        raise SystemExit('mutation target missing in ' + str(path) + ': ' + old)
    path.write_text(text.replace(old, new))

if name == 'new_lock_bypass':
    replace(new_adjust, 'if (await PayrollLock.CheckAsync(connection, transaction, sessionDate, ct) is { } locked)', 'if (await PayrollLock.CheckAsync(connection, transaction, sessionDate, ct) is { } locked && false)')
elif name == 'legacy_lock_bypass':
    replace(legacy_duration, 'if (await PayrollLockService.IsLockedAsync(db, sessionDate, ct))', 'if (false && await PayrollLockService.IsLockedAsync(db, sessionDate, ct))')
elif name == 'unlock_does_not_clear':
    replace(legacy_payroll, 'UPDATE payroll_locks SET is_locked=FALSE,unlocked_by=@actor,unlocked_at=now(),unlock_note=@note', 'UPDATE payroll_locks SET is_locked=TRUE,unlocked_by=@actor,unlocked_at=now(),unlock_note=@note')
elif name == 'lock_does_not_set':
    replace(legacy_payroll, 'VALUES(@month,TRUE,@actor,now(),@note,NULL,NULL,NULL)', 'VALUES(@month,FALSE,@actor,now(),@note,NULL,NULL,NULL)')
    replace(legacy_payroll, 'is_locked=TRUE,locked_by=@actor,locked_at=now(),note=@note,', 'is_locked=FALSE,locked_by=@actor,locked_at=now(),note=@note,')
elif name == 'legacy_formula':
    replace(legacy_money, 'var calculatedAmount = normalizedHourlyRate * durationMinutes / 60m;', 'var calculatedAmount = normalizedHourlyRate * durationMinutes / 30m;')
elif name == 'new_formula':
    replace(new_money, 'var calculatedAmount = normalizedHourlyRate * durationMinutes / 60m;', 'var calculatedAmount = normalizedHourlyRate * durationMinutes / 30m;')
elif name == 'legacy_rounding':
    replace(legacy_money, 'MidpointRounding.AwayFromZero', 'MidpointRounding.ToZero')
elif name == 'new_rounding':
    replace(new_money, 'MidpointRounding.AwayFromZero', 'MidpointRounding.ToZero')
elif name == 'legacy_audit_omitted':
    replace(legacy_duration, "'attendance.duration.update'", "'attendance.duration.skipped'")
elif name == 'new_audit_omitted':
    replace(new_adjust, '"supervisor.attendance.adjust"', '"supervisor.attendance.skipped"')
elif name == 'new_manual_permission':
    replace(new_adjust, 'if (request.PayableAmount is not null && !hasFinance)', 'if (false && request.PayableAmount is not null && !hasFinance)')
elif name == 'legacy_empty_note_allowed':
    replace(legacy_payroll, 'if (string.IsNullOrWhiteSpace(request.Note))', 'if (false && string.IsNullOrWhiteSpace(request.Note))')
else:
    raise SystemExit('unknown mutation: ' + name)
print('MUTATED ' + name)
