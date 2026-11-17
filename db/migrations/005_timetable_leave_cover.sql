-- Timetable, teacher leave and substitute cover.

-- How the school's timetable repeats.
--  weekly: the same timetable every week (day_no 1 = Monday ... 7 = Sunday)
--  cycle:  Day 1 ... Day N, moving forward one step on every working day from cycle_start
ALTER TABLE schools
  ADD COLUMN timetable_mode text NOT NULL DEFAULT 'weekly' CHECK (timetable_mode IN ('weekly', 'cycle')),
  ADD COLUMN cycle_days     int  NOT NULL DEFAULT 6 CHECK (cycle_days BETWEEN 2 AND 10),
  ADD COLUMN cycle_start    date,
  ADD COLUMN working_days   int[] NOT NULL DEFAULT '{1,2,3,4,5,6}';

-- Bell times for each period (optional; shown on screens and the printed timetable).
CREATE TABLE period_times (
  school_id  uuid NOT NULL REFERENCES schools(id),
  period_no  int  NOT NULL CHECK (period_no BETWEEN 1 AND 15),
  starts_at  time NOT NULL,
  ends_at    time NOT NULL CHECK (ends_at > starts_at),
  PRIMARY KEY (school_id, period_no)
);

-- One cell of a class's timetable: which subject and which teacher.
CREATE TABLE timetable_slots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES schools(id),
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id),
  section_id        uuid NOT NULL REFERENCES sections(id),
  day_no            int  NOT NULL CHECK (day_no BETWEEN 1 AND 10),
  period_no         int  NOT NULL CHECK (period_no BETWEEN 1 AND 15),
  subject_id        uuid REFERENCES subjects(id),
  membership_id     uuid REFERENCES memberships(id),
  UNIQUE (section_id, day_no, period_no)
);
-- A teacher can't be in two classes at the same time.
CREATE UNIQUE INDEX timetable_teacher_clash ON timetable_slots (academic_year_id, day_no, period_no, membership_id)
  WHERE membership_id IS NOT NULL;

-- One-off changes for a single date: a holiday/exam day with no classes,
-- or "follow another day's timetable" (e.g. Saturday follows Monday).
CREATE TABLE timetable_days (
  school_id    uuid NOT NULL REFERENCES schools(id),
  on_date      date NOT NULL,
  no_classes   boolean NOT NULL DEFAULT false,
  follows_day  int CHECK (follows_day BETWEEN 1 AND 10),
  note         text,
  created_by   uuid NOT NULL REFERENCES accounts(id),
  PRIMARY KEY (school_id, on_date),
  CHECK (no_classes OR follows_day IS NOT NULL)
);

-- Leave applied for by a teacher, approved or rejected by the principal.
CREATE TABLE teacher_leaves (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools(id),
  membership_id  uuid NOT NULL REFERENCES memberships(id),
  from_date      date NOT NULL,
  to_date        date NOT NULL CHECK (to_date >= from_date),
  part           text NOT NULL DEFAULT 'full' CHECK (part IN ('full', 'first_half', 'second_half', 'periods')),
  periods        int[] NOT NULL DEFAULT '{}',
  reason         text NOT NULL CHECK (length(trim(reason)) >= 3),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by     uuid REFERENCES accounts(id),
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (part <> 'periods' OR cardinality(periods) > 0)
);
CREATE INDEX teacher_leaves_dates_idx ON teacher_leaves (school_id, from_date, to_date) WHERE status = 'approved';

-- A substitute teacher assigned to one period of one class on one date.
CREATE TABLE substitutions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL REFERENCES schools(id),
  on_date               date NOT NULL,
  section_id            uuid NOT NULL REFERENCES sections(id),
  period_no             int  NOT NULL,
  subject_id            uuid REFERENCES subjects(id),
  original_membership   uuid REFERENCES memberships(id),
  substitute_membership uuid NOT NULL REFERENCES memberships(id),
  assigned_by           uuid NOT NULL REFERENCES accounts(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_id, on_date, period_no)
);
CREATE UNIQUE INDEX substitutions_teacher_clash ON substitutions (on_date, period_no, substitute_membership);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['period_times', 'timetable_slots', 'timetable_days', 'teacher_leaves', 'substitutions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY school_isolation ON %I USING (school_id = app_school_id()) WITH CHECK (school_id = app_school_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO arscio_app', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['teacher_leaves', 'substitutions', 'timetable_slots'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()',
      t || '_audit', t);
  END LOOP;
END $$;
