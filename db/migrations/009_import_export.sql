-- Excel import and export.
-- 1. Extra permissions given to one person on top of their roles (e.g. "Excel import and export").
CREATE TABLE membership_permissions (
  school_id      uuid NOT NULL REFERENCES schools(id),
  membership_id  uuid NOT NULL REFERENCES memberships(id),
  permission     text NOT NULL,
  granted_by     uuid NOT NULL REFERENCES accounts(id),
  granted_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, permission)
);
ALTER TABLE membership_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON membership_permissions USING (school_id = app_school_id()) WITH CHECK (school_id = app_school_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON membership_permissions TO arscio_app;
CREATE TRIGGER membership_permissions_audit AFTER INSERT OR UPDATE OR DELETE ON membership_permissions FOR EACH ROW EXECUTE FUNCTION audit_row();

-- 2. Each import is recorded, with what it created or changed, so it can be undone.
ALTER TABLE import_batches DROP CONSTRAINT import_batches_kind_check;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_kind_check CHECK (kind IN ('students', 'staff', 'marks', 'fees_opening'));
ALTER TABLE import_batches
  ADD COLUMN details    jsonb NOT NULL DEFAULT '{}',   -- what was created or changed (for undo)
  ADD COLUMN undone_at  timestamptz,
  ADD COLUMN undone_by  uuid REFERENCES accounts(id);
