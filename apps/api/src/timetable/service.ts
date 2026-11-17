// Timetable rules, in one place.
//  - Which timetable day a date is (weekly: Monday...Saturday; cycle: Day 1...Day N),
//    after one-off changes (no classes that day, or "follow Monday's timetable").
//  - Who is teaching each period that day, who is on approved leave, which periods
//    need a substitute, and which teachers are free at a given period.
import type { Tx } from '../db.js';

export const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface Settings {
  mode: 'weekly' | 'cycle'; cycleDays: number; cycleStart: string | null; workingDays: number[];
  periodsPerDay: number; attendanceMode: 'daily' | 'period';
  periodTimes: { periodNo: number; startsAt: string; endsAt: string }[];
}

export async function settings(tx: Tx): Promise<Settings> {
  const s = (await tx.query(
    `SELECT timetable_mode AS mode, cycle_days AS "cycleDays", cycle_start::text AS "cycleStart", working_days AS "workingDays",
            periods_per_day AS "periodsPerDay", attendance_mode AS "attendanceMode"
       FROM schools WHERE id = app_school_id()`)).rows[0];
  const periodTimes = (await tx.query(
    `SELECT period_no AS "periodNo", to_char(starts_at, 'HH24:MI') AS "startsAt", to_char(ends_at, 'HH24:MI') AS "endsAt"
       FROM period_times ORDER BY period_no`)).rows;
  return { ...s, periodTimes };
}

/** The days a class timetable has: Monday..Saturday, or Day 1..Day N. */
export function dayList(s: Settings) {
  return s.mode === 'weekly'
    ? [...s.workingDays].sort().map((d) => ({ dayNo: d, label: WEEKDAYS[d]! }))
    : Array.from({ length: s.cycleDays }, (_, i) => ({ dayNo: i + 1, label: `Day ${i + 1}` }));
}

const isoWeekday = (d: string) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w === 0 ? 7 : w; };
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export interface DayInfo { date: string; dayNo: number | null; label: string; noClasses: boolean; note: string | null }

/** Which timetable day this date follows (null = no classes). */
export async function dayFor(tx: Tx, s: Settings, date: string): Promise<DayInfo> {
  const o = (await tx.query<{ no_classes: boolean; follows_day: number | null; note: string | null }>(
    'SELECT no_classes, follows_day, note FROM timetable_days WHERE on_date = $1', [date])).rows[0];
  const name = (n: number) => (s.mode === 'weekly' ? WEEKDAYS[n]! : `Day ${n}`);
  if (o?.no_classes) return { date, dayNo: null, label: 'No classes', noClasses: true, note: o.note };
  if (o?.follows_day) return { date, dayNo: o.follows_day, label: `${name(o.follows_day)} timetable`, noClasses: false, note: o.note };
  if (!s.workingDays.includes(isoWeekday(date))) return { date, dayNo: null, label: 'Holiday', noClasses: true, note: null };
  if (s.mode === 'weekly') return { date, dayNo: isoWeekday(date), label: WEEKDAYS[isoWeekday(date)]!, noClasses: false, note: null };
  if (!s.cycleStart || date < s.cycleStart) return { date, dayNo: null, label: 'Day 1 date not set', noClasses: false, note: null };
  // Count working days from Day 1 up to this date, skipping weekly holidays and no-class days.
  const off = new Set((await tx.query<{ d: string }>(
    'SELECT on_date::text AS d FROM timetable_days WHERE no_classes AND on_date >= $1 AND on_date < $2', [s.cycleStart, date])).rows.map((r) => r.d));
  let n = 0;
  for (let d = s.cycleStart; d < date; d = addDays(d, 1)) if (s.workingDays.includes(isoWeekday(d)) && !off.has(d)) n++;
  const dayNo = (n % s.cycleDays) + 1;
  return { date, dayNo, label: `Day ${dayNo}`, noClasses: false, note: null };
}

export interface Leave { id: string; membershipId: string; part: string; periods: number[] }

/** Does this approved leave cover this period? */
export function leaveCovers(l: Leave, periodNo: number, periodsPerDay: number) {
  const half = Math.ceil(periodsPerDay / 2);
  if (l.part === 'full') return true;
  if (l.part === 'first_half') return periodNo <= half;
  if (l.part === 'second_half') return periodNo > half;
  return l.periods.includes(periodNo);
}

export async function approvedLeaves(tx: Tx, date: string): Promise<Leave[]> {
  return (await tx.query(
    `SELECT id, membership_id AS "membershipId", part, periods FROM teacher_leaves
      WHERE status = 'approved' AND $1::date BETWEEN from_date AND to_date`, [date])).rows;
}

export interface Period {
  slotId: string; sectionId: string; classLabel: string; periodNo: number;
  subjectId: string | null; subject: string | null;
  teacher: { membershipId: string; name: string } | null;
  onLeave: boolean;
  substitute: { id: string; membershipId: string; name: string } | null;
}

/** Every timetabled period on this date, with leave and substitutes worked in. */
export async function scheduleFor(tx: Tx, s: Settings, day: DayInfo): Promise<Period[]> {
  if (!day.dayNo) return [];
  const rows = (await tx.query(
    `SELECT t.id AS "slotId", t.section_id AS "sectionId",
            CASE WHEN c.name ~ '^[0-9]+$' THEN 'Class ' || c.name ELSE c.name END || ' ' || sec.name AS "classLabel",
            t.period_no AS "periodNo", t.subject_id AS "subjectId", sub.name AS subject,
            t.membership_id AS "teacherId", m.display_name AS "teacherName",
            sb.id AS "subId", sb.substitute_membership AS "subMembership", sm.display_name AS "subName"
       FROM timetable_slots t
       JOIN academic_years y ON y.id = t.academic_year_id AND y.is_current
       JOIN sections sec ON sec.id = t.section_id
       JOIN classes c ON c.id = sec.class_id
       LEFT JOIN subjects sub ON sub.id = t.subject_id
       LEFT JOIN memberships m ON m.id = t.membership_id
       LEFT JOIN substitutions sb ON sb.section_id = t.section_id AND sb.on_date = $2 AND sb.period_no = t.period_no
       LEFT JOIN memberships sm ON sm.id = sb.substitute_membership
      WHERE t.day_no = $1 AND t.period_no <= $3
      ORDER BY t.period_no, c.sort_order, sec.name`, [day.dayNo, day.date, s.periodsPerDay])).rows;
  const leaves = await approvedLeaves(tx, day.date);
  return rows.map((r) => ({
    slotId: r.slotId, sectionId: r.sectionId, classLabel: r.classLabel, periodNo: r.periodNo,
    subjectId: r.subjectId, subject: r.subject,
    teacher: r.teacherId ? { membershipId: r.teacherId, name: r.teacherName } : null,
    onLeave: !!r.teacherId && leaves.some((l) => l.membershipId === r.teacherId && leaveCovers(l, r.periodNo, s.periodsPerDay)),
    substitute: r.subId ? { id: r.subId, membershipId: r.subMembership, name: r.subName } : null,
  }));
}

/** Teachers who are free at this period: not teaching, not covering, not on leave. Least busy first. */
export async function freeTeachers(tx: Tx, s: Settings, date: string, periodNo: number, schedule: Period[]) {
  const teachers = (await tx.query<{ membershipId: string; name: string }>(
    `SELECT DISTINCT m.id AS "membershipId", m.display_name AS name
       FROM memberships m JOIN membership_roles r ON r.membership_id = m.id AND r.role = 'teacher'
      WHERE m.status = 'active' AND m.school_id = app_school_id()`)).rows;
  const leaves = await approvedLeaves(tx, date);
  const busyAt = new Set<string>();
  const load = new Map<string, number>();
  for (const p of schedule) {
    const teaching = p.teacher && !p.onLeave ? p.teacher.membershipId : null;
    for (const id of [teaching, p.substitute?.membershipId].filter(Boolean) as string[]) {
      load.set(id, (load.get(id) ?? 0) + 1);
      if (p.periodNo === periodNo) busyAt.add(id);
    }
  }
  return teachers
    .filter((t) => !busyAt.has(t.membershipId))
    .filter((t) => !leaves.some((l) => l.membershipId === t.membershipId && leaveCovers(l, periodNo, s.periodsPerDay)))
    .map((t) => ({ ...t, periodsToday: load.get(t.membershipId) ?? 0 }))
    .sort((a, b) => a.periodsToday - b.periodsToday || a.name.localeCompare(b.name));
}
