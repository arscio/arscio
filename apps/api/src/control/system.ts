// Reads the server's health for the control panel: services, memory, disk, crashes,
// backups. Everything here only READS; nothing is changed on the server.
// On a computer without these tools (e.g. a developer laptop) each part says "unknown".
import { execFile } from 'node:child_process';
import { readFile, readdir, stat, statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface ServiceInfo {
  unit: string; label: string; state: string; since: string | null; restarts: number | null; memoryMb: number | null;
}

/** The services we watch (only Arscio's own; Curavo shares the server but isn't shown here). */
export const SERVICES: { unit: string; label: string }[] = [
  { unit: 'arscio-api', label: 'Arscio server (apps and website talk to this)' },
  { unit: 'arscio-web', label: 'Arscio office website' },
  { unit: 'arscio-control', label: 'This control panel' },
  { unit: 'postgresql@16-main', label: 'Database' },
  { unit: 'caddy', label: 'Web gateway (https)' },
];

export async function services(): Promise<ServiceInfo[]> {
  return Promise.all(SERVICES.map(async ({ unit, label }) => {
    try {
      const { stdout } = await run('systemctl', ['show', unit, '-p', 'ActiveState', '-p', 'ActiveEnterTimestamp', '-p', 'NRestarts', '-p', 'MemoryCurrent'], { timeout: 4000 });
      const v = Object.fromEntries(stdout.trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
      const mem = Number(v.MemoryCurrent);
      return {
        unit, label, state: v.ActiveState || 'unknown',
        since: v.ActiveEnterTimestamp ? new Date(v.ActiveEnterTimestamp.replace(/ [A-Z]+$/, '')).toISOString() : null,
        restarts: v.NRestarts ? Number(v.NRestarts) : null,
        memoryMb: Number.isFinite(mem) && mem < 2 ** 50 ? Math.round(mem / 1048576) : null,
      };
    } catch {
      return { unit, label, state: 'unknown', since: null, restarts: null, memoryMb: null };
    }
  }));
}

/**
 * Crashes: each time the system had to restart a Arscio service by itself.
 * (Needs the "arscio" user to be in the systemd-journal group; the setup script does that.)
 */
export async function crashes(days = 30): Promise<{ at: string; unit: string; text: string }[]> {
  try {
    const { stdout } = await run('journalctl', ['-u', 'arscio-api', '-u', 'arscio-web', '--since', `${days} days ago`, '-o', 'short-iso', '--no-pager',
      '-g', 'Main process exited|Failed with result|Scheduled restart|out of memory|Killed process'], { timeout: 6000, maxBuffer: 2 * 1024 * 1024 });
    return stdout.trim().split('\n').filter((l) => l && !l.startsWith('--')).slice(-50).reverse().map((l) => {
      const m = l.match(/^(\S+)\s+\S+\s+([^[:]+)(?:\[\d+\])?:\s*(.*)$/);
      return { at: m?.[1] ?? '', unit: (m?.[2] ?? '').replace(/^systemd$/, 'system'), text: (m?.[3] ?? l).slice(0, 300) };
    });
  } catch {
    return [];
  }
}

/** Recent error lines the services printed (beyond the 500 errors kept in the database). */
export async function logErrors(): Promise<{ at: string; text: string }[]> {
  try {
    const { stdout } = await run('journalctl', ['-u', 'arscio-api', '-u', 'arscio-web', '-p', 'err', '--since', '7 days ago', '-n', '40', '-o', 'short-iso', '--no-pager'],
      { timeout: 6000, maxBuffer: 2 * 1024 * 1024 });
    return stdout.trim().split('\n').filter((l) => l && !l.startsWith('--')).reverse()
      .map((l) => ({ at: l.split(' ')[0] ?? '', text: l.split(' ').slice(2).join(' ').slice(0, 400) }));
  } catch {
    return [];
  }
}

export async function machine() {
  let memTotal = os.totalmem(), memAvail = os.freemem(), swapTotal = 0, swapFree = 0;
  try {
    const mi = await readFile('/proc/meminfo', 'utf8');
    const kb = (k: string) => Number(mi.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? 0) * 1024;
    memTotal = kb('MemTotal'); memAvail = kb('MemAvailable'); swapTotal = kb('SwapTotal'); swapFree = kb('SwapFree');
  } catch { /* not Linux */ }
  let disk = { totalGb: 0, freeGb: 0, usedPct: 0 };
  try {
    const s = await statfs('/');
    const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
    disk = { totalGb: round1(total / 1e9), freeGb: round1(free / 1e9), usedPct: total ? Math.round(((total - free) / total) * 100) : 0 };
  } catch { /* unknown */ }
  return {
    hostname: os.hostname(),
    upSince: new Date(Date.now() - os.uptime() * 1000).toISOString(),
    load: os.loadavg().map((x) => round1(x)), cpus: os.cpus().length,
    memory: { totalMb: Math.round(memTotal / 1048576), availableMb: Math.round(memAvail / 1048576) },
    swap: { totalMb: Math.round(swapTotal / 1048576), usedMb: Math.round((swapTotal - swapFree) / 1048576) },
    disk,
  };
}

export interface BackupInfo {
  folder: string; found: boolean;
  last: { at: string; ok: boolean; file: string | null; sizeMb: number | null; error: string | null } | null;
  files: { name: string; at: string; sizeMb: number }[];
}

/** Daily backups are written by arscio-backup.sh, which also writes last-backup.json. */
export async function backups(folder: string): Promise<BackupInfo> {
  try {
    const names = await readdir(folder);
    const files = (await Promise.all(names.filter((n) => /\.(dump|tar\.gz)$/.test(n)).map(async (n) => {
      const s = await stat(path.join(folder, n));
      return { name: n, at: s.mtime.toISOString(), sizeMb: round1(s.size / 1048576) };
    }))).sort((a, b) => b.at.localeCompare(a.at));
    let last: BackupInfo['last'] = null;
    try { last = JSON.parse(await readFile(path.join(folder, 'last-backup.json'), 'utf8')); } catch { /* none yet */ }
    return { folder, found: true, last, files: files.slice(0, 30) };
  } catch {
    return { folder, found: false, last: null, files: [] };
  }
}

/** Is the Arscio server answering, and how fast? */
export async function ping(url: string) {
  const t = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return { ok: r.ok, ms: Date.now() - t, status: r.status };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, status: 0, error: (e as Error).message };
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
