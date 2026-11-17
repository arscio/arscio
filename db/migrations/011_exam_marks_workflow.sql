-- Exams and marks, as agreed for the first real school:
--  - the principal sets each exam: which classes, exam dates, and a marks deadline
--  - one teacher is responsible for each subject in each class (the principal picks one
--    when several teach it); they enter and SUBMIT the marks
--  - after the first submission the teacher can still correct marks for 7 days (students
--    check their marks and ask); parents see them straight away, marked "provisional"
--  - internal marks only for the subjects the principal picks
--  - teachers' own class tests (shown to parents, never counted in the result)
--  - assignments: who submitted, sent to parents

ALTER TABLE exams
  ADD COLUMN ends_on      date,
  ADD COLUMN marks_due_on date,
  ADD CONSTRAINT exams_dates_ok CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on);

-- Subjects of an exam that have internal marks (e.g. 20 internal + 80 written).
CREATE TABLE exam_subjects (
  school_id    uuid NOT NULL REFERENCES schools(id),
  exam_id      uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  subject_id   uuid NOT NULL REFERENCES subjects(id),
  internal_max numeric(6,2) NOT NULL CHECK (internal_max > 0),
  PRIMARY KEY (exam_id, subject_id)
);

ALTER TABLE marks
  ADD COLUMN internal_marks numeric(6,2) CHECK (internal_marks >= 0),
  ADD COLUMN internal_max   numeric(6,2) CHECK (internal_max > 0),
  ADD CONSTRAINT marks_internal_ok CHECK (internal_marks IS NULL OR internal_max IS NULL OR internal_marks <= internal_max);

-- When a subject has several teachers in a class, the principal picks who enters marks.
CREATE TABLE marks_teachers (
  school_id     uuid NOT NULL REFERENCES schools(id),
  section_id    uuid NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject_id    uuid NOT NULL REFERENCES subjects(id),
  membership_id uuid NOT NULL REFERENCES memberships(id),
  chosen_by     uuid NOT NULL REFERENCES accounts(id),
  chosen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (section_id, subject_id)
);

-- One marks list = one exam x class section x subject. Submitting shows it to parents
-- and starts the 7-day correction window.
CREATE TABLE marks_submissions (
  school_id          uuid NOT NULL REFERENCES schools(id),
  exam_id            uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  section_id         uuid NOT NULL REFERENCES sections(id),
  subject_id         uuid NOT NULL REFERENCES subjects(id),
  first_submitted_at timestamptz NOT NULL DEFAULT now(),
  submitted_by       uuid NOT NULL REFERENCES accounts(id),
  last_changed_at    timestamptz NOT NULL DEFAULT now(),
  reopened_until     timestamptz,              -- principal gave more days to correct
  reopened_by        uuid REFERENCES accounts(id),
  PRIMARY KEY (exam_id, section_id, subject_id)
);

-- Every change to a submitted mark is kept (who, when, old and new), so nothing is lost.
CREATE TABLE marks_changes (
  id          bigserial PRIMARY KEY,
  school_id   uuid NOT NULL REFERENCES schools(id),
  exam_id     uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES students(id),
  subject_id  uuid NOT NULL REFERENCES subjects(id),
  old_value   jsonb,
  new_value   jsonb,
  changed_by  uuid NOT NULL REFERENCES accounts(id),
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marks_changes_idx ON marks_changes (exam_id, student_id);

-- Teachers' own class tests. Parents see them; they never count towards the result.
CREATE TABLE class_tests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES schools(id),
  section_id   uuid NOT NULL REFERENCES sections(id),
  subject_id   uuid NOT NULL REFERENCES subjects(id),
  title        text NOT NULL CHECK (length(title) BETWEEN 2 AND 80),
  held_on      date NOT NULL,
  max_marks    numeric(6,2) NOT NULL CHECK (max_marks > 0),
  created_by   uuid NOT NULL REFERENCES accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz                      -- marks shown to parents from here
);
CREATE INDEX class_tests_section_idx ON class_tests (section_id, held_on DESC);

CREATE TABLE class_test_marks (
  school_id  uuid NOT NULL REFERENCES schools(id),
  test_id    uuid NOT NULL REFERENCES class_tests(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id),
  marks      numeric(6,2) CHECK (marks >= 0),
  is_absent  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (test_id, student_id)
);

-- Assignments: on the due day the teacher ticks who handed it in; parents get the result.
ALTER TABLE homework
  ADD COLUMN report_sent_at timestamptz;

CREATE TABLE homework_submissions (
  school_id   uuid NOT NULL REFERENCES schools(id),
  homework_id uuid NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES students(id),
  status      text NOT NULL CHECK (status IN ('submitted', 'late', 'not_submitted')),
  marked_by   uuid NOT NULL REFERENCES accounts(id),
  marked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (homework_id, student_id)
);

-- School separation, the same as every other school table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exam_subjects', 'marks_teachers', 'marks_submissions', 'marks_changes',
                           'class_tests', 'class_test_marks', 'homework_submissions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY school_isolation ON %I
         USING (school_id = app_school_id()) WITH CHECK (school_id = app_school_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO arscio_app', t);
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE marks_changes_id_seq TO arscio_app;
