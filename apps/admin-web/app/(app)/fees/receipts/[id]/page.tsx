'use client';
// A printable fee receipt. It's the SCHOOL's document: school logo, name, address
// and colour on top; a small "Powered by AIEdu" at the bottom. Two copies on one A4:
// one for the parent, one for the office.
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { rupeesInWords } from '@aiedu/shared';
import { api } from '@/lib/api';
import { classLabel } from '@/lib/types';
import { MODES, inr, niceDate } from '@/components/FeesTabs';
import { Loading } from '@/components/ui';

interface Receipt {
  id: string; receiptNo: string; paidOn: string; total: string; mode: string; reference: string | null;
  status: string; createdAt: string; cancelReason: string | null; cancelledAt: string | null; cancelledBy: string | null;
  collectedBy: string; yearName: string;
  student: { id: string; name: string; admissionNo: string; className: string | null; sectionName: string | null;
    rollNo: number | null; fatherName: string | null; motherName: string | null; phone: string };
  school: { id: string; name: string; address: string | null; phone: string | null; email: string | null;
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
  return (
    <section className="receipt" aria-label={copy}>
      <span className="copy">{copy}</span>
      {r.status === 'cancelled' ? <div className="void" aria-hidden><span>CANCELLED</span></div> : null}
      <div className="receipt-head">
        {r.school.logoUrl ? <img src={`/api/school-logo/${r.school.id}`} alt="" /> : null}
        <div>
          <h2>{r.school.name}</h2>
          <div className="small muted">
            {[r.school.address, r.school.phone ? `Phone ${r.school.phone}` : null].filter(Boolean).join('. ')}
            {r.school.affiliationNo ? <><br />{r.school.board} Affiliation No. {r.school.affiliationNo}</> : null}
          </div>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <strong style={{ fontFamily: 'var(--display)', fontSize: '1.05rem' }}>Fee receipt</strong>
        <span className="small">No. <strong className="num">{r.receiptNo}</strong>  Date <strong>{niceDate(r.paidOn)}</strong></span>
      </div>
      <div className="receipt-meta">
        <div>Student: <strong>{r.student.name}</strong></div>
        <div>Admission no.: <strong>{r.student.admissionNo}</strong></div>
        <div>Class: <strong>{r.student.className ? `${classLabel(r.student.className)} ${r.student.sectionName}` : '-'}</strong>{r.student.rollNo ? `, Roll ${r.student.rollNo}` : ''}</div>
        <div>Parent: <strong>{r.student.fatherName ?? r.student.motherName ?? '-'}</strong></div>
        <div>Session: <strong>{r.yearName}</strong></div>
        <div>Paid by: <strong>{MODES[r.mode]}</strong>{r.reference ? ` (${r.reference})` : ''}</div>
      </div>
      <table>
        <thead><tr><th>Particulars</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
        <tbody>
          {r.lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="money">{inr(l.amount)}</td></tr>)}
          {fines > 0 ? <tr><td>Late fine</td><td className="money">{inr(fines)}</td></tr> : null}
          <tr><td><strong>Total</strong></td><td className="money"><strong>{inr(r.total)}</strong></td></tr>
        </tbody>
      </table>
      <p className="small" style={{ marginTop: 8 }}>Received with thanks: <strong>{rupeesInWords(r.total)}</strong></p>
      {r.status === 'cancelled' ? (
        <p className="small" style={{ color: 'var(--red-ink)', marginTop: 6 }}>
          Cancelled on {niceDate(r.cancelledAt!)} by {r.cancelledBy}. Reason: {r.cancelReason}
        </p>
      ) : null}
      <div className="receipt-foot">
        <span>Collected by {r.collectedBy}. Computer-generated receipt. Powered by AIEdu.</span>
        <span className="sign">Accountant&apos;s signature</span>
      </div>
    </section>
  );
}
