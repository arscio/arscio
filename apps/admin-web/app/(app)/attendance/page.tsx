'use client';
// Attendance for the whole school on one day: which classes are done,
// the numbers, and the list of absent children with a phone number to call.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { classLabel, sectionLabel, showPhone } from '@/lib/types';
import { useSchool } from '@/components/AppShell';
import { ErrorBox, Loading, Panel, useToast } from '@/components/ui';

interface DayReport {
  date: string; today: string;
  totals: { students: number; present: number; absent: number; leave: number; sectionsTaken: number; sections: number };
  sections: {
    sectionId: string; className: string; sectionName: string; classTeacher: string | null; students: number;
    taken: boolean; takenAt: string | null; takenBy: string | null; periodsTaken: number;
    present: number; absent: number; leave: number;
  }[];
  absentees: {
    id: string; firstName: string; lastName: string | null; rollNo: number | null; className: string; sectionName: string;
    note: string | null; phone: string; parentName: string | null; absentLast30: number;
  }[];
}

const niceDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const time = (t: string) => new Date(t).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const shiftDate = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export default function AttendancePage() {
  const { info } = useSchool();
  const [date, setDate] = useState<string | null>(null);
  const [r, setR] = useState<DayReport | null>(null);
  const [open, setOpen] = useState<DayReport['sections'][number] | null>(null);
  const toast = useToast();

  const load = useCallback(async (d: string | null) => {
    setR(await api.get<DayReport>(`/attendance/day${d ? `?date=${d}` : ''}`));
  }, []);
  useEffect(() => { void load(date); }, [date, load]);

  if (!r) return <Loading />;
  const t = r.totals;
  const notTaken = r.sections.filter((s) => !s.taken && s.students > 0);
  const marked = t.present + t.absent + t.leave;
  const pct = marked ? Math.round((t.present / marked) * 1000) / 10 : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Attendance</h1>
          <p>{niceDate(r.date)}. {info.school.attendance_mode === 'period'
            ? 'Taken every period; the first period marked counts as the day’s attendance.' : 'Taken once a day by the class teacher.'}</p>
        </div>
        <div className="row">
          <button className="btn btn-plain" aria-label="Previous day" onClick={() => setDate(shiftDate(r.date, -1))}>Previous day</button>
          <input className="input" type="date" style={{ width: 170 }} aria-label="Date" max={r.today} value={r.date}
            onChange={(e) => e.target.value && setDate(e.target.value)} />
          {r.date !== r.today ? <button className="btn btn-plain" onClick={() => setDate(null)}>Today</button> : null}
          <Link className="btn btn-plain" href="/attendance/register">Monthly register</Link>
        </div>
      </div>

      <div className="sheet sheet-pad" style={{ marginBottom: 16 }}>
        {marked === 0 ? (
          <p className="muted">No attendance has been taken {r.date === r.today ? 'yet today' : 'on this day'}.</p>
        ) : (
          <div className="stats">
            <div><span className="stat-num num">{pct}%</span><span className="muted">present</span></div>
            <div><span className="stat-num num">{t.present}</span><span className="muted">present</span></div>
            <div><span className="stat-num num" style={{ color: 'var(--red-ink)' }}>{t.absent}</span><span className="muted">absent</span></div>
            <div><span className="stat-num num">{t.leave}</span><span className="muted">on leave</span></div>
            <div><span className="stat-num num">{t.sectionsTaken}/{t.sections}</span><span className="muted">classes done</span></div>
          </div>
        )}
      </div>

      {notTaken.length > 0 && r.date === r.today ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          <strong>Not taken yet:</strong> {notTaken.map((s) => `${sectionLabel(s.className, s.sectionName)}`).join(', ')}.
        </div>
      ) : null}

      <div className="sheet table-wrap" style={{ marginBottom: 26 }}>
        {r.sections.length === 0 ? <div className="empty"><h3>No sections yet</h3><p>Add sections on the Classes page.</p></div> : (
          <table className="register">
            <thead><tr><th>Class</th><th>Class teacher</th><th>Taken by</th><th>Present</th><th>Absent</th><th>Leave</th><th></th></tr></thead>
            <tbody>{r.sections.map((s) => (
              <tr key={s.sectionId}>
                <td><strong>{sectionLabel(s.className, s.sectionName)}</strong><div className="small muted num">{s.students} {s.students === 1 ? 'student' : 'students'}</div></td>
                <td className="small">{s.classTeacher ?? <span className="muted">Not chosen</span>}</td>
                <td className="small">
                  {s.taken ? <>{s.takenBy}<div className="muted">{time(s.takenAt!)}{s.periodsTaken > 1 ? `, ${s.periodsTaken} periods` : ''}</div></>
                    : s.students === 0 ? <span className="muted">No students</span> : <span className="tag tag-warn">Not taken</span>}
                </td>
                <td className="num">{s.taken ? s.present : '-'}</td>
                <td className="num" style={s.absent ? { color: 'var(--red-ink)', fontWeight: 700 } : undefined}>{s.taken ? s.absent : '-'}</td>
                <td className="num">{s.taken ? s.leave : '-'}</td>
                <td className="actions">{s.students > 0 ? <button className="btn btn-plain" onClick={() => setOpen(s)}>{s.taken ? 'Open' : 'Mark'}</button> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <h2 style={{ marginBottom: 6 }}>Absent {r.date === r.today ? 'today' : 'on this day'}</h2>
      <p className="muted small" style={{ marginBottom: 12 }}>Parents have been told in the app. Call those who are absent often.</p>
      <div className="sheet table-wrap">
        {r.absentees.length === 0 ? <div className="empty"><p>No one is marked absent.</p></div> : (
          <table className="register">
            <thead><tr><th>Roll</th><th>Name</th><th>Class</th><th>Parent</th><th>Phone</th><th>Absent in last 30 days</th></tr></thead>
            <tbody>{r.absentees.map((a) => (
              <tr key={a.id}>
                <td className="num muted">{a.rollNo ?? '-'}</td>
                <td><Link href={`/students/${a.id}`} style={{ color: 'inherit', fontWeight: 700, textDecoration: 'none' }}>{a.firstName} {a.lastName ?? ''}</Link>
                  {a.note ? <div className="small muted">{a.note}</div> : null}</td>
                <td>{sectionLabel(a.className, a.sectionName)}</td>
                <td className="small">{a.parentName ?? '-'}</td>
                <td className="num nowrap"><a href={`tel:${a.phone}`}>{showPhone(a.phone)}</a></td>
                <td>{a.absentLast30 >= 3 ? <span className="tag tag-warn">{a.absentLast30} days</span> : <span className="num">{a.absentLast30} {a.absentLast30 === 1 ? 'day' : 'days'}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <Panel open={!!open} title={open ? `${sectionLabel(open.className, open.sectionName)}` : ''} onClose={() => setOpen(null)}>
        {open ? <RegisterEditor key={`${open.sectionId}${r.date}`} sectionId={open.sectionId} date={r.date}
          onSaved={async (msg) => { setOpen(null); await load(date); toast.show(msg); }} /> : null}
      </Panel>
      {toast.node}
    </>
  );
}

type Status = 'present' | 'absent' | 'late' | 'leave' | 'half_day';
interface Sheet {
  session: { takenAt: string; takenBy: string } | null;
  students: { id: string; firstName: string; lastName: string | null; rollNo: number | null; status: Status | null }[];
}
const OPTIONS: [Status, string][] = [['present', 'P'], ['absent', 'A'], ['late', 'Late'], ['leave', 'Leave']];

function RegisterEditor({ sectionId, date, onSaved }: { sectionId: string; date: string; onSaved: (msg: string) => Promise<void> }) {
  const { info } = useSchool();
  const periodMode = info.school.attendance_mode === 'period';
  const [period, setPeriod] = useState(periodMode ? 1 : 0);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSheet(null);
    api.get<Sheet>(`/attendance/sheet?sectionId=${sectionId}&date=${date}&period=${period}`).then((s) => {
      setSheet(s);
      setMarks(Object.fromEntries(s.students.filter((x) => x.status).map((x) => [x.id, x.status!])));
    });
  }, [sectionId, date, period]);

  if (!sheet) return <Loading />;
  const unmarked = sheet.students.filter((s) => !marks[s.id]).length;
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.put('/attendance/sheet', { sectionId, date, period, marks: sheet.students.map((s) => ({ studentId: s.id, status: marks[s.id] })) });
      await onSaved('Attendance saved');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <div className="stack">
      {periodMode ? (
        <div className="row"><span className="label" style={{ fontWeight: 700 }}>Period</span>
          <select className="input" style={{ width: 100 }} value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
            {Array.from({ length: info.school.periods_per_day }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </select></div>
      ) : null}
      <p className="small muted">{sheet.session ? `Taken by ${sheet.session.takenBy} at ${time(sheet.session.takenAt)}. Changes you save will show your name.` : 'Not taken yet.'}</p>
      <div className="row">
        <button className="btn btn-plain" disabled={unmarked === 0}
          onClick={() => setMarks({ ...Object.fromEntries(sheet.students.map((s) => [s.id, 'present' as Status])), ...marks })}>
          {unmarked === sheet.students.length ? 'Everyone present' : 'Mark the rest present'}</button>
      </div>
      <table className="register" style={{ border: '1px solid var(--rule)' }}>
        <tbody>{sheet.students.map((s) => (
          <tr key={s.id} style={marks[s.id] === 'absent' ? { background: 'var(--red-wash)' } : undefined}>
            <td className="num muted">{s.rollNo ?? '-'}</td>
            <td><strong>{s.firstName} {s.lastName ?? ''}</strong></td>
            <td className="actions">
              <div className="seg" role="radiogroup" aria-label={`${s.firstName}'s attendance`}>
                {OPTIONS.map(([v, label]) => (
                  <button key={v} role="radio" aria-checked={marks[s.id] === v} data-v={v}
                    className={marks[s.id] === v ? 'on' : ''} onClick={() => setMarks({ ...marks, [s.id]: v })}>{label}</button>
                ))}
              </div>
            </td>
          </tr>
        ))}</tbody>
      </table>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">{unmarked ? `${unmarked} not marked` : 'Everyone is marked'}</span>
        <button className="btn btn-primary" disabled={busy || unmarked > 0} onClick={save}>Save attendance</button>
      </div>
    </div>
  );
}
