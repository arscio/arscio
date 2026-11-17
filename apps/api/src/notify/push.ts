// Sends queued messages to people's phones as notifications, through Expo's push
// service (it delivers to both Android and iPhone). Runs every few seconds.
//
// It works across all schools, so it uses the platform (owner) connection.
// Rules:
//  - a message goes to every phone the person is logged in on
//  - "Absent today" is skipped if the teacher has since corrected the child to present
//  - phones that have uninstalled the app are forgotten
//  - SMS is NOT used here (kept to a minimum, as decided)
import type pg from 'pg';
import { heartbeat } from '../control/heartbeat.js';

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface Queued { id: string; account_id: string; title: string; body: string; data: Record<string, string>; school_id: string }

export async function sendQueuedPushes(owner: pg.Pool, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
  const queued = (await owner.query<Queued>(
    `SELECT id, account_id, title, body, data, school_id FROM notifications
      WHERE status = 'queued' AND channel = 'push' ORDER BY created_at LIMIT 500`)).rows;
  if (!queued.length) return { sent: 0, skipped: 0, failed: 0 };

  let skipped = 0;
  const live: Queued[] = [];
  for (const n of queued) {
    if (n.data.kind === 'absent') {
      // Corrected to present since? Then don't alarm the parent.
      const still = (await owner.query(
        `SELECT 1 FROM attendance_sessions a JOIN attendance_marks k ON k.session_id = a.id
          WHERE k.student_id = $1 AND a.on_date = $2::date AND k.status = 'absent' LIMIT 1`,
        [n.data.studentId, n.data.date])).rowCount;
      if (!still) {
        await owner.query("UPDATE notifications SET status = 'failed', push_error = 'corrected_before_sending' WHERE id = $1", [n.id]);
        skipped++;
        continue;
      }
    }
    live.push(n);
  }

  const devices = (await owner.query<{ account_id: string; push_token: string }>(
    'SELECT account_id, push_token FROM push_devices WHERE account_id = ANY($1::uuid[])',
    [[...new Set(live.map((n) => n.account_id))]])).rows;
  const byAccount = new Map<string, string[]>();
  for (const d of devices) byAccount.set(d.account_id, [...(byAccount.get(d.account_id) ?? []), d.push_token]);

  const messages: { notificationId: string; to: string; title: string; body: string; data: Record<string, string> }[] = [];
  for (const n of live) {
    const tokens = byAccount.get(n.account_id) ?? [];
    if (!tokens.length) {
      await owner.query("UPDATE notifications SET status = 'failed', push_error = 'no_device' WHERE id = $1", [n.id]);
      continue;
    }
    for (const to of tokens) {
      messages.push({ notificationId: n.id, to, title: n.title, body: n.body.slice(0, 180), data: { ...n.data, messageId: n.id, schoolId: n.school_id } });
    }
  }

  const delivered = new Set<string>();
  const errors = new Map<string, string>();
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      const res = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(batch.map(({ to, title, body, data }) => ({ to, title, body, data, sound: 'default', priority: 'high' }))),
      });
      const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      (json.data ?? []).forEach((ticket, j) => {
        const m = batch[j]!;
        if (ticket.status === 'ok') delivered.add(m.notificationId);
        else {
          errors.set(m.notificationId, ticket.details?.error ?? 'error');
          if (ticket.details?.error === 'DeviceNotRegistered') {
            void owner.query('DELETE FROM push_devices WHERE push_token = $1', [m.to]);
          }
        }
      });
    } catch (e) {
      for (const m of batch) errors.set(m.notificationId, `network: ${(e as Error).message}`.slice(0, 200));
    }
  }

  for (const id of delivered) await owner.query("UPDATE notifications SET status = 'sent', sent_at = now() WHERE id = $1", [id]);
  for (const [id, err] of errors) {
    if (!delivered.has(id)) await owner.query("UPDATE notifications SET status = 'failed', push_error = $2 WHERE id = $1", [id, err]);
  }
  return { sent: delivered.size, skipped, failed: [...errors.keys()].filter((id) => !delivered.has(id)).length };
}

/** Start sending every few seconds. */
export function startPushWorker(owner: pg.Pool, everyMs = 5000, log: (m: string) => void = console.log) {
  let running = false;
  let lastBeat = 0;
  const t = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await sendQueuedPushes(owner);
      if (r.sent || r.failed) log(`push: ${r.sent} sent, ${r.failed} failed, ${r.skipped} skipped`);
      // Recorded about once a minute (not every 5 seconds) unless something was sent
      if (r.sent || r.failed || Date.now() - lastBeat > 60_000) { lastBeat = Date.now(); await heartbeat(owner, 'push', true, r); }
    } catch (e) {
      log(`push worker error: ${(e as Error).message}`);
      await heartbeat(owner, 'push', false, undefined, (e as Error).message);
    }
    finally { running = false; }
  }, everyMs);
  return () => clearInterval(t);
}
