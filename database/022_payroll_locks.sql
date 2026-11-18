-- v0.9.4: monthly payroll lock.
CREATE TABLE IF NOT EXISTS payroll_locks (
    billing_month DATE PRIMARY KEY,
    is_locked BOOLEAN NOT NULL DEFAULT TRUE,
    locked_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    note TEXT NULL,
    unlocked_by UUID NULL REFERENCES app_users(id) ON DELETE SET NULL,
    unlocked_at TIMESTAMPTZ NULL,
    unlock_note TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_payroll_locks_locked ON payroll_locks(is_locked, billing_month DESC);
