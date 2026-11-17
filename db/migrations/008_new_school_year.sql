-- Moving to a new school year: a record of each move, so it can be checked and (the same day) undone.
CREATE TABLE year_transitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES schools(id),
  from_year_id  uuid NOT NULL REFERENCES academic_years(id),
  to_year_id    uuid NOT NULL REFERENCES academic_years(id),
  summary       jsonb NOT NULL DEFAULT '{}',   -- counts: promoted, repeated, left, passed out, report cards filed
  status_changes jsonb NOT NULL DEFAULT '[]',  -- [{studentId, from, to}] so an undo can put them back
  done_by       uuid NOT NULL REFERENCES accounts(id),
  done_at       timestamptz NOT NULL DEFAULT now(),
  undone_at     timestamptz,
  undone_by     uuid REFERENCES accounts(id)
);
ALTER TABLE year_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON year_transitions USING (school_id = app_school_id()) WITH CHECK (school_id = app_school_id());
GRANT SELECT, INSERT, UPDATE ON year_transitions TO arscio_app;
CREATE TRIGGER year_transitions_audit AFTER INSERT OR UPDATE OR DELETE ON year_transitions FOR EACH ROW EXECUTE FUNCTION audit_row();
