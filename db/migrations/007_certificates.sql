-- Certificates: the title printed under a signature ("Principal", "Director").
ALTER TABLE signatures ADD COLUMN signer_title text;
-- Fast lookups for the admission and withdrawal register and each student's certificates.
CREATE INDEX IF NOT EXISTS certificates_student_idx ON certificates (student_id, kind, issued_at DESC);
CREATE INDEX IF NOT EXISTS students_admission_idx ON students (school_id, admission_date, admission_no);
