// Counts requests to the Arscio server per minute (how many, how fast, how many failed, how many
// different people) and saves one row per minute for the control panel's graphs.
// Only numbers are kept: no addresses, pages or personal details.
import type pg from 'pg';

export class RequestMetrics {
  private minute = 0;
  private durations: number[] = [];
  private clientErrors = 0;
  private serverErrors = 0;
  private people = new Set<string>();

  record(statusCode: number, ms: number, accountId: string | null) {
    const m = Math.floor(Date.now() / 60000);
    if (m !== this.minute) this.rollTo(m);
    this.durations.push(ms);
    if (statusCode >= 500) this.serverErrors++;
    else if (statusCode >= 400) this.clientErrors++;
    if (accountId) this.people.add(accountId);
  }

  private pending: { minute: number; requests: number; client: number; server: number; p50: number; p95: number; max: number; people: number }[] = [];

  private rollTo(m: number) {
    if (this.durations.length) {
      const d = [...this.durations].sort((a, b) => a - b);
      const at = (p: number) => Math.round(d[Math.min(d.length - 1, Math.floor(p * d.length))]!);
      this.pending.push({ minute: this.minute, requests: d.length, client: this.clientErrors, server: this.serverErrors,
        p50: at(0.5), p95: at(0.95), max: Math.round(d[d.length - 1]!), people: this.people.size });
    }
    this.minute = m; this.durations = []; this.clientErrors = 0; this.serverErrors = 0; this.people = new Set();
  }

  /** Saves finished minutes. Called every minute; never throws. */
  async flush(db: pg.Pool) {
    const now = Math.floor(Date.now() / 60000);
    if (this.minute && this.minute < now) this.rollTo(now);
    const rows = this.pending.splice(0);
    for (const r of rows) {
      await db.query(
        `INSERT INTO platform_metrics (minute, requests, client_errors, server_errors, p50_ms, p95_ms, max_ms, people)
         VALUES (to_timestamp($1 * 60), $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (minute) DO UPDATE SET requests = platform_metrics.requests + excluded.requests,
           client_errors = platform_metrics.client_errors + excluded.client_errors,
           server_errors = platform_metrics.server_errors + excluded.server_errors,
           p50_ms = excluded.p50_ms, p95_ms = GREATEST(platform_metrics.p95_ms, excluded.p95_ms),
           max_ms = GREATEST(platform_metrics.max_ms, excluded.max_ms), people = GREATEST(platform_metrics.people, excluded.people)`,
        [r.minute, r.requests, r.client, r.server, r.p50, r.p95, r.max, r.people]).catch(() => undefined);
    }
  }
}
