-- Report cards: the principal publishes a term's results to parents when ready.
ALTER TABLE terms
  ADD COLUMN published_at timestamptz,
  ADD COLUMN published_by uuid REFERENCES accounts(id);

-- Fast lookups for marks entry progress and report cards.
CREATE INDEX IF NOT EXISTS marks_student_idx ON marks (student_id, exam_id);
CREATE INDEX IF NOT EXISTS exams_term_idx ON exams (term_id);
