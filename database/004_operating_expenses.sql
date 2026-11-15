-- Monthly operating-cost ledger used by the dashboard's estimated net result.
CREATE TABLE IF NOT EXISTS operating_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_date DATE NOT NULL,
    category VARCHAR(100) NOT NULL,
    description VARCHAR(240) NOT NULL,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    circle_id UUID REFERENCES circles(id) ON DELETE RESTRICT,
    note TEXT,
    recorded_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_operating_expenses_date ON operating_expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_operating_expenses_circle_date ON operating_expenses(circle_id, expense_date DESC);
