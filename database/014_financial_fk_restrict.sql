-- Financial and enrollment history must never be cascade-deleted.
-- Migration 002 temporarily relaxed these three foreign keys to CASCADE.
-- Restore the original RESTRICT behavior so a mistaken physical delete fails
-- at the database boundary instead of silently erasing money/attendance history.

ALTER TABLE circle_enrollments DROP CONSTRAINT IF EXISTS circle_enrollments_student_id_fkey;
ALTER TABLE circle_enrollments ADD CONSTRAINT circle_enrollments_student_id_fkey
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT;

ALTER TABLE monthly_charges DROP CONSTRAINT IF EXISTS monthly_charges_enrollment_id_fkey;
ALTER TABLE monthly_charges ADD CONSTRAINT monthly_charges_enrollment_id_fkey
    FOREIGN KEY (enrollment_id) REFERENCES circle_enrollments(id) ON DELETE RESTRICT;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_monthly_charge_id_fkey;
ALTER TABLE payments ADD CONSTRAINT payments_monthly_charge_id_fkey
    FOREIGN KEY (monthly_charge_id) REFERENCES monthly_charges(id) ON DELETE RESTRICT;
