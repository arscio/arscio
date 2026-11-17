-- =====================================================================
-- Migration 002: each school's own identity
-- =====================================================================
-- Staff screens (admin website, teacher app) always use the Arscio brand.
-- The school's own logo and colour appear on what families see:
-- the school's public website, the parent (and later student) app,
-- receipts and report cards.

ALTER TABLE schools
  ADD COLUMN brand_color text CHECK (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD COLUMN short_name  text,            -- e.g. "GVPS", for small spaces in the parent app
  ADD COLUMN affiliation_no text;         -- CBSE affiliation number, printed on documents

-- The logo image itself (small PNG/JPEG/WebP, max ~300 KB).
CREATE TABLE school_logos (
  school_id   uuid PRIMARY KEY REFERENCES schools(id),
  mime        text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  data        bytea NOT NULL CHECK (octet_length(data) <= 400000),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE school_logos ENABLE ROW LEVEL SECURITY;
CREATE POLICY school_isolation ON school_logos
  USING (school_id = app_school_id()) WITH CHECK (school_id = app_school_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON school_logos TO arscio_app;
