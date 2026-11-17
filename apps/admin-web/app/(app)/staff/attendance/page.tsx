'use client';
// Staff attendance, marked once a day by the office. Everyone starts as present;
// change only the few who are absent, late, on half day or on leave.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { ErrorBox, Loading, useToast } from '@/components/ui';

type Status = 'present' | 'absent' | 'late' | 'half_day' | 'leave';
interface Day {
  date: string; today: string;
  staff: { membershipId: string; name: string; designation: string | null; roles: string[]; status: Status | null; markedBy: string | null; markedAt: string | null }[];
}
const OPTIONS: { v: Status; label: string }[] = [
  { v: 'present', label: 'P' }, { v: 'absent', label: 'A' }, { v: 'late', label: 'Late' }, { v: 'half_day', label: 'Half' }, { v: 'leave', label: 'Leave' },
];
const ROLE: Record<string, string> = { owner: 'Owner', principal: 'Principal', office_admin: 'Office', accountant: 'Accounts', teacher: 'Teacher' };
const shift = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export default function StaffAttendance() {
  const toast = useToast();
  const [date, setDate] = useState<string | null>(null);
  const [d, setD] = useState<Day | null>(null);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (on: string | null) => {
    setD(null);
    const r = await api.get<Day>(`/staff-attendance${on ? `?date=${on}` : ''}`);
    setD(r); setDate(r.date);
    setMarks(Object.fromEntries(r.staff.map((s) => [s.membershipId, s.status ?? 'present'])));
  }, []);
  useEffect(() => { void load(null); }, [load]);
  if (!d || !date) return <Loading />;

  const already = d.staff.some((s) => s.status);
  const counts = OPTIONS.map((o) => ({ ...o, n: Object.values(marks).filter((m) => m === o.v).length }));
  const oldest = shift(d.today, -7);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await api.put('/staff-attendance', { date, rows: Object.entries(marks).map(([membershipId, status]) => ({ membershipId, status })) });
      toast.show('Staff attendance saved'); await load(date);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/attendance" className="small">Student attendance</Link>
          <h1 style={{ marginTop: 4 }}>Staff attendance</h1>
          <p>{new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}.
            {already ? ' Already marked; you can still change it.' : ' Everyone starts as present. Change only those who are not.'}</p>
        </div>
        <div className="row">
          <button className="btn btn-plain" disabled={date <= oldest} onClick={() => load(shift(date, -1))}>Previous day</button>
          <button className="btn btn-plain" disabled={date >= d.today} onClick={() => load(shift(date, 1))}>Next day</button>
        </div>
      </div>
      <div className="sheet">
        <table className="register">
          <thead><tr><th>#</th><th>Name</th><th>Role</th><th>Today</th></tr></thead>
          <tbody>{d.staff.map((s, i) => {
            const v = marks[s.membershipId]!;
            return (
              <tr key={s.membershipId}>
                <td className="muted">{i + 1}</td>
                <td><strong>{s.name}</strong>{s.designation ? <div className="small muted">{s.designation}</div> : null}</td>
                <td className="small">{s.roles.map((r) => ROLE[r] ?? r).join(', ')}</td>
                <td>
                  <div className="seg" role="radiogroup" aria-label={`${s.name}'s attendance`}>
                    {OPTIONS.map((o) => (
                      <button key={o.v} type="button" role="radio" aria-checked={v === o.v} data-v={o.v === 'half_day' ? 'leave' : o.v}
                        className={v === o.v ? 'on' : undefined} onClick={() => setMarks({ ...marks, [s.membershipId]: o.v })}>{o.label}</button>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
        <div className="pay-bar">
          <span className="small">{counts.filter((c) => c.n).map((c) => `${c.n} ${c.v === 'present' ? 'present' : c.v === 'half_day' ? 'half day' : c.v === 'leave' ? 'on leave' : c.v}`).join(' · ')}</span>
          <div className="row">
            <ErrorBox error={error} />
            <button className="btn btn-primary" disabled={busy || !d.staff.length} onClick={save}>{already ? 'Save changes' : 'Save staff attendance'}</button>
          </div>
        </div>
      </div>
      {toast.node}
    </>
  );
}
