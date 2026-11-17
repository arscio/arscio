'use client';
// The day book: every receipt in a period, with totals by payment mode
// (so the cash in the drawer can be checked at the end of the day).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { classLabel, sectionLabel } from '@/lib/types';
import { FeesTabs, MODES, inr, niceDate } from '@/components/FeesTabs';
import { Loading } from '@/components/ui';

interface Book {
  from: string; to: string; total: string; cancelled: number; byMode: Record<string, string>;
  receipts: { id: string; receiptNo: string; paidOn: string; createdAt: string; total: string; mode: string; reference: string | null;
    status: string; cancelReason: string | null; cancelledBy: string | null; collectedBy: string; studentId: string;
    studentName: string; admissionNo: string; className: string | null; sectionName: string | null }[];
}
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default function DayBook() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [b, setB] = useState<Book | null>(null);
  useEffect(() => { api.get<Book>(`/fees/receipts?from=${from}&to=${to}`).then(setB); }, [from, to]);

  return (
    <>
      <div className="page-head no-print"><div><h1>Fees & receipts</h1></div></div>
      <FeesTabs />
      <div className="row no-print" style={{ marginBottom: 16 }}>
        <label className="row small">From <input className="input" type="date" style={{ width: 170 }} max={to} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label className="row small">To <input className="input" type="date" style={{ width: 170 }} min={from} max={today()} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        <button className="btn btn-plain" onClick={() => window.print()}>Print</button>
      </div>
      {!b ? <Loading /> : (
        <>
          <h2 className="print-only" style={{ marginBottom: 8 }}>Day book {niceDate(b.from)}{b.to !== b.from ? ` to ${niceDate(b.to)}` : ''}</h2>
          <div className="sheet sheet-pad" style={{ marginBottom: 16 }}>
            <div className="stats">
              <div><span className="stat-num">{inr(b.total)}</span><span className="muted">collected</span></div>
              {Object.entries(b.byMode).map(([m, v]) => <div key={m}><span className="stat-num">{inr(v)}</span><span className="muted">{MODES[m]}</span></div>)}
              <div><span className="stat-num num">{b.receipts.length - b.cancelled}</span><span className="muted">receipts</span></div>
              {b.cancelled ? <div><span className="stat-num num" style={{ color: 'var(--red-ink)' }}>{b.cancelled}</span><span className="muted">cancelled</span></div> : null}
            </div>
          </div>
          <div className="sheet table-wrap">
            {b.receipts.length === 0 ? <div className="empty"><p>No receipts in this period.</p></div> : (
              <table className="register">
                <thead><tr><th>Receipt no.</th><th>Date and time</th><th>Student</th><th>Class</th><th>Paid by</th><th className="money">Amount</th><th>Collected by</th></tr></thead>
                <tbody>{b.receipts.map((r) => (
                  <tr key={r.id} className={r.status === 'cancelled' ? 'struck' : undefined}>
                    <td className="num"><Link href={`/fees/receipts/${r.id}`}>{r.receiptNo}</Link></td>
                    <td className="small nowrap">{niceDate(r.paidOn)}, {new Date(r.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</td>
                    <td><strong>{r.studentName}</strong> <span className="small muted">{r.admissionNo}</span></td>
                    <td className="small">{r.className ? `${sectionLabel(r.className, r.sectionName)}` : '-'}</td>
                    <td className="small">{MODES[r.mode]}{r.reference ? ` (${r.reference})` : ''}</td>
                    <td className="money">{inr(r.total)}</td>
                    <td className="small keep">{r.status === 'cancelled'
                      ? <span className="tag tag-off">Cancelled by {r.cancelledBy}: {r.cancelReason}</span> : r.collectedBy}</td>
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
