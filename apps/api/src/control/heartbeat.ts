// Background jobs say "I ran" (and whether it worked) so the control panel can show
// when one has stopped or keeps failing.
import type pg from 'pg';

export async function heartbeat(owner: pg.Pool, job: string, ok: boolean, detail?: Record<string, unknown>, error?: string) {
  try {
    await owner.query(
      `INSERT INTO platform_heartbeats (job, last_run_at, last_ok_at, last_error, detail)
       VALUES ($1, now(), CASE WHEN $2 THEN now() END, $3, $4)
       ON CONFLICT (job) DO UPDATE SET last_run_at = now(),
         last_ok_at = CASE WHEN $2 THEN now() ELSE platform_heartbeats.last_ok_at END,
         last_error = CASE WHEN $2 THEN NULL ELSE $3 END,
         detail = coalesce($4, platform_heartbeats.detail)`,
      [job, ok, error ?? null, detail ? JSON.stringify(detail) : null]);
  } catch { /* the panel is a helper; never let it break the job */ }
}
