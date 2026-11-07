'use client';
// The monthly attendance register for one class, like the paper register:
// every child, every school day, totals and percentage. Prints on one A4 page (landscape).
// Below 75% is highlighted: CBSE expects 75% attendance to sit board exams.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { classLabel, type Structure } from '@/lib/types';
import { useSchool } from '@/components/AppShell';
import { Loading } from '@/components/ui';

interface Register {
  section: { className: string; sectionName: string; classTeacher: string | null };
  month: string; daysInMonth: number; schoolDays: string[];
  students: {
    id: string; firstName: string; lastName: string | null; rollNo: number | null; status: string;
    marks: Record<string, string>; present: number; absent: number; leave: number; percent: number | null;
  }[];
}

const CODE: Record<string, [string, string]> = {
  present: ['P', ''], late: ['Lt', ''], half_day: ['½', ''], absent: ['A', 'a'], leave: ['L', 'l'],
};
const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function MonthlyRegister() {
  const { info } = useSchool();
  const [structure, setStructure] = useState<Structure | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [month, setMonth] = useState(thisMonth());
  const [r, setR] = useState<Register | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get<Structure>('/setup/structure').then((s) => {
      setStructure(s);
      const first = s.classes.flatMap((c) => c.sections)[0];
      if (first) setSectionId(first.id);
    });
  }, []);
  useEffect(() => {
    if (!sectionId || !month) return;
    setLoading(true);
    api.get<Register>(`/attendance/register?sectionId=${sectionId}&month=${month}`).then(setR).finally(() => setLoading(false));
  }, [sectionId, month]);

  if (!structure) return <Loading />;
  const school = new Set(r?.schoolDays.map((d) => Number(d.slice(8))) ?? []);
  const days = r ? Array.from({ length: r.daysInMonth }, (_, i) => i + 1) : [];
  const weekday = (d: number) => new Date(`${r!.month}-${String(d).padStart(2, '0')}T00:00:00Z`).getUTCDay();

  return (
    <>
      <div className="page-head no-print">
        <div><Link href="/attendance" className="small">Attendance</Link><h1 style={{ marginTop: 4 }}>Monthly register</h1></div>
        <div className="row">
          <select className="input" style={{ width: 180 }} aria-label="Class" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {structure.classes.map((c) => c.sections.length ? (
              <optgroup key={c.id} label={classLabel(c.name)}>
                {c.sections.map((s) => <option key={s.id} value={s.id}>{classLabel(c.name)} {s.name}</option>)}
              </optgroup>
            ) : null)}
          </select>
          <input className="input" type="month" style={{ width: 170 }} aria-label="Month" max={thisMonth()} value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <button className="btn btn-plain" onClick={() => window.print()} disabled={!r}>Print</button>
        </div>
      </div>

      {!sectionId ? <div className="sheet empty"><h3>No sections yet</h3><p>Add sections on the Classes page.</p></div>
        : !r || loading ? <Loading /> : (
        <div className="sheet sheet-pad print-wide">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div className="print-only"><strong>{info.school.name}</strong></div>
              <h2>{classLabel(r.section.className)} {r.section.sectionName}, {monthName(r.month)}</h2>
              <p className="small muted">Class teacher: {r.section.classTeacher ?? 'not chosen'}. {r.schoolDays.length} school {r.schoolDays.length === 1 ? 'day' : 'days'} marked.</p>
            </div>
            <p className="small muted">P present, A absent, L leave, Lt late. Grey days: no attendance taken.</p>
          </div>
          {r.students.length === 0 ? <p className="muted">No students in this class.</p> : (
            <div className="table-wrap">
              <table className="month-grid">
                <thead>
                  <tr>
                    <th>Roll</th><th className="name">Name</th>
                    {days.map((d) => <th key={d} className={school.has(d) ? '' : 'off'} title={weekday(d) === 0 ? 'Sunday' : undefined}>{d}</th>)}
                    <th>P</th><th>A</th><th>L</th><th>%</th>
                  </tr>
                </thead>
                <tbody>{r.students.map((s) => (
                  <tr key={s.id}>
                    <td>{s.rollNo ?? '-'}</td>
                    <td className="name">{s.firstName} {s.lastName ?? ''}{s.status !== 'active' ? ' (left)' : ''}</td>
                    {days.map((d) => {
                      const key = `${r.month}-${String(d).padStart(2, '0')}`;
                      const v = s.marks[key];
                      const [code, cls] = v ? CODE[v] ?? ['?', ''] : ['', ''];
                      return <td key={d} className={!school.has(d) ? 'off' : cls}>{code}</td>;
                    })}
                    <td>{s.present}</td><td>{s.absent}</td><td>{s.leave}</td>
                    <td className={s.percent !== null && s.percent < 75 ? 'low' : ''}>{s.percent ?? '-'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <p className="small muted" style={{ marginTop: 10 }}>Highlighted percentages are below 75%, the attendance CBSE expects for board exams.</p>
        </div>
      )}
    </>
  );
}
