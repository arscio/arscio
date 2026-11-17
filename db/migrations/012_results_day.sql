-- Results day, as agreed:
--  - for each class the principal sets how the final result is worked out (which exams
--    count and how much: "Final only", "all exams equally", or e.g. 10/30/10/50), the
--    pass rule, and the result date
--  - on the result date marksheets are made: parents download them (with the principal's
--    signature and a QR code anyone can scan to check the marksheet is real); the office
--    downloads a whole class, signed or blank to sign by hand
--  - a student below the pass rule gets their marksheet only after the principal confirms

CREATE TABLE result_settings (
  school_id         uuid NOT NULL REFERENCES schools(id),
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id),
  class_id          uuid NOT NULL REFERENCES classes(id),
  -- [{"examId": "...", "weight": 50}, ...]; weights are used as proportions
  weights           jsonb NOT NULL DEFAULT '[]',
  pass_subject_pct  numeric(5,2) NOT NULL DEFAULT 33 CHECK (pass_subject_pct BETWEEN 0 AND 100),
  pass_overall_pct  numeric(5,2) NOT NULL DEFAULT 33 CHECK (pass_overall_pct BETWEEN 0 AND 100),
  result_date       date,
  updated_by        uuid NOT NULL REFERENCES accounts(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (academic_year_id, class_id)
);

-- One marksheet per student per year. What was issued is kept exactly (snapshot), so the
-- QR check always shows what is printed on the paper.
CREATE TABLE marksheets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES schools(id),
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id),
  student_id        uuid NOT NULL REFERENCES students(id),
  class_id          uuid NOT NULL REFERENCES classes(id),
  verify_code       text NOT NULL UNIQUE,         -- printed under the QR code
  data              jsonb NOT NULL,               -- the marksheet as issued
  passed            boolean NOT NULL,
  held              boolean NOT NULL,             -- below the pass rule: waits for the principal
  released_at       timestamptz,                  -- principal confirmed a held marksheet
  released_by       uuid REFERENCES accounts(id),
  result_note       text,                         -- e.g. "Promoted on review", "Not promoted"
  generated_at      timestamptz NOT NULL DEFAULT now(),
  generated_by      uuid REFERENCES accounts(id),
  UNIQUE (academic_year_id, student_id)
);
CREATE INDEX marksheets_class_idx ON marksheets (academic_year_id, class_id);

ALTER TABLE result_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON result_settings USING (school_id = app_school_id()) WITH CHECK (school_id = app_school_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON result_settings TO arscio_app;
ALTER TABLE marksheets ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON marksheets USING (school_id = app_school_id()) WITH CHECK (school_id = app_school_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON marksheets TO arscio_app;

-- Anyone who scans the QR code can check a marksheet (no login). Only what is printed on
-- it is shown, and only for a marksheet that has been given out.
CREATE FUNCTION verify_marksheet(p_code text)
RETURNS TABLE (school_name text, student_name text, admission_no text, class_label text, year_name text,
               overall_pct numeric, overall_grade text, result text, issued_on date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.name, m.data->'student'->>'name', m.data->'student'->>'admissionNo',
         m.data->'student'->>'classLabel', m.data->>'yearName',
         (m.data->>'pct')::numeric, m.data->>'grade', m.data->>'result', m.generated_at::date
    FROM marksheets m JOIN schools s ON s.id = m.school_id
   WHERE m.verify_code = upper(p_code) AND (NOT m.held OR m.released_at IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION verify_marksheet(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_marksheet(text) TO arscio_app;

-- Which school a marksheet belongs to (for the parent's short-lived download link, which has no login).
CREATE FUNCTION marksheet_school(p_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT school_id FROM marksheets WHERE id = p_id
$$;
REVOKE ALL ON FUNCTION marksheet_school(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION marksheet_school(uuid) TO arscio_app;
