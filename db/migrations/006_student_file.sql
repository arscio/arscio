-- The digital student file: photo, automatic admission numbers, documents (with a
-- per-class checklist), and certificates the school issues.

-- Admission numbers given automatically, e.g. GV/2027/0187.
-- Tokens: {CODE} school code, {YEAR} year of admission, {SEQ} running number (4 digits).
ALTER TABLE schools
  ADD COLUMN admission_no_format text NOT NULL DEFAULT '{CODE}/{YEAR}/{SEQ}';
CREATE TABLE admission_counters (
  school_id  uuid NOT NULL REFERENCES schools(id),
  year       int  NOT NULL,
  next_no    int  NOT NULL DEFAULT 1,
  PRIMARY KEY (school_id, year)
);

-- Only the last 4 digits of Aadhaar are ever kept.
ALTER TABLE students ADD COLUMN aadhaar_last4 text CHECK (aadhaar_last4 ~ '^[0-9]{4}$');

-- The student's photo (shown everywhere the student appears).
CREATE TABLE student_photos (
  student_id  uuid PRIMARY KEY REFERENCES students(id),
  school_id   uuid NOT NULL REFERENCES schools(id),
  mime        text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  data        bytea NOT NULL CHECK (octet_length(data) <= 2 * 1024 * 1024),
  updated_by  uuid NOT NULL REFERENCES accounts(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Kinds of document, and which classes must have each one at admission.
CREATE TABLE document_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES schools(id),
  name             text NOT NULL,
  category         text NOT NULL CHECK (category IN ('admission', 'report_card', 'certificate', 'other')),
  required_classes uuid[] NOT NULL DEFAULT '{}',   -- classes that must have it at admission
  asks_for_class   boolean NOT NULL DEFAULT false, -- label needs "which class", e.g. "Class 6 marksheet"
  system           boolean NOT NULL DEFAULT false, -- filed by Arscio itself (report cards, certificates)
  sort_order       int NOT NULL DEFAULT 0,
  UNIQUE (school_id, name)
);

-- Every document in a student's file. Never deleted: a replaced document stays in history.
CREATE TABLE student_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools(id),
  student_id     uuid NOT NULL REFERENCES students(id),
  type_id        uuid REFERENCES document_types(id),
  label          text NOT NULL,
  year_name      text,                      -- e.g. "2027-28" for yearly documents
  file_name      text NOT NULL,
  mime           text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  size_bytes     int  NOT NULL,
  data           bytea NOT NULL CHECK (octet_length(data) <= 10 * 1024 * 1024),
  source         text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'system')),
  replaced_by    uuid REFERENCES student_documents(id),
  uploaded_by    uuid REFERENCES accounts(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX student_documents_student_idx ON student_documents (student_id, created_at);
CREATE OR REPLACE FUNCTION documents_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Student documents are never deleted'; END $$;
CREATE TRIGGER student_documents_no_delete BEFORE DELETE ON student_documents FOR EACH ROW EXECUTE FUNCTION documents_no_delete();

-- Certificates the school issues (TC, bonafide, character), each with a serial number.
-- How each kind is signed: a printed signature image, or signed by hand.
CREATE TABLE certificate_settings (
  school_id      uuid NOT NULL REFERENCES schools(id),
  kind           text NOT NULL CHECK (kind IN ('tc', 'bonafide', 'character')),
  sign_mode      text NOT NULL DEFAULT 'hand' CHECK (sign_mode IN ('printed', 'hand')),
  signer_role    text NOT NULL DEFAULT 'principal' CHECK (signer_role IN ('principal', 'owner')),
  PRIMARY KEY (school_id, kind)
);
CREATE TABLE signatures (
  school_id      uuid NOT NULL REFERENCES schools(id),
  role           text NOT NULL CHECK (role IN ('principal', 'owner')),
  signer_name    text NOT NULL,
  mime           text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  data           bytea NOT NULL CHECK (octet_length(data) <= 300 * 1024),
  updated_by     uuid NOT NULL REFERENCES accounts(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, role)
);
CREATE TABLE certificates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools(id),
  student_id     uuid NOT NULL REFERENCES students(id),
  kind           text NOT NULL CHECK (kind IN ('tc', 'bonafide', 'character')),
  serial_no      text NOT NULL,
  details        jsonb NOT NULL DEFAULT '{}',   -- what was printed (reason, conduct, last class, etc.)
  sign_mode      text NOT NULL,
  signer_role    text NOT NULL,
  issued_by      uuid NOT NULL REFERENCES accounts(id),
  issued_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, serial_no)
);
CREATE TABLE certificate_counters (
  school_id  uuid NOT NULL REFERENCES schools(id),
  kind       text NOT NULL,
  next_no    int  NOT NULL DEFAULT 1,
  PRIMARY KEY (school_id, kind)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admission_counters', 'student_photos', 'document_types', 'student_documents',
                           'certificate_settings', 'signatures', 'certificates', 'certificate_counters'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY school_isolation ON %I USING (school_id = app_school_id()) WITH CHECK (school_id = app_school_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO arscio_app', t);
  END LOOP;
  GRANT DELETE ON admission_counters, student_photos, document_types, certificate_settings, signatures TO arscio_app;
  FOREACH t IN ARRAY ARRAY['student_documents', 'certificates', 'document_types'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()', t || '_audit', t);
  END LOOP;
END $$;

-- Default document checklist for every school that already exists. New schools get it when created.
INSERT INTO document_types (school_id, name, category, required_classes, asks_for_class, system, sort_order)
SELECT s.id, d.name, d.category,
       CASE d.req WHEN 'all' THEN (SELECT coalesce(array_agg(c.id), '{}') FROM classes c WHERE c.school_id = s.id)
                  WHEN 'class2up' THEN (SELECT coalesce(array_agg(c.id), '{}') FROM classes c WHERE c.school_id = s.id AND c.name ~ '^[0-9]+$' AND c.name::int >= 2)
                  ELSE '{}' END,
       d.asks, d.sys, d.ord
  FROM schools s
 CROSS JOIN (VALUES
   ('Birth certificate', 'admission', 'all', false, false, 1),
   ('Parent''s ID proof', 'admission', 'all', false, false, 2),
   ('Previous school TC', 'admission', 'class2up', false, false, 3),
   ('Previous school marksheet', 'admission', 'class2up', true, false, 4),
   ('Aadhaar card', 'admission', 'none', false, false, 5),
   ('Caste / category certificate', 'admission', 'none', false, false, 6),
   ('Medical / disability certificate', 'admission', 'none', false, false, 7),
   ('Address proof', 'admission', 'none', false, false, 8),
   ('Report card', 'report_card', 'none', true, true, 20),
   ('Transfer certificate (issued)', 'certificate', 'none', false, true, 30),
   ('Bonafide certificate (issued)', 'certificate', 'none', false, true, 31),
   ('Character certificate (issued)', 'certificate', 'none', false, true, 32),
   ('Other document', 'other', 'none', false, false, 40)
 ) AS d(name, category, req, asks, sys, ord)
ON CONFLICT DO NOTHING;
