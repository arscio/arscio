// Takes the machine's pulse every 10 seconds for the control panel's live graphs:
// processor, memory, swap, load, how fast the Arscio server answers, database connections.
// The last hour is kept in memory (10-second points); one averaged row per minute is saved
// to the database (14 days) for the longer graphs.
import { readFile, statfs } from 'node:fs/promises';
import type pg from 'pg';

export interface Sample { at: number; cpu: number | null; memUsed: number; memTotal: number; swapUsed: number; load1: number; apiMs: number | null; dbConns: number | null; diskPct: number | null }

let lastCpu: { idle: number; total: number } | null = null;
async function cpuPct(): Promise<number | null> {
  try {
    const line = (await readFile('/proc/stat', 'utf8')).split('\n')[0]!.trim().split(/\s+/).slice(1).map(Number);
    const idle = line[3]! + (line[4] ?? 0), total = line.reduce((a, b) => a + b, 0);
    const prev = lastCpu; lastCpu = { idle, total };
    if (!prev || total === prev.total) return null;
    return Math.max(0, Math.min(100, Math.round((1 - (idle - prev.idle) / (total - prev.total)) * 1000) / 10));
  } catch { return null; }
}
async function memory() {
  try {
    const mi = await readFile('/proc/meminfo', 'utf8');
    const kb = (k: string) => Number(mi.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? 0) / 1024;
    return { total: Math.round(kb('MemTotal')), used: Math.round(kb('MemTotal') - kb('MemAvailable')), swap: Math.round(kb('SwapTotal') - kb('SwapFree')) };
  } catch { return { total: 0, used: 0, swap: 0 }; }
}
async function load1() {
  try { return Number((await readFile('/proc/loadavg', 'utf8')).split(' ')[0]); } catch { return 0; }
}
async function diskPct() {
  try { const s = await statfs('/'); return Math.round(((s.blocks - s.bavail) / s.blocks) * 100); } catch { return null; }
}

export class Sampler {
  readonly live: Sample[] = [];
  private timers: NodeJS.Timeout[] = [];
  constructor(private db: pg.Pool, private apiUrl: string) {}

  async take(): Promise<Sample> {
    const t = Date.now();
    const [cpu, mem, l1, disk] = await Promise.all([cpuPct(), memory(), load1(), diskPct()]);
    let apiMs: number | null = null;
    try { const r = await fetch(`${this.apiUrl}/health`, { signal: AbortSignal.timeout(4000) }); if (r.ok) apiMs = Date.now() - t; } catch { /* down */ }
    let dbConns: number | null = null;
    try { dbConns = Number((await this.db.query('SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database()')).rows[0].n); } catch { /* down */ }
    const s: Sample = { at: t, cpu, memUsed: mem.used, memTotal: mem.total, swapUsed: mem.swap, load1: l1, apiMs, dbConns, diskPct: disk };
    this.live.push(s);
    while (this.live.length && this.live[0]!.at < t - 3600e3) this.live.shift();
    return s;
  }

  /** Average of the last minute's points, saved as one row. */
  async saveMinute() {
    const since = Date.now() - 60e3, pts = this.live.filter((p) => p.at >= since);
    if (!pts.length) return;
    const avg = (f: (p: Sample) => number | null) => { const v = pts.map(f).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const last = pts[pts.length - 1]!;
    await this.db.query(
      `INSERT INTO platform_samples (at, cpu_pct, mem_used_mb, mem_total_mb, swap_used_mb, load1, api_ms, db_conns, disk_used_pct)
       VALUES (date_trunc('minute', now()), $1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (at) DO NOTHING`,
      [avg((p) => p.cpu), Math.round(avg((p) => p.memUsed) ?? 0), last.memTotal, Math.round(avg((p) => p.swapUsed) ?? 0),
       avg((p) => p.load1), avg((p) => p.apiMs) == null ? null : Math.round(avg((p) => p.apiMs)!), Math.round(avg((p) => p.dbConns) ?? 0), last.diskPct],
    ).catch(() => undefined);
  }

  async prune() {
    await this.db.query("DELETE FROM platform_samples WHERE at < now() - interval '14 days'").catch(() => undefined);
    await this.db.query("DELETE FROM platform_metrics WHERE minute < now() - interval '14 days'").catch(() => undefined);
  }

  start() {
    void this.take();
    this.timers.push(setInterval(() => void this.take(), 10_000));
    this.timers.push(setInterval(() => void this.saveMinute(), 60_000));
    this.timers.push(setInterval(() => void this.prune(), 3600_000));
    void this.prune();
  }
  stop() { this.timers.forEach(clearInterval); }
}
