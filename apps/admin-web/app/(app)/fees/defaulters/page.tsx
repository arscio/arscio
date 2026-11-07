'use client';
// Families who still owe money that is past its due date, biggest amounts first.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { classLabel, showPhone, type Structure } from '@/lib/types';
import { useSchool } from '@/components/AppShell';
import { FeesTabs, inr, niceDate } from '@/components/FeesTabs';
import { Loading } from '@/components/ui';

interface List {
  asOf: string; total: string; count: number;
  defaulters: { studentId: string; name: string; admissionNo: string; className: string | null; sectionName: string | null;
    rollNo: number | null; phone: string; parentName: string | null; overdue: string; oldestDue: string;
    instalments: number; instalmentNames: string }[];
}

export default function Defaulters() {
  const { can } = useSchool();
  const [classId, setClassId] = useState('');
  const [structure, setStructure] = useState<Structure | null>(null);
  const [l, setL] = useState<List | null>(null);
  useEffect(() => { api.get<Structure>('/setup/structure').then(setStructure); }, []);
  useEffect(() => { setL(null); api.get<List>(`/fees/defaulters${classId ? `?classId=${classId}` : ''}`).then(setL); }, [classId]);

  return (
    <>
      <div className="page-head no-print"><div><h1>Fees & receipts</h1></div></div>
      <FeesTabs />
      <div className="row no-print" style={{ marginBottom: 16 }}>
        <select className="input" style={{ width: 200 }} aria-label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">All classes</option>
          {structure?.classes.map((c) => <option key={c.id} value={c.id}>{classLabel(c.name)}</option>)}
        </select>
        <button className="btn btn-plain" onClick={() => window.print()}>Print list</button>
      </div>
      {!l ? <Loading /> : (
        <>
          <h2 className="print-only" style={{ marginBottom: 8 }}>Fee defaulters as of {niceDate(l.asOf)}</h2>
          <div className="sheet sheet-pad" style={{ marginBottom: 16 }}>
            <div className="stats">
              <div><span className="stat-num" style={{ color: l.count ? 'var(--red-ink)' : undefined }}>{inr(l.total)}</span><span className="muted">overdue</span></div>
              <div><span className="stat-num num">{l.count}</span><span className="muted">{l.count === 1 ? 'student' : 'students'}</span></div>
            </div>
          </div>
          <div className="sheet table-wrap">
            {l.count === 0 ? <div className="empty"><h3>No one has overdue fees</h3><p>Everything due so far has been paid.</p></div> : (
              <table className="register">
                <thead><tr><th>Roll</th><th>Student</th><th>Class</th><th>Parent</th><th>Phone</th><th>Unpaid</th><th className="money">Overdue</th><th className="no-print"></th></tr></thead>
                <tbody>{l.defaulters.map((d) => (
                  <tr key={d.studentId}>
                    <td className="num muted">{d.rollNo ?? '-'}</td>
                    <td><strong>{d.name}</strong> <span className="small muted">{d.admissionNo}</span></td>
                    <td className="small">{d.className ? `${classLabel(d.className)} ${d.sectionName}` : '-'}</td>
                    <td className="small">{d.parentName ?? '-'}</td>
                    <td className="num nowrap"><a href={`tel:${d.phone}`}>{showPhone(d.phone)}</a></td>
                    <td className="small">{d.instalmentNames}<div className="muted">since {niceDate(d.oldestDue)}</div></td>
                    <td className="money" style={{ color: 'var(--red-ink)', fontWeight: 700 }}>{inr(d.overdue)}</td>
                    <td className="actions no-print">{can('fees.collect') ? <Link className="btn btn-plain" href={`/fees?student=${d.studentId}`}>Collect</Link> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
