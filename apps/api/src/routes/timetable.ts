// Timetable, teacher leave and substitute cover.
//  - Principal/owner ("timetable.manage"): sets up the timetable (weekly or Day 1..N),
//    bell times, and one-off day changes.
//  - Teachers ("leave.apply"): apply for leave in the teacher app; cancel their own.
//  - Principal/owner ("leave.approve"): approve or reject leave, see the periods that
//    need cover and assign a free teacher. Everyone involved gets an app message.
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Db, Tx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { can, must, schoolTx } from '../context.js';
import { todayIST } from './attendance.js';
import { WEEKDAYS, dayFor, dayList, freeTeachers, scheduleFor, settings } from '../timetable/service.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^\d{2}:\d{2}$/);
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const nice = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const PART: Record<string, string> = { full: 'full day', first_half: 'first half', second_half: 'second half', periods: 'some periods' };

async function notify(tx: Tx, req: FastifyRequest, accountIds: string[], title: string, body: string, data: object) {
  for (const a of [...new Set(accountIds)]) {
    await tx.query(
      `INSERT INTO notifications (school_id, account_id, channel, title, body, data) VALUES ($1, $2, 'push', $3, $4, $5)`,
      [req.school!.schoolId, a, title, body, JSON.stringify(data)]);
  }
}
async function leaders(tx: Tx) {
  return (await tx.query<{ account_id: string }>(
    `SELECT DISTINCT m.account_id FROM memberships m JOIN membership_roles r ON r.membership_id = m.id
      WHERE r.role IN ('owner', 'principal') AND m.status = 'active' AND m.school_id = app_school_id()`)).rows.map((r) => r.account_id);
}
const accountOf = async (tx: Tx, membershipId: string) =>
  (await tx.query<{ account_id: string; display_name: string }>('SELECT account_id, display_name FROM memberships WHERE id = $1', [membershipId])).rows[0];

export function registerTimetableRoutes(app: FastifyInstance, db: Db, requireSchool: preHandlerHookHandler) {
  const pre = { preHandler: requireSchool };

  // ---------------- Timetable setup ----------------

  app.get('/timetable/settings', pre, async (req) => {
    if (!can(req, 'timetable.manage') && !can(req, 'leave.approve')) throw forbidden();
    return schoolTx(db, req, async (tx) => {
      const s = await settings(tx);
      const days = (await tx.query(
        `SELECT on_date::text AS date, no_classes AS "noClasses", follows_day AS "followsDay", note
           FROM timetable_days WHERE on_date >= $1 ORDER BY on_date LIMIT 60`, [addDays(todayIST(), -7)])).rows;
      return { ...s, days: dayList(s), changes: days, today: await dayFor(tx, s, todayIST()) };
    });
  });

  app.put('/timetable/settings', pre, async (req) => {
    must(req, 'timetable.manage');
    const b = z.object({
      mode: z.enum(['weekly', 'cycle']),
      cycleDays: z.number().int().min(2).max(10),
      cycleStart: date.nullable(),
      workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
      periodsPerDay: z.number().int().min(1).max(15),
      periodTimes: z.array(z.object({ periodNo: z.number().int().min(1).max(15), startsAt: time, endsAt: time })).max(15),
    }).parse(req.body);
    if (b.mode === 'cycle' && !b.cycleStart) throw badRequest('no_start', 'Choose the date that was Day 1');
    for (const p of b.periodTimes) if (p.endsAt <= p.startsAt) throw badRequest('bad_time', `Period ${p.periodNo} ends before it starts`);
    return schoolTx(db, req, async (tx) => {
      await tx.query(
        `UPDATE schools SET timetable_mode = $1, cycle_days = $2, cycle_start = $3, working_days = $4, periods_per_day = $5 WHERE id = app_school_id()`,
        [b.mode, b.cycleDays, b.cycleStart, [...new Set(b.workingDays)].sort(), b.periodsPerDay]);
      await tx.query('DELETE FROM period_times');
      for (const p of b.periodTimes.filter((x) => x.periodNo <= b.periodsPerDay)) {
        await tx.query('INSERT INTO period_times (school_id, period_no, starts_at, ends_at) VALUES ($1, $2, $3, $4)',
          [req.school!.schoolId, p.periodNo, p.startsAt, p.endsAt]);
      }
      return { ok: true };
    });
  });

  /** One class's timetable, with what each teacher is already teaching elsewhere. */
  app.get('/timetable/sections/:id', pre, async (req) => {
    if (!can(req, 'timetable.manage') && !can(req, 'leave.approve')) throw forbidden();
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const s = await settings(tx);
      const sec = (await tx.query(
        `SELECT s.id, s.class_id AS "classId", CASE WHEN c.name ~ '^[0-9]+$' THEN 'Class ' || c.name ELSE c.name END || ' ' || s.name AS label
           FROM sections s JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [id])).rows[0];
      if (!sec) throw notFound('Class not found');
      const slots = (await tx.query(
        `SELECT t.day_no AS "dayNo", t.period_no AS "periodNo", t.subject_id AS "subjectId", sub.name AS subject,
                t.membership_id AS "membershipId", m.display_name AS teacher
           FROM timetable_slots t LEFT JOIN subjects sub ON sub.id = t.subject_id LEFT JOIN memberships m ON m.id = t.membership_id
          WHERE t.section_id = $1`, [id])).rows;
      const subjects = (await tx.query(
        `SELECT sub.id, sub.name FROM class_subjects cs JOIN subjects sub ON sub.id = cs.subject_id WHERE cs.class_id = $1 ORDER BY cs.sort_order`,
        [sec.classId])).rows;
      const teachers = (await tx.query(
        `SELECT DISTINCT m.id AS "membershipId", m.display_name AS name,
                EXISTS (SELECT 1 FROM section_teachers st WHERE st.section_id = $1 AND st.membership_id = m.id) OR
                EXISTS (SELECT 1 FROM sections x WHERE x.id = $1 AND x.class_teacher_membership = m.id) AS "teachesHere"
           FROM memberships m JOIN membership_roles r ON r.membership_id = m.id AND r.role = 'teacher'
          WHERE m.status = 'active' AND m.school_id = app_school_id() ORDER BY 3 DESC, 2`, [id])).rows;
      const busy = (await tx.query(
        `SELECT t.membership_id AS "membershipId", t.day_no AS "dayNo", t.period_no AS "periodNo",
                CASE WHEN c.name ~ '^[0-9]+$' THEN 'Class ' || c.name ELSE c.name END || ' ' || x.name AS label
           FROM timetable_slots t JOIN sections x ON x.id = t.section_id JOIN classes c ON c.id = x.class_id
           JOIN academic_years y ON y.id = t.academic_year_id AND y.is_current
          WHERE t.section_id <> $1 AND t.membership_id IS NOT NULL`, [id])).rows;
      return { section: { id: sec.id, label: sec.label }, days: dayList(s), periodsPerDay: s.periodsPerDay, periodTimes: s.periodTimes, slots, subjects, teachers, busy };
    });
  });

  /** Set (or clear) one cell of a class timetable. */
  app.put('/timetable/slot', pre, async (req) => {
    must(req, 'timetable.manage');
    const b = z.object({
      sectionId: uuid, dayNo: z.number().int().min(1).max(10), periodNo: z.number().int().min(1).max(15),
      subjectId: uuid.nullable(), membershipId: uuid.nullable(),
    }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const year = (await tx.query<{ id: string }>(
        'SELECT s.academic_year_id AS id FROM sections s WHERE s.id = $1', [b.sectionId])).rows[0];
      if (!year) throw notFound('Class not found');
      if (!b.subjectId && !b.membershipId) {
        await tx.query('DELETE FROM timetable_slots WHERE section_id = $1 AND day_no = $2 AND period_no = $3', [b.sectionId, b.dayNo, b.periodNo]);
        return { ok: true };
      }
      if (b.membershipId) {
        const clash = (await tx.query<{ label: string; name: string }>(
          `SELECT CASE WHEN c.name ~ '^[0-9]+$' THEN 'Class ' || c.name ELSE c.name END || ' ' || x.name AS label, m.display_name AS name
             FROM timetable_slots t JOIN sections x ON x.id = t.section_id JOIN classes c ON c.id = x.class_id
             JOIN memberships m ON m.id = t.membership_id
            WHERE t.academic_year_id = $1 AND t.day_no = $2 AND t.period_no = $3 AND t.membership_id = $4 AND t.section_id <> $5`,
          [year.id, b.dayNo, b.periodNo, b.membershipId, b.sectionId])).rows[0];
        if (clash) throw badRequest('clash', `${clash.name} is already teaching ${clash.label} in that period`);
      }
      await tx.query(
        `INSERT INTO timetable_slots (school_id, academic_year_id, section_id, day_no, period_no, subject_id, membership_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (section_id, day_no, period_no) DO UPDATE SET subject_id = excluded.subject_id, membership_id = excluded.membership_id`,
        [req.school!.schoolId, year.id, b.sectionId, b.dayNo, b.periodNo, b.subjectId, b.membershipId]);
      return { ok: true };
    });
  });

  /** One-off change for a single date. */
  app.put('/timetable/days/:date', pre, async (req) => {
    must(req, 'timetable.manage');
    const { date: on } = z.object({ date }).parse(req.params);
    const b = z.object({ noClasses: z.boolean(), followsDay: z.number().int().min(1).max(10).nullable(), note: z.string().trim().max(120).nullable() }).parse(req.body);
    if (!b.noClasses && !b.followsDay) throw badRequest('nothing', 'Choose "no classes" or which day’s timetable to follow');
    return schoolTx(db, req, async (tx) => {
      await tx.query(
        `INSERT INTO timetable_days (school_id, on_date, no_classes, follows_day, note, created_by) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (school_id, on_date) DO UPDATE SET no_classes = excluded.no_classes, follows_day = excluded.follows_day, note = excluded.note`,
        [req.school!.schoolId, on, b.noClasses, b.noClasses ? null : b.followsDay, b.note, req.accountId]);
      return { ok: true };
    });
  });

  app.delete('/timetable/days/:date', pre, async (req) => {
    must(req, 'timetable.manage');
    const { date: on } = z.object({ date }).parse(req.params);
    return schoolTx(db, req, async (tx) => { await tx.query('DELETE FROM timetable_days WHERE on_date = $1', [on]); return { ok: true }; });
  });

  // ---------------- Teacher leave ----------------

  app.post('/leaves', pre, async (req) => {
    must(req, 'leave.apply');
    const b = z.object({
      fromDate: date, toDate: date,
      part: z.enum(['full', 'first_half', 'second_half', 'periods']).default('full'),
      periods: z.array(z.number().int().min(1).max(15)).default([]),
      reason: z.string().trim().min(3, 'Please write a short reason').max(300),
    }).parse(req.body);
    const today = todayIST();
    if (b.toDate < b.fromDate) throw badRequest('bad_range', 'The last day is before the first day');
    if (b.fromDate < addDays(today, -3)) throw badRequest('too_old', 'Leave can be applied for up to 3 days after it was taken');
    if (b.part !== 'full' && b.fromDate !== b.toDate) throw badRequest('part_range', 'Half-day and some-periods leave is for one day at a time');
    if (b.part === 'periods' && !b.periods.length) throw badRequest('no_periods', 'Choose which periods');
    return schoolTx(db, req, async (tx) => {
      const overlap = await tx.query(
        `SELECT 1 FROM teacher_leaves WHERE membership_id = $1 AND status IN ('pending', 'approved')
            AND daterange(from_date, to_date, '[]') && daterange($2::date, $3::date, '[]')`,
        [req.school!.membershipId, b.fromDate, b.toDate]);
      if (overlap.rowCount) throw badRequest('overlap', 'You already have leave for some of these days');
      const l = (await tx.query(
        `INSERT INTO teacher_leaves (school_id, membership_id, from_date, to_date, part, periods, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.school!.schoolId, req.school!.membershipId, b.fromDate, b.toDate, b.part, b.part === 'periods' ? b.periods : [], b.reason])).rows[0];
      const me = await accountOf(tx, req.school!.membershipId);
      const when = b.fromDate === b.toDate ? nice(b.fromDate) : `${nice(b.fromDate)} to ${nice(b.toDate)}`;
      await notify(tx, req, await leaders(tx), `Leave request: ${me!.display_name}`, `${when}, ${PART[b.part]}. ${b.reason}`, { kind: 'leave_request', leaveId: l.id });
      return { id: l.id, status: 'pending' };
    });
  });

  const LEAVE_SELECT = `
    SELECT l.id, l.membership_id AS "membershipId", m.display_name AS teacher, l.from_date::text AS "fromDate", l.to_date::text AS "toDate",
           l.part, l.periods, l.reason, l.status, l.decision_note AS "decisionNote", d.name AS "decidedBy", l.decided_at AS "decidedAt", l.created_at AS "createdAt"
      FROM teacher_leaves l JOIN memberships m ON m.id = l.membership_id LEFT JOIN accounts d ON d.id = l.decided_by`;

  app.get('/leaves/mine', pre, async (req) => {
    must(req, 'leave.apply');
    return schoolTx(db, req, async (tx) => ({
      leaves: (await tx.query(`${LEAVE_SELECT} WHERE l.membership_id = $1 ORDER BY l.from_date DESC LIMIT 50`, [req.school!.membershipId])).rows,
    }));
  });

  app.get('/leaves', pre, async (req) => {
    must(req, 'leave.approve');
    const { status } = z.object({ status: z.enum(['pending', 'all']).default('pending') }).parse(req.query);
    return schoolTx(db, req, async (tx) => ({
      leaves: (await tx.query(
        `${LEAVE_SELECT} WHERE ${status === 'pending' ? "l.status = 'pending'" : "l.to_date >= $1::date - 60"}
         ORDER BY (l.status = 'pending') DESC, l.from_date ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 200`,
        status === 'pending' ? [] : [todayIST()])).rows,
    }));
  });

  /** Remove substitutes that were only there because of this leave. */
  async function clearCover(tx: Tx, membershipId: string, from: string, to: string) {
    await tx.query(
      `DELETE FROM substitutions WHERE original_membership = $1 AND on_date BETWEEN $2 AND $3 AND on_date >= $4`,
      [membershipId, from, to, todayIST()]);
  }

  app.post('/leaves/:id/decide', pre, async (req) => {
    must(req, 'leave.approve');
    const { id } = z.object({ id: uuid }).parse(req.params);
    const b = z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional().nullable() }).parse(req.body);
    return schoolTx(db, req, async (tx) => {
      const l = (await tx.query<{ status: string; membership_id: string; from_date: string; to_date: string }>(
        'SELECT status, membership_id, from_date::text, to_date::text FROM teacher_leaves WHERE id = $1', [id])).rows[0];
      if (!l) throw notFound('Leave not found');
      if (l.status === 'cancelled') throw badRequest('cancelled', 'The teacher has cancelled this leave');
      const status = b.approve ? 'approved' : 'rejected';
      await tx.query('UPDATE teacher_leaves SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1',
        [id, status, req.accountId, b.note ?? null]);
      if (!b.approve) await clearCover(tx, l.membership_id, l.from_date, l.to_date);
      const t = await accountOf(tx, l.membership_id);
      const when = l.from_date === l.to_date ? nice(l.from_date) : `${nice(l.from_date)} to ${nice(l.to_date)}`;
      await notify(tx, req, [t!.account_id], b.approve ? 'Leave approved' : 'Leave not approved',
        `${when}${b.note ? `. ${b.note}` : ''}`, { kind: 'leave_decision', leaveId: id });
      return { status };
    });
  });

  app.post('/leaves/:id/cancel', pre, async (req) => {
    must(req, 'leave.apply');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const l = (await tx.query<{ status: string; membership_id: string; from_date: string; to_date: string }>(
        'SELECT status, membership_id, from_date::text, to_date::text FROM teacher_leaves WHERE id = $1', [id])).rows[0];
      if (!l || l.membership_id !== req.school!.membershipId) throw notFound('Leave not found');
      if (!['pending', 'approved'].includes(l.status)) throw badRequest('closed', 'This leave can no longer be cancelled');
      if (l.status === 'approved' && l.from_date <= todayIST()) throw badRequest('started', 'This leave has already started. Ask the principal to change it.');
      await tx.query("UPDATE teacher_leaves SET status = 'cancelled' WHERE id = $1", [id]);
      await clearCover(tx, l.membership_id, l.from_date, l.to_date);
      return { status: 'cancelled' };
    });
  });

  // ---------------- Substitute cover ----------------

  /** The day's periods that need a substitute, with the teachers free for each. */
  app.get('/cover', pre, async (req) => {
    must(req, 'leave.approve');
    const { date: on = todayIST() } = z.object({ date: date.optional() }).parse(req.query);
    return schoolTx(db, req, async (tx) => {
      const s = await settings(tx);
      const day = await dayFor(tx, s, on);
      const schedule = await scheduleFor(tx, s, day);
      const gaps = schedule.filter((p) => p.onLeave);
      const out = [];
      for (const g of gaps) {
        out.push({
          ...g,
          time: s.periodTimes.find((t) => t.periodNo === g.periodNo) ?? null,
          free: g.substitute ? [] : (await freeTeachers(tx, s, on, g.periodNo, schedule)).slice(0, 8),
        });
      }
      const away = (await tx.query(
        `SELECT m.display_name AS name, l.part, l.periods, l.reason FROM teacher_leaves l JOIN memberships m ON m.id = l.membership_id
          WHERE l.status = 'approved' AND $1::date BETWEEN l.from_date AND l.to_date ORDER BY m.display_name`, [on])).rows;
      const pending = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM teacher_leaves WHERE status = 'pending'")).rows[0]!.n;
      return { date: on, today: todayIST(), day, away, pendingLeaves: pending, gaps: out, needCover: out.filter((g) => !g.substitute).length };
    });
  });

  app.post('/cover', pre, async (req) => {
    must(req, 'leave.approve');
    const b = z.object({ date, sectionId: uuid, periodNo: z.number().int().min(1).max(15), membershipId: uuid }).parse(req.body);
    if (b.date < todayIST()) throw badRequest('past', 'You can only arrange cover for today or later');
    return schoolTx(db, req, async (tx) => {
      const s = await settings(tx);
      const schedule = await scheduleFor(tx, s, await dayFor(tx, s, b.date));
      const gap = schedule.find((p) => p.sectionId === b.sectionId && p.periodNo === b.periodNo);
      if (!gap || !gap.onLeave) throw badRequest('no_gap', 'This period doesn’t need a substitute');
      if (gap.substitute) throw badRequest('covered', `${gap.substitute.name} is already covering this period`);
      const free = await freeTeachers(tx, s, b.date, b.periodNo, schedule);
      if (!free.some((f) => f.membershipId === b.membershipId)) throw badRequest('busy', 'That teacher is not free in this period');
      const r = (await tx.query(
        `INSERT INTO substitutions (school_id, on_date, section_id, period_no, subject_id, original_membership, substitute_membership, assigned_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [req.school!.schoolId, b.date, b.sectionId, b.periodNo, gap.subjectId, gap.teacher?.membershipId ?? null, b.membershipId, req.accountId])).rows[0];
      const sub = await accountOf(tx, b.membershipId);
      const time = s.periodTimes.find((t) => t.periodNo === b.periodNo);
      await notify(tx, req, [sub!.account_id], 'You are covering a class',
        `${gap.classLabel}, period ${b.periodNo}${time ? ` (${time.startsAt})` : ''} on ${nice(b.date)}${gap.subject ? `: ${gap.subject}` : ''}.`,
        { kind: 'cover', substitutionId: r.id, sectionId: b.sectionId, date: b.date });
      return { id: r.id };
    });
  });

  app.delete('/cover/:id', pre, async (req) => {
    must(req, 'leave.approve');
    const { id } = z.object({ id: uuid }).parse(req.params);
    return schoolTx(db, req, async (tx) => {
      const r = await tx.query('DELETE FROM substitutions WHERE id = $1 RETURNING id', [id]);
      if (!r.rowCount) throw notFound('Not found');
      return { ok: true };
    });
  });
}

export { WEEKDAYS };
