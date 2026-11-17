-- =====================================================================
-- Migration 003: notices and each person's message inbox
-- =====================================================================
-- Every message a person gets (absent today, homework, notices) is kept in
-- "notifications". That doubles as their inbox in the app, and is what gets
-- sent as a phone notification. A parent with children in two schools sees
-- all their messages together, so their OWN messages are visible to them
-- whichever school they're looking at.

ALTER TABLE notifications ADD COLUMN read_at timestamptz;
ALTER TABLE notifications ADD COLUMN push_error text;
CREATE INDEX notifications_inbox_idx ON notifications (account_id, created_at DESC);

DROP POLICY school_isolation ON notifications;
CREATE POLICY school_or_own ON notifications
  USING (school_id = app_school_id() OR account_id = app_account_id())
  WITH CHECK (school_id = app_school_id() OR account_id = app_account_id());

-- A notice can be withdrawn (it disappears from parents' apps) but is never deleted.
ALTER TABLE notices ADD COLUMN withdrawn_at timestamptz;
ALTER TABLE notices ADD COLUMN withdrawn_by uuid REFERENCES accounts(id);
CREATE TRIGGER notices_no_delete BEFORE DELETE ON notices
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
REVOKE DELETE ON notices FROM arscio_app;

-- Push devices belong to a person, not a school.
ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_devices ON push_devices
  USING (account_id = app_account_id()) WITH CHECK (account_id = app_account_id());

-- When a phone changes hands, its notification address moves to whoever is now
-- logged in. Runs with extra rights, but only ever for the person calling it.
CREATE FUNCTION claim_push_device(p_account uuid, p_app text, p_platform text, p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_account IS DISTINCT FROM app_account_id() THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM push_devices WHERE push_token = p_token AND account_id <> p_account;
  INSERT INTO push_devices (account_id, app, platform, push_token) VALUES (p_account, p_app, p_platform, p_token)
  ON CONFLICT (push_token) DO UPDATE SET last_seen_at = now(), app = excluded.app, platform = excluded.platform;
END $$;
REVOKE ALL ON FUNCTION claim_push_device(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_push_device(uuid, text, text, text) TO arscio_app;
