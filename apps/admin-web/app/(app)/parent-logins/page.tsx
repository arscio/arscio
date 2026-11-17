'use client';
// Parent logins: parents log in with the admission number; the first password is
// the child's date of birth (DDMMYYYY). Here the office prints login slips for a
// class, fixes missing dates of birth, and resets a parent who forgot or got locked out.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, fileUrl } from '@/lib/api';
import { classLabel, sectionLabel, showPhone, type Structure } from '@/lib/types';
import { useSchool } from '@/components/AppShell';
import { ErrorBox, Loading, useToast } from '@/components/ui';

interface Row {
  id: string; name: string; admissionNo: string; hasDob: boolean; className: string | null; sectionName: string | null;
  rollNo: number | null; familyPhone: string; status: 'not_started' | 'active'; locked: boolean;
}
interface Data { students: Row[]; missingDob: number; appDownloadUrl: string | null }

export default function ParentLogins() {
  const { can } = useSchool();
  const [structure, setStructure] = useState<Structure | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => { api.get<Structure>('/setup/structure').then(setStructure); }, []);
  const load = useCallback(async () => {
    setData(await api.get<Data>(`/parent-logins${sectionId ? `?sectionId=${sectionId}` : ''}`));
  }, [sectionId]);
  useEffect(() => { void load(); }, [load]);
  if (!structure || !data) return <Loading />;

  const sections = structure.classes.flatMap((c) => c.sections.map((s) => ({ id: s.id, label: `${sectionLabel(c.name, s.name)}` })));
  const reset = async (r: Row) => {
    if (!confirm(`Reset the parent login for ${r.name}'s family? Their password goes back to the date of birth and they are logged out everywhere.`)) return;
    setError(null);
    try { await api.post(`/parent-logins/${r.id}/reset`); toast.show('Password is the date of birth again'); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not reset'); }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Parent logins</h1>
          <p>Parents log in to the app with the admission number. The first password is the child&apos;s date of birth written as DDMMYYYY
            (5 August 2015 is 05082015); after that they choose their own. One login works for all children in a family.</p>
        </div>
      </div>

      {data.missingDob > 0 ? (
        <div className="notice notice-warn" role="status" style={{ marginBottom: 16 }}>
          <strong>{data.missingDob} {data.missingDob === 1 ? 'student has' : 'students have'} no date of birth.</strong>{' '}
          Their parents can&apos;t log in until it is added. {sectionId ? 'They are marked below.' : 'They are listed below; open each one to add it.'}
        </div>
      ) : null}
      {!data.appDownloadUrl ? (
        <p className="small muted" style={{ marginBottom: 12 }}>Slips print without the &quot;get the app&quot; QR code until the app download link is set up on the server.</p>
      ) : null}

      <div className="row" style={{ gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 8 }}>
          <span className="small">Class</span>
          <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">Only problems (no date of birth, locked out)</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        {sectionId ? (
          <>
            <a className="btn btn-primary" href={fileUrl(`/parent-logins/slips.pdf?sectionId=${sectionId}`)} target="_blank" rel="noreferrer">Print login slips</a>
            <a className="btn btn-plain" href={fileUrl(`/parent-logins/slips.pdf?sectionId=${sectionId}&onlyNew=1`)} target="_blank" rel="noreferrer">Slips only for parents not logged in yet</a>
          </>
        ) : null}
      </div>
      <ErrorBox error={error} />

      {data.students.length === 0 ? (
        <div className="sheet empty"><p>{sectionId ? 'No students in this class.' : 'Nothing to fix. Choose a class to see every family or print slips.'}</p></div>
      ) : (
        <div className="sheet table-wrap">
          <table className="register">
            <thead><tr><th>Roll</th><th>Student</th><th>Login ID</th><th>Family mobile</th><th>Login</th><th></th></tr></thead>
            <tbody>{data.students.map((r) => (
              <tr key={r.id}>
                <td className="num muted">{r.rollNo ?? '-'}</td>
                <td><Link href={`/students/${r.id}`}><strong>{r.name}</strong></Link>
                  {!sectionId && r.className ? <div className="small muted">{sectionLabel(r.className, r.sectionName)}</div> : null}</td>
                <td className="num nowrap">{r.admissionNo}</td>
                <td className="num nowrap">{showPhone(r.familyPhone)}</td>
                <td className="small">
                  {!r.hasDob ? <Link href={`/students/${r.id}`} className="tag tag-warn">Add date of birth</Link> : null}
                  {r.locked ? <span className="tag tag-warn">Locked out</span> : null}
                  {r.hasDob && !r.locked ? (r.status === 'active' ? <span className="tag tag-board">Logged in</span> : <span className="tag">Not yet</span>) : null}
                </td>
                <td className="actions">
                  {can('accounts.reset_login') && (r.status === 'active' || r.locked) ? (
                    <button className="btn btn-plain" onClick={() => void reset(r)}>Reset to date of birth</button>
                  ) : null}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {toast.node}
    </>
  );
}
