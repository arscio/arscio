-- =====================================================================
-- arscio - Migration 001: the foundation
-- =====================================================================
-- PLAIN-LANGUAGE SUMMARY
--   * Every school's data lives in the same database, but EVERY row is
--     stamped with its school_id. The database itself (not just our code)
--     refuses to show a row to the app unless the app has first declared
--     "I am working for school X right now". This is called Row-Level
--     Security. Even a bug in our code cannot leak School A's data to
--     School B.
--   * A login ("account") belongs to a person and is identified by phone.
--     The same person can be linked to several schools ("memberships")
--     and hold several roles in each (e.g. teacher + accountant).
--   * Receipts can never be deleted - not by the app, not by mistake.
--     They can only be cancelled, and the database forces a reason, the
--     person and the time to be saved.
--   * Important changes are written to an audit log that cannot be edited.
-- =====================================================================

-- ---------- Helpers ---------------------------------------------------

-- Which school is the current request working for? (set per request)
CREATE OR REPLACE FUNCTION app_school_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.school_id', true), '')::uuid
$$;

-- Which logged-in account is making the current request?
CREATE OR REPLACE FUNCTION app_account_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.account_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------- Schools ---------------------------------------------------

CREATE TABLE schools (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     text NOT NULL UNIQUE,          -- short id e.g. "SAV-DHUBRI"
  name                     text NOT NULL,
  board                    text NOT NULL DEFAULT 'CBSE',
  address                  text,
  phone                    text,
  email                    text,
  logo_url                 text,
  website_domain           text,
  timezone                 text NOT NULL DEFAULT 'Asia/Kolkata',
  -- Principal's one-time choice: attendance once a day or every period
  attendance_mode          text NOT NULL DEFAULT 'daily'
                             CHECK (attendance_mode IN ('daily', 'period')),
  periods_per_day          int  NOT NULL DEFAULT 8 CHECK (periods_per_day BETWEEN 1 AND 15),
  -- Online fee payment switch (Razorpay, money goes to school's own account)
  online_payments_enabled  boolean NOT NULL DEFAULT false,
  razorpay_key_id          text,
  razorpay_key_secret_enc  bytea,                          -- stored encrypted, never plain
  receipt_prefix           text NOT NULL DEFAULT 'RC',
  status                   text NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'suspended', 'closed')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT online_payments_enabled OR razorpay_key_id IS NOT NULL)
);
CREATE TRIGGER schools_touch BEFORE UPDATE ON schools
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- Logins (shared across schools) ---------------------------

CREATE TABLE accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone               text NOT NULL UNIQUE CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  name                text NOT NULL,
  password_hash       text,                 -- NULL = must log in with OTP and set a password
  failed_logins       int  NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  password_set_at     timestamptz,
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER accounts_touch BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- One-time codes sent by SMS. Only a scrambled (hashed) copy is stored.
CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  purpose     text NOT NULL CHECK (purpose IN ('first_login', 'reset_password')),
  code_hash   text NOT NULL,
  attempts    int  NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON otp_codes (phone, created_at DESC);

-- "Stay logged in" tokens for the apps (only hashed copies stored).
CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id),
  token_hash   text NOT NULL UNIQUE,
  device_label text,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_account_idx ON refresh_tokens (account_id);

-- Phone push-notification addresses for the apps.
CREATE TABLE push_devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id),
  app         text NOT NULL CHECK (app IN ('teacher', 'parent')),
  platform    text NOT NULL CHECK (platform IN ('android', 'ios')),
  push_token  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- People inside a school, and their roles -------------------

CREATE TABLE memberships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES schools(id),
  account_id   uuid NOT NULL REFERENCES accounts(id),
  display_name text NOT NULL,
  employee_code text,
  designation  text,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, account_id)
);

-- Fixed list of roles. One person can hold many.
CREATE TABLE membership_roles (
  school_id     uuid NOT NULL REFERENCES schools(id),
  membership_id uuid NOT NULL REFERENCES memberships(id),
  role          text NOT NULL CHECK (role IN (
                  'owner', 'principal', 'office_admin', 'accountant',
                  'teacher', 'parent')),
  assigned_by   uuid REFERENCES accounts(id),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, role)
);

-- ---------- Academic structure ---------------------------------------

CREATE TABLE academic_years (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id),
  name        text NOT NULL,                  -- "2027-28"
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  is_current  boolean NOT NULL DEFAULT false,
  UNIQUE (school_id, name),
  CHECK (ends_on > starts_on)
);
-- Only one "current" year per school
CREATE UNIQUE INDEX academic_years_one_current
  ON academic_years (school_id) WHERE is_current;

CREATE TABLE classes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES schools(id),
  name             text NOT NULL,             -- "Nursery", "LKG", "UKG", "1" ... "10"
  sort_order       int  NOT NULL,
  -- Nursery/KG get grades + comments; Classes 1-10 get marks + grades
  assessment_style text NOT NULL DEFAULT 'marks_and_grades'
                     CHECK (assessment_style IN ('grades_only', 'marks_and_grades')),
  UNIQUE (school_id, name)
);

CREATE TABLE sections (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id                uuid NOT NULL REFERENCES schools(id),
  academic_year_id         uuid NOT NULL REFERENCES academic_years(id),
  class_id                 uuid NOT NULL REFERENCES classes(id),
  name                     text NOT NULL,     -- "A", "B"
  class_teacher_membership uuid REFERENCES memberships(id),
  UNIQUE (academic_year_id, class_id, name)
);

CREATE TABLE subjects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id),
  name       text NOT NULL,
  code       text,
  UNIQUE (school_id, name)
);

-- Which subjects a class studies (admin adjustable)
CREATE TABLE class_subjects (
  school_id   uuid NOT NULL REFERENCES schools(id),
  class_id    uuid NOT NULL REFERENCES classes(id),
  subject_id  uuid NOT NULL REFERENCES subjects(id),
  sort_order  int NOT NULL DEFAULT 0,
  PRIMARY KEY (class_id, subject_id)
);

-- Which teacher teaches which subject in which section
CREATE TABLE section_teachers (
  school_id      uuid NOT NULL REFERENCES schools(id),
  section_id     uuid NOT NULL REFERENCES sections(id),
  subject_id     uuid NOT NULL REFERENCES subjects(id),
  membership_id  uuid NOT NULL REFERENCES memberships(id),
  PRIMARY KEY (section_id, subject_id, membership_id)
);

-- ---------- Families and students ------------------------------------

-- One phone number per family. All children with that phone appear together.
CREATE TABLE families (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools(id),
  phone          text NOT NULL CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  account_id     uuid REFERENCES accounts(id),     -- the parent login for this family
  father_name    text,
  mother_name    text,
  guardian_name  text,
  alt_phone      text,
  email          text,
  address        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, phone)
);

CREATE TABLE students (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL REFERENCES schools(id),
  family_id       uuid NOT NULL REFERENCES families(id),
  admission_no    text NOT NULL,
  first_name      text NOT NULL,
  last_name       text,
  date_of_birth   date,
  gender          text CHECK (gender IN ('male', 'female', 'other')),
  blood_group     text,
  photo_url       text,
  admission_date  date,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'left', 'passed_out', 'transferred')),
  left_on         date,
  extra           jsonb NOT NULL DEFAULT '{}',   -- extra Excel columns we don't model yet
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, admission_no)
);
CREATE INDEX students_family_idx ON students (family_id);
CREATE TRIGGER students_touch BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Which section a student is in for a given year (history kept year by year)
CREATE TABLE enrollments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES schools(id),
  student_id        uuid NOT NULL REFERENCES students(id),
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id),
  section_id        uuid NOT NULL REFERENCES sections(id),
  roll_no           int,
  UNIQUE (student_id, academic_year_id)
);
CREATE INDEX enrollments_section_idx ON enrollments (section_id);

-- Record of each Excel import (so mistakes can be traced)
CREATE TABLE import_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES schools(id),
  kind         text NOT NULL CHECK (kind IN ('students', 'staff', 'fees_opening')),
  file_name    text NOT NULL,
  rows_total   int NOT NULL DEFAULT 0,
  rows_ok      int NOT NULL DEFAULT 0,
  rows_failed  int NOT NULL DEFAULT 0,
  errors       jsonb NOT NULL DEFAULT '[]',
  imported_by  uuid REFERENCES accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- Attendance ------------------------------------------------

-- One "sheet" per section per day (daily mode) or per period (period mode)
CREATE TABLE attendance_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES schools(id),
  section_id    uuid NOT NULL REFERENCES sections(id),
  on_date       date NOT NULL,
  period_no     int NOT NULL DEFAULT 0,      -- 0 = whole day
  subject_id    uuid REFERENCES subjects(id),
  taken_by      uuid NOT NULL REFERENCES accounts(id),
  taken_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_id, on_date, period_no)
);
CREATE INDEX attendance_sessions_date_idx ON attendance_sessions (school_id, on_date);

CREATE TABLE attendance_marks (
  school_id    uuid NOT NULL REFERENCES schools(id),
  session_id   uuid NOT NULL REFERENCES attendance_sessions(id),
  student_id   uuid NOT NULL REFERENCES students(id),
  status       text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'half_day', 'leave')),
  note         text,
  PRIMARY KEY (session_id, student_id)
);

-- Teacher/staff attendance (for "teachers present" on the dashboard)
CREATE TABLE staff_attendance (
  school_id      uuid NOT NULL REFERENCES schools(id),
  membership_id  uuid NOT NULL REFERENCES memberships(id),
  on_date        date NOT NULL,
  status         text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'half_day', 'leave')),
  marked_by      uuid REFERENCES accounts(id),
  marked_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, on_date)
);

-- ---------- Fees ------------------------------------------------------

-- Types of fee: Tuition, Admission, Transport, Exam, ...
CREATE TABLE fee_heads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id),
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (school_id, name)
);

-- When fees are due (e.g. Apr-Jun, Jul-Sep ...) and the late fine rule
CREATE TABLE fee_instalments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES schools(id),
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id),
  name              text NOT NULL,
  due_on            date NOT NULL,
  grace_days        int  NOT NULL DEFAULT 0,
  fine_type         text NOT NULL DEFAULT 'none' CHECK (fine_type IN ('none', 'flat', 'per_day')),
  fine_amount       numeric(10,2) NOT NULL DEFAULT 0 CHECK (fine_amount >= 0),
  fine_cap          numeric(10,2),
  sort_order        int NOT NULL DEFAULT 0,
  UNIQUE (academic_year_id, name)
);

-- How much each class pays for each fee type in each instalment
CREATE TABLE fee_structure (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES schools(id),
  class_id         uuid NOT NULL REFERENCES classes(id),
  fee_head_id      uuid NOT NULL REFERENCES fee_heads(id),
  instalment_id    uuid NOT NULL REFERENCES fee_instalments(id),
  amount           numeric(10,2) NOT NULL CHECK (amount >= 0),
  UNIQUE (class_id, fee_head_id, instalment_id)
);

-- Discounts/concessions for a particular student (sibling, staff ward, etc.)
CREATE TABLE fee_concessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES schools(id),
  student_id        uuid NOT NULL REFERENCES students(id),
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id),
  fee_head_id       uuid REFERENCES fee_heads(id),      -- NULL = applies to all heads
  kind              text NOT NULL CHECK (kind IN ('percent', 'flat')),
  value             numeric(10,2) NOT NULL CHECK (value >= 0),
  reason            text NOT NULL CHECK (length(trim(reason)) >= 3),
  approved_by       uuid NOT NULL REFERENCES accounts(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value <= 100)
);

-- What each student owes: one line per fee type per instalment
CREATE TABLE fee_dues (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES schools(id),
  student_id        uuid NOT NULL REFERENCES students(id),
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id),
  instalment_id     uuid NOT NULL REFERENCES fee_instalments(id),
  fee_head_id       uuid NOT NULL REFERENCES fee_heads(id),
  amount            numeric(10,2) NOT NULL CHECK (amount >= 0),
  concession        numeric(10,2) NOT NULL DEFAULT 0 CHECK (concession >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, instalment_id, fee_head_id),
  CHECK (concession <= amount)
);
CREATE INDEX fee_dues_student_idx ON fee_dues (student_id);

-- Receipt number counter per school per year (no gaps, no duplicates)
CREATE TABLE receipt_counters (
  school_id         uuid NOT NULL REFERENCES schools(id),
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id),
  next_no           int  NOT NULL DEFAULT 1,
  PRIMARY KEY (school_id, academic_year_id)
);

CREATE TABLE receipts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES schools(id),
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id),
  receipt_no        text NOT NULL,
  student_id        uuid NOT NULL REFERENCES students(id),
  paid_on           date NOT NULL DEFAULT current_date,
  total_amount      numeric(10,2) NOT NULL CHECK (total_amount > 0),
  mode              text NOT NULL CHECK (mode IN ('cash', 'upi', 'cheque', 'bank_transfer', 'card', 'online')),
  reference         text,                     -- cheque no., UPI ref, Razorpay payment id
  collected_by      uuid NOT NULL REFERENCES accounts(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_by      uuid REFERENCES accounts(id),
  cancelled_at      timestamptz,
  cancel_reason     text,
  UNIQUE (school_id, receipt_no),
  -- A cancelled receipt MUST say who, when and why.
  CHECK (
    (status = 'active' AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancel_reason IS NULL)
    OR
    (status = 'cancelled' AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL
       AND cancel_reason IS NOT NULL AND length(trim(cancel_reason)) >= 5)
  )
);
CREATE INDEX receipts_student_idx ON receipts (student_id);
CREATE INDEX receipts_date_idx ON receipts (school_id, paid_on);

CREATE TABLE receipt_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES schools(id),
  receipt_id   uuid NOT NULL REFERENCES receipts(id),
  fee_due_id   uuid REFERENCES fee_dues(id),
  description  text NOT NULL,
  amount       numeric(10,2) NOT NULL CHECK (amount >= 0),   -- towards the due
  fine         numeric(10,2) NOT NULL DEFAULT 0 CHECK (fine >= 0)
);
CREATE INDEX receipt_lines_due_idx ON receipt_lines (fee_due_id);

-- Online payments through Razorpay (only when the school's switch is ON)
CREATE TABLE online_payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            uuid NOT NULL REFERENCES schools(id),
  student_id           uuid NOT NULL REFERENCES students(id),
  amount               numeric(10,2) NOT NULL CHECK (amount > 0),
  razorpay_order_id    text NOT NULL UNIQUE,
  razorpay_payment_id  text UNIQUE,
  status               text NOT NULL DEFAULT 'created'
                         CHECK (status IN ('created', 'paid', 'failed')),
  due_ids              uuid[] NOT NULL,
  receipt_id           uuid REFERENCES receipts(id),
  initiated_by         uuid NOT NULL REFERENCES accounts(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------- Notices & homework ----------------------------------------

CREATE TABLE notices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools(id),
  title          text NOT NULL,
  body           text NOT NULL,
  -- who sees it: everyone / all parents / all staff / specific classes or sections
  audience       text NOT NULL CHECK (audience IN ('everyone', 'parents', 'staff', 'classes', 'sections')),
  class_ids      uuid[] NOT NULL DEFAULT '{}',
  section_ids    uuid[] NOT NULL DEFAULT '{}',
  attachment_url text,
  send_sms       boolean NOT NULL DEFAULT false,   -- off by default: app notification first
  created_by     uuid NOT NULL REFERENCES accounts(id),
  published_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notice_reads (
  school_id   uuid NOT NULL REFERENCES schools(id),
  notice_id   uuid NOT NULL REFERENCES notices(id),
  account_id  uuid NOT NULL REFERENCES accounts(id),
  read_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, account_id)
);

CREATE TABLE homework (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES schools(id),
  section_id   uuid NOT NULL REFERENCES sections(id),
  subject_id   uuid REFERENCES subjects(id),
  title        text NOT NULL,
  details      text,
  due_on       date,
  attachment_url text,
  created_by   uuid NOT NULL REFERENCES accounts(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- Exams, marks, report cards --------------------------------

-- Grade scale (e.g. CBSE A1 91-100, A2 81-90 ...). Admin adjustable.
CREATE TABLE grading_scales (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id),
  name       text NOT NULL,
  -- [{"min":91,"max":100,"grade":"A1","point":10}, ...] for marks
  -- [{"grade":"A","label":"Excellent"}, ...] for grade-only (Nursery/KG)
  bands      jsonb NOT NULL,
  UNIQUE (school_id, name)
);

CREATE TABLE terms (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES schools(id),
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id),
  name              text NOT NULL,            -- "Term 1"
  sort_order        int NOT NULL DEFAULT 0,
  UNIQUE (academic_year_id, name)
);

-- Exams inside a term, with weightage towards the final result
CREATE TABLE exams (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES schools(id),
  term_id           uuid NOT NULL REFERENCES terms(id),
  name              text NOT NULL,            -- "Periodic Test 1", "Half Yearly"
  default_max_marks numeric(6,2) NOT NULL DEFAULT 100 CHECK (default_max_marks > 0),
  weightage_pct     numeric(5,2) NOT NULL DEFAULT 100 CHECK (weightage_pct BETWEEN 0 AND 100),
  class_ids         uuid[] NOT NULL DEFAULT '{}',   -- empty = all classes
  grading_scale_id  uuid REFERENCES grading_scales(id),
  starts_on         date,
  marks_locked      boolean NOT NULL DEFAULT false,
  sort_order        int NOT NULL DEFAULT 0,
  UNIQUE (term_id, name)
);

CREATE TABLE marks (
  school_id       uuid NOT NULL REFERENCES schools(id),
  exam_id         uuid NOT NULL REFERENCES exams(id),
  student_id      uuid NOT NULL REFERENCES students(id),
  subject_id      uuid NOT NULL REFERENCES subjects(id),
  marks_obtained  numeric(6,2) CHECK (marks_obtained >= 0),
  max_marks       numeric(6,2) CHECK (max_marks > 0),
  grade           text,                          -- used alone for Nursery/KG
  is_absent       boolean NOT NULL DEFAULT false,
  entered_by      uuid NOT NULL REFERENCES accounts(id),
  entered_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exam_id, student_id, subject_id),
  CHECK (marks_obtained IS NULL OR max_marks IS NULL OR marks_obtained <= max_marks)
);

-- Teacher's comments on the report card (and Nursery/KG descriptive remarks)
CREATE TABLE report_remarks (
  school_id    uuid NOT NULL REFERENCES schools(id),
  term_id      uuid NOT NULL REFERENCES terms(id),
  student_id   uuid NOT NULL REFERENCES students(id),
  subject_id   uuid REFERENCES subjects(id),    -- NULL = overall remark
  remark       text NOT NULL,
  written_by   uuid NOT NULL REFERENCES accounts(id),
  written_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX report_remarks_unique
  ON report_remarks (term_id, student_id, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'));

-- ---------- Outgoing notifications (app push first, SMS minimal) -----

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id),
  account_id  uuid NOT NULL REFERENCES accounts(id),
  channel     text NOT NULL DEFAULT 'push' CHECK (channel IN ('push', 'sms', 'whatsapp')),
  title       text NOT NULL,
  body        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX notifications_queue_idx ON notifications (status, created_at) WHERE status = 'queued';

-- ---------- Audit log (cannot be edited or deleted) --------------------

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  school_id   uuid,
  account_id  uuid,
  action      text NOT NULL,             -- INSERT / UPDATE / DELETE / or a named action
  table_name  text NOT NULL,
  row_id      text,
  before      jsonb,
  after       jsonb,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_school_idx ON audit_log (school_id, at DESC);

CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec jsonb;
BEGIN
  rec := to_jsonb(coalesce(NEW, OLD));
  INSERT INTO audit_log (school_id, account_id, action, table_name, row_id, before, after)
  VALUES (
    (rec ->> 'school_id')::uuid,
    app_account_id(),
    TG_OP,
    TG_TABLE_NAME,
    coalesce(rec ->> 'id', rec ->> 'membership_id', rec ->> 'session_id'),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN coalesce(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

-- ---------- Receipt protection ----------------------------------------

-- Receipts can NEVER be deleted (not even by the database owner).
CREATE TRIGGER receipts_no_delete BEFORE DELETE ON receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER receipts_no_truncate BEFORE TRUNCATE ON receipts
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();
CREATE TRIGGER receipt_lines_no_change BEFORE UPDATE OR DELETE ON receipt_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER receipt_lines_no_truncate BEFORE TRUNCATE ON receipt_lines
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

-- The ONLY change allowed to a receipt: active -> cancelled (with who/when/why).
CREATE OR REPLACE FUNCTION receipts_only_cancel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Receipt % is already cancelled and cannot be changed', OLD.receipt_no
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'Receipts cannot be edited; they can only be cancelled'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.id, NEW.school_id, NEW.academic_year_id, NEW.receipt_no, NEW.student_id,
      NEW.paid_on, NEW.total_amount, NEW.mode, NEW.reference, NEW.collected_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.school_id, OLD.academic_year_id, OLD.receipt_no, OLD.student_id,
      OLD.paid_on, OLD.total_amount, OLD.mode, OLD.reference, OLD.collected_by, OLD.created_at)
  THEN
    RAISE EXCEPTION 'Receipts cannot be edited; they can only be cancelled'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.cancelled_at := now();   -- time always comes from the server clock
  RETURN NEW;
END $$;
CREATE TRIGGER receipts_update_guard BEFORE UPDATE ON receipts
  FOR EACH ROW EXECUTE FUNCTION receipts_only_cancel();

-- ---------- Turn on the audit trail for important tables -------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'schools', 'memberships', 'membership_roles', 'families', 'students', 'enrollments',
    'fee_structure', 'fee_concessions', 'fee_dues', 'receipts', 'receipt_lines',
    'online_payments', 'marks', 'attendance_sessions', 'notices', 'exams'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION audit_row()', t || '_audit', t);
  END LOOP;
END $$;

-- ---------- Money views (respect school separation) --------------------

-- How much is paid / still owed on each due line.
CREATE VIEW fee_due_balances WITH (security_invoker = true) AS
SELECT
  d.id            AS fee_due_id,
  d.school_id,
  d.student_id,
  d.academic_year_id,
  d.instalment_id,
  d.fee_head_id,
  i.due_on,
  d.amount,
  d.concession,
  coalesce(p.paid, 0)                              AS paid,
  d.amount - d.concession - coalesce(p.paid, 0)    AS balance
FROM fee_dues d
JOIN fee_instalments i ON i.id = d.instalment_id
LEFT JOIN LATERAL (
  SELECT sum(l.amount) AS paid
  FROM receipt_lines l
  JOIN receipts r ON r.id = l.receipt_id
  WHERE l.fee_due_id = d.id AND r.status = 'active'
) p ON true;

-- ---------- School separation (Row-Level Security) ---------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'academic_years', 'classes', 'sections', 'subjects',
    'class_subjects', 'section_teachers', 'families', 'students', 'enrollments',
    'import_batches', 'attendance_sessions', 'attendance_marks', 'staff_attendance',
    'fee_heads', 'fee_instalments', 'fee_structure', 'fee_concessions', 'fee_dues',
    'receipt_counters', 'receipts', 'receipt_lines', 'online_payments',
    'notices', 'notice_reads', 'homework', 'grading_scales', 'terms', 'exams',
    'marks', 'report_remarks', 'notifications'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY school_isolation ON %I
         USING (school_id = app_school_id())
         WITH CHECK (school_id = app_school_id())', t);
  END LOOP;
END $$;

-- Memberships: visible inside the current school, OR your own memberships
-- (so the app can show "which schools do I belong to" at login).
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_visibility ON memberships
  USING (school_id = app_school_id() OR account_id = app_account_id())
  WITH CHECK (school_id = app_school_id());

-- Roles: visible inside the current school, OR your own roles in any school
-- (needed before a school is chosen, e.g. "show all my children").
-- Changing roles is only ever possible inside the current school.
ALTER TABLE membership_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_visibility ON membership_roles FOR SELECT
  USING (
    school_id = app_school_id()
    OR membership_id IN (SELECT m.id FROM memberships m WHERE m.account_id = app_account_id())
  );
CREATE POLICY role_insert ON membership_roles FOR INSERT WITH CHECK (school_id = app_school_id());
CREATE POLICY role_update ON membership_roles FOR UPDATE
  USING (school_id = app_school_id()) WITH CHECK (school_id = app_school_id());
CREATE POLICY role_delete ON membership_roles FOR DELETE USING (school_id = app_school_id());

-- Schools: you can see the current school and schools you belong to.
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_visibility ON schools
  USING (
    id = app_school_id()
    OR id IN (SELECT m.school_id FROM memberships m WHERE m.account_id = app_account_id())
  );
CREATE POLICY school_update ON schools FOR UPDATE
  USING (id = app_school_id()) WITH CHECK (id = app_school_id());

-- Audit log: the app may add entries and read its own school's entries only.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON audit_log FOR INSERT WITH CHECK (true);
CREATE POLICY audit_read ON audit_log FOR SELECT USING (school_id = app_school_id());

-- ---------- What the running app is allowed to do ---------------------
-- (The "arscio_app" database user is created by the migration runner.)

GRANT USAGE ON SCHEMA public TO arscio_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO arscio_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO arscio_app;

-- Belt and braces: the app user simply has no permission to delete money records
-- or touch the audit log.
REVOKE DELETE ON receipts, receipt_lines, audit_log FROM arscio_app;
REVOKE UPDATE ON receipt_lines, audit_log FROM arscio_app;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM arscio_app;
-- Only the platform (not a school) creates schools.
REVOKE INSERT, DELETE ON schools FROM arscio_app;
