-- For the Arscio control panel (used only by us, through an SSH tunnel).

-- Every unexpected server error (status 500), so we can see what went wrong and where.
-- No passwords or personal details are stored here: only the time, the page and the message.
CREATE TABLE platform_errors (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  method      text NOT NULL,
  route       text NOT NULL,
  status      int  NOT NULL,
  message     text NOT NULL,
  school_id   uuid,
  account_id  uuid
);
CREATE INDEX platform_errors_at_idx ON platform_errors (at DESC);
-- The app may only add rows, never read or change them.
GRANT INSERT ON platform_errors TO arscio_app;
GRANT USAGE ON SEQUENCE platform_errors_id_seq TO arscio_app;

-- Background jobs (phone notifications, results day) report here each time they run.
CREATE TABLE platform_heartbeats (
  job          text PRIMARY KEY,
  last_run_at  timestamptz NOT NULL,
  last_ok_at   timestamptz,
  last_error   text,
  detail       jsonb
);

-- Everything done in the control panel (school created, paused, owner password reset).
CREATE TABLE platform_log (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  action  text NOT NULL,
  school_id uuid,
  detail  jsonb
);
