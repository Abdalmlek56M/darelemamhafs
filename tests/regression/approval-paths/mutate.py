import pathlib, sys
root = pathlib.Path('/tmp/q1-mut-src')
new = root / 'src/Modules/Teaching/Dar.Modules.Teaching/Features/Requests/SupervisorRequestEndpoints.cs'
legacy = root / 'backend/DarEltahfeez.Api/SystemAdminEndpoints.Requests.cs'
name = sys.argv[1]

def replace(path, old, new_text):
    text = path.read_text()
    if old not in text:
        raise SystemExit('mutation target missing: ' + old)
    path.write_text(text.replace(old, new_text, 1))

if name == 'new_lock':
    replace(new, 'if (await PayrollLock.CheckAsync(connection, transaction, requestDate.Value, ct) is { } locked)', 'if (await PayrollLock.CheckAsync(connection, transaction, requestDate.Value, ct) is { } locked && false)')
    replace(new, 'if (await PayrollLock.CheckAsync(connection, transaction, attendanceDate, ct) is { } locked)', 'if (await PayrollLock.CheckAsync(connection, transaction, attendanceDate, ct) is { } locked && false)')
elif name == 'legacy_lock':
    replace(legacy, 'if (await lockCheck.ExecuteScalarAsync(ct) is bool locked && locked)', 'if (await lockCheck.ExecuteScalarAsync(ct) is bool locked && locked && false)')
elif name == 'new_absence_status':
    replace(new, 'var attendanceStatus = type == "absence" ? "absent" : "cancelled";', 'var attendanceStatus = "present";')
elif name == 'legacy_absence_status':
    replace(legacy, 'var attendanceStatus = type == "absence" ? "absent" : "cancelled";', 'var attendanceStatus = "present";')
elif name == 'new_correction_status':
    replace(new, 'var newStatus = proposedStatus ?? oldStatus;', 'var newStatus = oldStatus;')
elif name == 'legacy_correction_status':
    replace(legacy, 'var newStatus = proposedStatus ?? oldStatus;', 'var newStatus = oldStatus;')
else:
    raise SystemExit('unknown mutation: ' + name)
print('MUTATED ' + name)
