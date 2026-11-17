-- When the result date comes, families are told once that the marksheet is ready.
ALTER TABLE result_settings ADD COLUMN announced_at timestamptz;
