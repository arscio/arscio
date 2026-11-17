-- History for the control panel's graphs (kept 14 days).

-- Requests to the Arscio server, one row per minute (written by the server itself).
CREATE TABLE platform_metrics (
  minute         timestamptz PRIMARY KEY,
  requests       int NOT NULL DEFAULT 0,
  client_errors  int NOT NULL DEFAULT 0,   -- 4xx: wrong password, not allowed, bad form
  server_errors  int NOT NULL DEFAULT 0,   -- 5xx: our fault
  p50_ms         int,
  p95_ms         int,
  max_ms         int,
  people         int NOT NULL DEFAULT 0    -- different logged-in people that minute
);

-- The machine, one row per minute (written by the control panel's sampler).
CREATE TABLE platform_samples (
  at             timestamptz PRIMARY KEY,
  cpu_pct        real,
  mem_used_mb    int,
  mem_total_mb   int,
  swap_used_mb   int,
  load1          real,
  api_ms         int,
  db_conns       int,
  disk_used_pct  int
);
