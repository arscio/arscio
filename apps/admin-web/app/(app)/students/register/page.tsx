'use client';
// Admission and withdrawal register, and the list of certificates issued. Printable (A4 landscape).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, fileUrl } from '@/lib/api';
import { classLabel } from '@/lib/types';
import { useSchool } from '@/components/AppShell';
import { ErrorBox, Loading } from '@/components/ui';

interface Row {
  id: string; admissionNo: string; admissionDate: string | null; name: string; gender: string | null; dob: string | null;
  father: string | null; mother: string | null; guardian: string | null; address: string | null;
  classAdmitted: string | null; classNow: string | null; status: string; leftOn: string | null; tcNo: string | null; reason: string | null;
}
interface Cert { id: string; kind: string; serialNo: string; issuedAt: string; studentId: string; name: string; admissionNo: string; className: string | null; issuedBy: string | null; documentId: string | null }
const d = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const KIND = { tc: 'Transfer', bonafide: 'Bonafide', character: 'Character' } as Record<string, string>;
const cls = (c: string | null) => (c ? classLabel(c).replace('Class ', '') : '');

export default function RegisterPage() {
  const { info } = useSchool();
  const [view, setView] = useState<'register' | 'certs'>('register');
  const [year, setYear] = useState('');
  const [show, setShow] = useState<'all' | 'studying' | 'left'>('all');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [certs, setCerts] = useState<Cert[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const thisYear = new Date().getFullYear();

  useEffect(() => {
    setRows(null);
    api.get<{ rows: Row[] }>(`/registers/admission-withdrawal?show=${show}${year ? `&year=${year}` : ''}`).then((r) => setRows(r.rows)).catch((e) => setErr(e.message));
  }, [year, show]);
  useEffect(() => { if (view === 'certs' && !certs) api.get<{ certificates: Cert[] }>('/certificates').then((r) => setCerts(r.certificates)).catch((e) => setErr(e.message)); }, [view, certs]);

  return (
    <>
      <div className="page-head no-print">
        <div><Link href="/students" className="small">Students</Link><h1 style={{ marginTop: 4 }}>Registers</h1>
          <p>Every student ever admitted, with when and why they left. Kept automatically.</p></div>
        <button className="btn btn-plain" onClick={() => window.print()}>Print</button>
      </div>
      <div className="row no-print" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="seg" role="radiogroup" aria-label="Register">
          <button role="radio" aria-checked={view === 'register'} className={view === 'register' ? 'on' : ''} onClick={() => setView('register')}>Admission and withdrawal</button>
          <button role="radio" aria-checked={view === 'certs'} className={view === 'certs' ? 'on' : ''} onClick={() => setView('certs')}>Certificates issued</button>
        </div>
        {view === 'register' ? (
          <>
            <select className="input" style={{ maxWidth: 190 }} aria-label="Year of admission" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">All years of admission</option>
              {Array.from({ length: 16 }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>Admitted in {y}</option>)}
            </select>
            <select className="input" style={{ maxWidth: 190 }} aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
              <option value="all">Everyone</option><option value="studying">Studying here now</option><option value="left">Left or passed out</option>
            </select>
          </>
        ) : null}
      </div>
      <ErrorBox error={err} />
      <div className="print-wide">
        <div className="print-only" style={{ marginBottom: 8 }}>
          <strong style={{ fontSize: '13pt' }}>{info.school.name}</strong><br />
          {view === 'register' ? `Admission and withdrawal register${year ? `, admitted in ${year}` : ''}` : 'Certificates issued'}
        </div>
        {view === 'register' ? (!rows ? <Loading /> : (
          <div className="sheet table-wrap">
            <table className="register adm-register">
              <thead><tr>
                <th>S. no.</th><th>Admission no.</th><th>Date of admission</th><th>Name</th><th>Date of birth</th><th>Parents</th>
                <th>Address</th><th>Class admitted</th><th>Date of leaving</th><th>Class left</th><th>Reason</th><th>TC no.</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className={r.status !== 'active' ? 'is-left' : ''}>
                    <td className="num">{i + 1}</td>
                    <td className="num"><Link href={`/students/${r.id}/file`}>{r.admissionNo}</Link></td>
                    <td className="num">{d(r.admissionDate)}</td>
                    <td><strong>{r.name}</strong>{r.gender ? <span className="muted"> ({r.gender[0]!.toUpperCase()})</span> : null}</td>
                    <td className="num">{d(r.dob)}</td>
                    <td>{[r.father && `F: ${r.father}`, r.mother && `M: ${r.mother}`, !r.father && !r.mother && r.guardian && `G: ${r.guardian}`].filter(Boolean).map((x) => <div key={x as string}>{x}</div>)}</td>
                    <td className="small">{r.address}</td>
                    <td>{cls(r.classAdmitted)}</td>
                    <td className="num">{d(r.leftOn)}</td>
                    <td>{r.status !== 'active' ? cls(r.classNow) : ''}</td>
                    <td className="small">{r.status === 'passed_out' && !r.reason ? 'Passed out' : r.reason}</td>
                    <td className="num small">{r.tcNo}</td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={12} className="muted">No students match.</td></tr> : null}
              </tbody>
            </table>
          </div>
        )) : (!certs ? <Loading /> : (
          <div className="sheet table-wrap">
            <table className="register">
              <thead><tr><th>Serial no.</th><th>Certificate</th><th>Student</th><th>Class</th><th>Issued on</th><th>By</th><th className="no-print"></th></tr></thead>
              <tbody>
                {certs.map((c) => (
                  <tr key={c.id}>
                    <td className="num">{c.serialNo}</td><td>{KIND[c.kind]}</td>
                    <td><Link href={`/students/${c.studentId}/file`}>{c.name}</Link> <span className="muted num">{c.admissionNo}</span></td>
                    <td>{cls(c.className)}</td><td className="num">{d(c.issuedAt)}</td><td>{c.issuedBy}</td>
                    <td className="no-print">{c.documentId ? <a href={fileUrl(`/documents/${c.documentId}/content`)} target="_blank" rel="noreferrer">Open</a> : null}</td>
                  </tr>
                ))}
                {!certs.length ? <tr><td colSpan={7} className="muted">No certificates issued yet. Issue one from a student’s file.</td></tr> : null}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}
