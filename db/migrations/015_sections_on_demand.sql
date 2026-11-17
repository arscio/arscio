-- Sections only when a class needs them (17 Nov 2026).
-- A class with one section has no letter: it is just "Class 6". Each section has a number of seats.
-- When admissions go past the seats, the principal decides: keep as it is, or make a second
-- section and choose who moves there (the first becomes A, the new one B).

ALTER TABLE sections
  ADD COLUMN seats int CHECK (seats BETWEEN 1 AND 500),
  -- The principal chose "keep as it is" when the section had this many students.
  -- The notice comes back only if more students join after that.
  ADD COLUMN seats_ok_up_to int;

-- Existing classes with a single section lose the letter ("6 A" becomes "6").
UPDATE sections s SET name = ''
 WHERE (SELECT count(*) FROM sections x
         WHERE x.class_id = s.class_id AND x.academic_year_id = s.academic_year_id) = 1;

-- How a class and section are written everywhere: "Class 6", "Class 6 B", "Nursery", "LKG A".
CREATE FUNCTION section_label(class_name text, section_name text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN class_name ~ '^[0-9]+$' THEN 'Class ' || class_name ELSE class_name END
      || CASE WHEN coalesce(section_name, '') = '' THEN '' ELSE ' ' || section_name END
$$;
