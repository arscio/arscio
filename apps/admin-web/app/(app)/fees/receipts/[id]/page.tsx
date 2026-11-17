'use client';
// A printable fee receipt. It's the SCHOOL's document: school logo, name, address
// and colour on top; a small "Powered by Arscio" at the bottom. Two copies on one A4:
// one for the parent, one for the office.
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { rupeesInWords } from '@arscio/shared';
import { api } from '@/lib/api';
import { classLabel, sectionLabel } from '@/lib/types';
import { MODES, inr, niceDate } from '@/components/FeesTabs';
import { Loading } from '@/components/ui';

interface Receipt {
  id: string; receiptNo: string; paidOn: string; total: string; mode: string; reference: string | null;
  status: string; createdAt: string; cancelReason: string | null; cancelledAt: string | null; cancelledBy: string | null;
  collectedBy: string; yearName: string;
  student: { id: string; name: string; admissionNo: string; className: string | null; sectionName: string | null;
    rollNo: number | null; fatherName: string | null; motherName: string | null; phone: string };
  school: { id: string; name: string; shortName: string | null; address: string | null; phone: string | null; email: string | null;
    logoUrl: string | null; brandColor: string | null; affiliationNo: string | null; board: string };
  lines: { description: string; amount: string; fine: string }[];
}

export default function Page() {
  return <Suspense fallback={<Loading />}><ReceiptPage /></Suspense>;
}

function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = useSearchParams().get('new') === '1';
  const [r, setR] = useState<Receipt | null>(null);
  useEffect(() => { api.get<Receipt>(`/fees/receipts/${id}`).then(setR); }, [id]);
  if (!r) return <Loading />;

  return (
    <>
      <div className="page-head no-print">
        <div>
          <Link href={`/fees?student=${r.student.id}`} className="small">Back to {r.student.name}&apos;s fees</Link>
          <h1 style={{ marginTop: 4 }}>Receipt {r.receiptNo}</h1>
          {isNew ? <p style={{ color: 'var(--board)', fontWeight: 700 }}>Collected {inr(r.total)}. Print the receipt and give the top copy to the parent.</p> : null}
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={() => window.print()}>Print</button>
          <Link className="btn btn-plain" href="/fees">Next student</Link>
        </div>
      </div>
      <div className="receipt-sheet" style={{ ['--school' as string]: r.school.brandColor ?? undefined }}>
        <ReceiptCopy r={r} copy="Parent's copy" />
        <ReceiptCopy r={r} copy="Office copy" />
      </div>
    </>
  );
}

function ReceiptCopy({ r, copy }: { r: Receipt; copy: string }) {
  const fines = r.lines.reduce((a, l) => a + Number(l.fine), 0);
  const initials = r.school.shortName ?? r.school.name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('').slice(0, 3);
  return (
    <section className="receipt" aria-label={copy}>
      {r.status === 'cancelled' ? <div className="void" aria-hidden><span>CANCELLED</span></div> : null}
      <div className="receipt-watermark" aria-hidden>{initials}</div>
      <div className="receipt-head">
        <div className="receipt-crest">
          {r.school.logoUrl ? <img src={`/api/school-logo/${r.school.id}`} alt="" /> : <span>{initials}</span>}
        </div>
        <div>
          <h2>{r.school.name}</h2>
          <div className="small muted">
            {[r.school.affiliationNo ? `${r.school.board} Affiliation No. ${r.school.affiliationNo}` : null, r.school.address, r.school.phone ? `Phone ${r.school.phone}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
      <div className="receipt-band">
        <span className="receipt-tag">FEE RECEIPT</span>
        <span className="small muted">Session {r.yearName} · {copy}</span>
      </div>
      <div className="receipt-rule" aria-hidden />
      <div className="row" style={{ justifyContent: 'space-between', margin: '12px 0 10px' }}>
        <div><div className="small muted">Receipt no.</div><strong className="num">{r.receiptNo}</strong></div>
        <div style={{ textAlign: 'right' }}><div className="small muted">Date</div><strong>{niceDate(r.paidOn)}</strong></div>
      </div>
      <div className="receipt-meta">
        <div><span className="muted">Student: </span><strong>{r.student.name}</strong></div>
        <div><span className="muted">Class: </span><strong>{r.student.className ? `${sectionLabel(r.student.className, r.student.sectionName)}` : '-'}{r.student.rollNo ? `, Roll ${String(r.student.rollNo).padStart(2, '0')}` : ''}</strong></div>
        <div><span className="muted">Parent: </span><strong>{r.student.fatherName ?? r.student.motherName ?? '-'}</strong></div>
        <div><span className="muted">Admission no.: </span><strong>{r.student.admissionNo}</strong></div>
      </div>
      <table>
        <thead><tr><th>Fee head</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
        <tbody>
          {r.lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="money">{inr(l.amount)}</td></tr>)}
          {fines > 0 ? <tr><td>Late fine</td><td className="money">{inr(fines)}</td></tr> : null}
        </tbody>
        <tfoot><tr><td><strong>Total paid</strong></td><td className="money receipt-total">{inr(r.total)}</td></tr></tfoot>
      </table>
      <p className="small muted" style={{ marginTop: 4 }}>{rupeesInWords(r.total)}</p>
      {r.status === 'cancelled' ? (
        <p className="small" style={{ color: 'var(--red-ink)', marginTop: 6 }}>
          Cancelled on {niceDate(r.cancelledAt!)} by {r.cancelledBy}. Reason: {r.cancelReason}
        </p>
      ) : null}
      <div className="receipt-foot">
        <div className="small">
          <div><span className="muted">Paid by: </span>{MODES[r.mode]}{r.reference ? ` (${r.reference})` : ''}</div>
          <div><span className="muted">Received by: </span>{r.collectedBy}</div>
        </div>
        {r.status !== 'cancelled' ? <span className="receipt-stamp" aria-hidden>PAID</span> : null}
        <span className="sign">Signature</span>
      </div>
      <p className="receipt-note">Computer-made receipt. It cannot be deleted, only cancelled with a reason.</p>
      <p className="receipt-powered">
        <svg width="11" height="11" viewBox="0 0 100 100" aria-hidden focusable="false">
          <g fill="#0B7FA6" stroke="#0B7FA6" strokeWidth="7" strokeLinejoin="round"><path d="M10 89L41 12H59L90 89H74L50 33L26 89Z" /></g>
          <path d="M41 80C41 66 49 58 61 57C61 71 53 79 41 80Z" fill="#F2A33A" />
        </svg>
        Powered by Arscio
      </p>
    </section>
  );
}
