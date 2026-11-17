-- Logins without SMS (for schools that start with passwords only):
--  - staff log in with email or mobile number; the principal sets the first password
--  - parents log in with an admission number; the first password is the child's date of birth
--  - everyone must choose their own password the first time

ALTER TABLE accounts
  ADD COLUMN email text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX accounts_email_key ON accounts (lower(email)) WHERE email IS NOT NULL;

-- Admission numbers typed any way (GV/2027/0187, gv20270187) are matched on letters and digits only.
CREATE INDEX students_admission_login_idx ON students (upper(regexp_replace(admission_no, '[^A-Za-z0-9]', '', 'g')));

-- Wrong-password counting for logins that have no account yet (a parent's very first login).
CREATE TABLE login_failures (
  login_key     text PRIMARY KEY,          -- e.g. 'adm:GV20270187'
  failures      int  NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON login_failures TO arscio_app;

-- Finds the family behind an admission number, across schools, before anyone is logged in.
-- Only what the login check needs is returned (no names, no marks).
CREATE FUNCTION parent_login_lookup(p_norm text)
RETURNS TABLE (student_id uuid, school_id uuid, family_id uuid, account_id uuid, family_phone text, father_name text, dob date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT st.id, st.school_id, f.id, f.account_id, f.phone, coalesce(f.father_name, f.mother_name, f.guardian_name, 'Parent'), st.date_of_birth
    FROM students st JOIN families f ON f.id = st.family_id
    JOIN schools s ON s.id = st.school_id AND s.status = 'active'
   WHERE upper(regexp_replace(st.admission_no, '[^A-Za-z0-9]', '', 'g')) = p_norm
     AND st.status = 'active'
$$;
REVOKE ALL ON FUNCTION parent_login_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION parent_login_lookup(text) TO arscio_app;

-- After a correct first login: connects the family to the parent's account and gives the parent role.
CREATE FUNCTION link_parent_account(p_family uuid, p_account uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_school uuid; v_name text; v_member uuid;
BEGIN
  SELECT school_id, coalesce(father_name, mother_name, guardian_name, 'Parent') INTO v_school, v_name FROM families WHERE id = p_family;
  IF v_school IS NULL THEN RAISE EXCEPTION 'family not found'; END IF;
  UPDATE families SET account_id = p_account WHERE id = p_family AND (account_id IS NULL OR account_id = p_account);
  INSERT INTO memberships (school_id, account_id, display_name) VALUES (v_school, p_account, v_name)
    ON CONFLICT (school_id, account_id) DO NOTHING;
  SELECT id INTO v_member FROM memberships WHERE school_id = v_school AND account_id = p_account;
  INSERT INTO membership_roles (school_id, membership_id, role) VALUES (v_school, v_member, 'parent')
    ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION link_parent_account(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION link_parent_account(uuid, uuid) TO arscio_app;

-- True if this person works at any school (used so a child's date of birth can never open a staff login).
CREATE FUNCTION staff_account_exists(p_account uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM memberships m JOIN membership_roles r ON r.membership_id = m.id
                  WHERE m.account_id = p_account AND r.role <> 'parent')
$$;
REVOKE ALL ON FUNCTION staff_account_exists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff_account_exists(uuid) TO arscio_app;
