// Results day, by itself: a few times an hour the server looks for classes whose result
// date has come. For each, it makes any marksheets not made yet and tells every family
// whose marksheet is ready (once). Students waiting for the principal's confirmation
// are told when the principal confirms.
import type pg from 'pg';
import { withContext, type Db } from '../db.js';
import { loadSettings } from './marksheet.js';
import { generateForClass } from '../routes/results.js';
import { notifyFamily } from '../exams/workflow.js';
import { heartbeat } from '../control/heartbeat.js';

export async function runResultsDay(owner: pg.Pool, db: Db, today: string) {
  const due = (await owner.query<{ school_id: string; academic_year_id: string; class_id: string }>(
    `SELECT school_id, academic_year_id, class_id FROM result_settings
      WHERE result_date IS NOT NULL AND result_date <= $1 AND announced_at IS NULL`, [today])).rows;
  let told = 0;
  for (const d of due) {
    told += await withContext(db, { schoolId: d.school_id }, async (tx) => {
      const settings = await loadSettings(tx, d.academic_year_id, d.class_id);
      if (!settings) return 0;
      await generateForClass(tx, d.school_id, d.academic_year_id, d.class_id, settings);
      const ready = (await tx.query<{ student_id: string; name: string }>(
        `SELECT student_id, data->'student'->>'name' AS name FROM marksheets
          WHERE academic_year_id = $1 AND class_id = $2 AND NOT held`, [d.academic_year_id, d.class_id])).rows;
      for (const r of ready) {
        await notifyFamily(tx, r.student_id, 'Results are out', `${r.name.split(' ')[0]}'s marksheet is ready in the app.`, { kind: 'marksheet' });
      }
      await tx.query('UPDATE result_settings SET announced_at = now() WHERE academic_year_id = $1 AND class_id = $2', [d.academic_year_id, d.class_id]);
      return ready.length;
    });
  }
  return { classes: due.length, told };
}

export function startResultsDayJob(owner: pg.Pool, db: Db, everyMs: number, log: (m: string) => void) {
  const tick = async () => {
    try {
      const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      const r = await runResultsDay(owner, db, today);
      if (r.classes) log(`Results day: ${r.classes} classes, ${r.told} families told`);
      await heartbeat(owner, 'results_day', true, r);
    } catch (e) {
      log(`Results day job failed: ${(e as Error).message}`);
      await heartbeat(owner, 'results_day', false, undefined, (e as Error).message);
    }
  };
  void tick();
  const t = setInterval(tick, everyMs);
  return () => clearInterval(t);
}
