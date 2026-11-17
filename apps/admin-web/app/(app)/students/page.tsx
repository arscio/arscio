'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { classLabel, showPhone, type Structure, type StudentRow } from '@/lib/types';
import { useSchool } from '@/components/AppShell';
import { Loading } from '@/components/ui';

export default function StudentsPage() {
  const { can } = useSchool();
  const router = useRouter();
  const [structure, setStructure] = useState<Structure | null>(null);
  const [rows, setRows] = useState<StudentRow[] | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');

  useEffect(() => { api.get<Structure>('/setup/structure').then(setStructure); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams({ status });
      if (sectionId) q.set('sectionId', sectionId);
      if (search.trim()) q.set('search', search.trim());
      api.get<{ students: StudentRow[] }>(`/students?${q}`).then((r) => setRows(r.students));
    }, 250);
    return () => clearTimeout(t);
  }, [sectionId, search, status]);

  const filtered = Boolean(sectionId || search.trim() || status !== 'active');

  return (
    <>
      <div className="page-head">
        <div><h1>Students</h1><p>{structure ? `Academic year ${structure.year.name}.` : ''} Search by name, admission number or family phone.</p></div>
        {can('students.manage') ? <div className="row"><Link className="btn btn-plain" href="/students/register">Registers</Link><Link className="btn btn-primary" href="/students/new">Add student</Link></div> : null}
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <input className="input" style={{ maxWidth: 320 }} type="search" placeholder="Search" aria-label="Search students"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" style={{ maxWidth: 220 }} aria-label="Class and section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          <option value="">All classes</option>
          {structure?.classes.map((c) => c.sections.length ? (
            <optgroup key={c.id} label={classLabel(c.name)}>
              {c.sections.map((s) => <option key={s.id} value={s.id}>{classLabel(c.name)} {s.name}</option>)}
            </optgroup>
          ) : null)}
        </select>
        <select className="input" style={{ maxWidth: 200 }} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Studying here</option><option value="all">Everyone, including left</option>
          <option value="left">Left</option><option value="transferred">Transferred</option><option value="passed_out">Passed out</option>
        </select>
        {rows ? <span className="muted small num">{rows.length}{rows.length === 500 ? '+' : ''} students</span> : null}
      </div>

      <div className="sheet table-wrap">
        {!rows ? <Loading /> : rows.length === 0 ? (
          <div className="empty">
            <h3>{filtered ? 'No students match' : 'No students yet'}</h3>
            <p>{filtered ? 'Try a different search or class.' : 'Add students one by one now. Importing from Excel will come later.'}</p>
            {!filtered && can('students.manage') ? <Link className="btn btn-primary" href="/students/new">Add the first student</Link> : null}
          </div>
        ) : (
          <table className="register">
            <thead><tr><th>Roll</th><th>Name</th><th>Admission no.</th><th>Class</th><th>Parents</th><th>Family phone</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/students/${s.id}`)}>
                <td className="num muted">{s.rollNo ?? '-'}</td>
                <td>
                  <Link href={`/students/${s.id}`} style={{ color: 'inherit', fontWeight: 700, textDecoration: 'none' }}>
                    {s.firstName} {s.lastName ?? ''}
                  </Link>
                  {s.status !== 'active' ? <span className="tag tag-off" style={{ marginLeft: 8 }}>{s.status.replace('_', ' ')}</span> : null}
                </td>
                <td className="num">{s.admissionNo}</td>
                <td>{s.className ? `${classLabel(s.className)} ${s.sectionName}` : <span className="muted">-</span>}</td>
                <td className="small">{[s.fatherName, s.motherName].filter(Boolean).join(', ') || <span className="muted">-</span>}</td>
                <td className="num nowrap">{showPhone(s.familyPhone)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
