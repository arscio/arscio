'use client';
// Collect fees at the counter: find the child, tick what's being paid, collect, print.
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, photoSrc } from '@/lib/api';
import { classLabel, sectionLabel, showPhone, type StudentRow } from '@/lib/types';
import { useSchool } from '@/components/AppShell';
import { FeesTabs, MODES, inr, niceDate } from '@/components/FeesTabs';
import { ErrorBox, Field, Loading, Panel, useToast } from '@/components/ui';

interface Due {
  feeDueId: string; feeHead: string; instalment: string; dueOn: string;
  amount: string; concession: string; paid: string; balance: string; suggestedFine: string;
}
interface ReceiptRow {
  id: string; receiptNo: string; paidOn: string; total: string; mode: string; status: string;
  cancelReason: string | null; cancelledBy: string | null; collectedBy: string;
}
interface Concession { id: string; kind: 'percent' | 'flat'; value: string; reason: string; feeHead: string | null; approvedBy: string }
interface Detail {
  id: string; admissionNo: string; firstName: string; lastName: string | null; sectionId: string | null;
  rollNo: number | null; photoUrl: string | null; className: string | null; sectionName: string | null;
  siblings: { id: string; name: string }[] | null;
  family: { phone: string; fatherName: string | null; motherName: string | null };
}

export default function CollectPage() {
  return <Suspense fallback={<Loading />}><Collect /></Suspense>;
}

function Collect() {
  const params = useSearchParams();
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(params.get('student'));
  useEffect(() => { setStudentId(params.get('student')); }, [params]);

  return (
    <>
      <div className="page-head"><div><h1>Fees & receipts</h1></div></div>
      <FeesTabs />
      <StudentSearch onPick={(id) => router.push(`/fees?student=${id}`)} />
      {studentId ? <StudentFees key={studentId} studentId={studentId} /> : (
        <div className="sheet empty" style={{ marginTop: 16 }}>
          <h3>Find a student to collect fees</h3>
          <p>Search by name, admission number or the family&apos;s phone number.</p>
        </div>
      )}
    </>
  );
}

function StudentSearch({ onPick }: { onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<StudentRow[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return; }
    const t = setTimeout(() => {
      api.get<{ students: StudentRow[] }>(`/students?search=${encodeURIComponent(q.trim())}`).then((r) => setRows(r.students.slice(0, 12)));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div style={{ maxWidth: 560, position: 'relative' }} className="no-print">
      <input className="input" type="search" autoFocus placeholder="Student name, admission no. or phone" aria-label="Find a student"
        value={q} onChange={(e) => setQ(e.target.value)} />
      {rows.length ? (
        <div className="search-results" role="listbox">
          {rows.map((s) => (
            <button key={s.id} role="option" aria-selected={false} onClick={() => { onPick(s.id); setQ(''); setRows([]); }}>
              <span><strong>{s.firstName} {s.lastName ?? ''}</strong> <span className="muted small">{s.admissionNo}</span></span>
              <span className="small muted">{s.className ? `${sectionLabel(s.className, s.sectionName)}` : ''}  {showPhone(s.familyPhone)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StudentFees({ studentId }: { studentId: string }) {
  const { can } = useSchool();
  const router = useRouter();
  const toast = useToast();
  const [student, setStudent] = useState<Detail | null>(null);
  const [dues, setDues] = useState<Due[] | null>(null);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [concessions, setConcessions] = useState<Concession[]>([]);
  const [pick, setPick] = useState<Record<string, { on: boolean; amount: string; fine: string }>>({});
  const [mode, setMode] = useState('cash');
  const [reference, setReference] = useState('');
  const [received, setReceived] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<ReceiptRow | null>(null);
  const [concessionOpen, setConcessionOpen] = useState(false);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const load = useCallback(async () => {
    const [s, d, r, c] = await Promise.all([
      api.get<Detail>(`/students/${studentId}`),
      api.get<{ dues: Due[] }>(`/students/${studentId}/dues`),
      api.get<{ receipts: ReceiptRow[] }>(`/fees/receipts?studentId=${studentId}`),
      api.get<{ concessions: Concession[] }>(`/students/${studentId}/concessions`),
    ]);
    setStudent(s); setDues(d.dues); setReceipts(r.receipts); setConcessions(c.concessions);
    // Tick everything already due (or the next instalment if nothing is due yet).
    const open = d.dues.filter((x) => Number(x.balance) > 0);
    const firstDue = open.map((x) => x.dueOn).sort()[0];
    const p: typeof pick = {};
    for (const x of open) {
      const on = x.dueOn <= today || x.dueOn === firstDue;
      p[x.feeDueId] = { on, amount: x.balance, fine: x.suggestedFine };
    }
    setPick(p);
  }, [studentId, today]);
  useEffect(() => { void load(); }, [load]);

  const total = useMemo(() => Object.values(pick).filter((p) => p.on)
    .reduce((a, p) => a + Math.round((Number(p.amount) || 0) * 100) + Math.round((Number(p.fine) || 0) * 100), 0) / 100, [pick]);

  if (!student || !dues) return <Loading />;
  const open = dues.filter((d) => Number(d.balance) > 0);
  const owed = open.reduce((a, d) => a + Number(d.balance), 0);
  const overdue = open.filter((d) => d.dueOn < today).reduce((a, d) => a + Number(d.balance), 0);

  const collect = async () => {
    setBusy(true); setError(null);
    try {
      const lines = Object.entries(pick).filter(([, p]) => p.on).map(([feeDueId, p]) => ({
        feeDueId, amount: p.amount || '0', fine: p.fine || '0',
      }));
      const r = await api.post<{ id: string }>('/fees/receipts', { studentId, mode, reference: reference.trim() || undefined, lines });
      router.push(`/fees/receipts/${r.id}?new=1`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not collect'); setBusy(false); }
  };

  const fullName = `${student.firstName} ${student.lastName ?? ''}`.trim();
  const initials = fullName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const cashBack = mode === 'cash' && received ? Math.round((Number(received) - total) * 100) / 100 : null;

  return (
    <div className="stack" style={{ marginTop: 18, gap: 18 }}>
      <div className="collect">
        <div className="collect-side">
          <section className="id-card" aria-label="Student">
            <div className="id-band" aria-hidden />
            <div className="id-body">
              <div className="id-photo">
                {student.photoUrl ? <img src={photoSrc(student.photoUrl)!} alt={`${fullName} photo`} /> : <span aria-hidden>{initials}</span>}
              </div>
              <div>
                <h2>{fullName}</h2>
                <div className="small muted">
                  {student.className ? `${sectionLabel(student.className, student.sectionName ?? '')}` : 'No class this year'}
                  {student.rollNo ? ` · Roll ${String(student.rollNo).padStart(2, '0')}` : ''}
                </div>
              </div>
              <dl className="id-facts">
                <div><dt>Admission no.</dt><dd>{student.admissionNo}</dd></div>
                <div><dt>Parent</dt><dd>{student.family.fatherName ?? student.family.motherName ?? '-'}</dd></div>
                <div><dt>Phone</dt><dd>{showPhone(student.family.phone)}</dd></div>
                <div><dt>Siblings</dt><dd>{student.siblings?.length ? student.siblings.map((x) => x.name.split(' ')[0]).join(', ') : 'None'}</dd></div>
              </dl>
              <div className="row" style={{ gap: 6 }}>
                {owed === 0 ? <span className="tag tag-board">All paid</span>
                  : overdue > 0 ? <span className="tag tag-warn">{inr(overdue)} overdue</span>
                  : <span className="tag tag-warn">{inr(owed)} to pay</span>}
                {concessions.length ? <span className="tag">Concession</span> : null}
              </div>
              {concessions.length ? (
                <p className="small muted">{concessions.map((c) =>
                  `${c.kind === 'percent' ? `${Number(c.value)}%` : inr(c.value)} on ${c.feeHead ?? 'all fees'} (${c.reason})`).join('; ')}</p>
              ) : null}
              {can('fees.manage_structure') ? <button className="btn btn-quiet" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={() => setConcessionOpen(true)}>Concessions</button> : null}
            </div>
          </section>

          {open.length ? (
            <section className="pay-panel" aria-label="Payment">
              <h2>Payment</h2>
              <div className="seg seg-wide" role="radiogroup" aria-label="Paid by">
                {['cash', 'upi', 'cheque', 'bank_transfer', 'card'].map((m) => (
                  <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : undefined} data-v="mode"
                    onClick={() => setMode(m)}>{MODES[m]}</button>
                ))}
              </div>
              {mode === 'cash' ? (
                <Field label="Cash received" htmlFor="recv">
                  <input id="recv" className="input" inputMode="decimal" placeholder={inr(total)} value={received}
                    onChange={(e) => setReceived(e.target.value.replace(/[^\d.]/g, ''))} />
                </Field>
              ) : (
                <Field label={mode === 'cheque' ? 'Cheque number' : 'Reference number'} htmlFor="ref">
                  <input id="ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
                </Field>
              )}
              {cashBack !== null && cashBack > 0 ? <div className="change-back"><span>Return to parent</span><strong>{inr(cashBack)}</strong></div> : null}
              {cashBack !== null && cashBack < 0 ? <div className="error-box small">That is {inr(-cashBack)} less than the total.</div> : null}
              <div className="pay-total"><span className="small muted">Total</span><span className="total-big">{inr(total)}</span></div>
              <ErrorBox error={error} />
              <button className="btn btn-primary btn-big" disabled={busy || total <= 0} onClick={collect}>Save and print receipt</button>
            </section>
          ) : null}
        </div>

        <section className="ledger" aria-label="Dues ledger">
          <div className="ledger-head">
            <h2>Dues ledger</h2>
            <span className="small muted">{inr(owed)} still to pay this year</span>
          </div>
          {dues.length === 0 ? (
            <div className="empty"><h3>No fees set for this student yet</h3>
              <p>Set the fee structure for their class and create fee lines on the Fee setup tab.</p></div>
          ) : (
            <div className="table-wrap">
              <table className="register ledger-table">
                <thead><tr><th><span className="sr-only">Pay</span></th><th>Fee head</th><th>Due</th><th className="money">Balance</th><th className="money">Pay now</th><th className="money">Late fine</th></tr></thead>
                <tbody>{dues.map((d) => {
                  const p = pick[d.feeDueId];
                  const late = Number(d.balance) > 0 && d.dueOn < today;
                  return (
                    <tr key={d.feeDueId} style={Number(d.balance) === 0 ? { color: 'var(--ink-soft)' } : undefined}>
                      <td>{p ? <input type="checkbox" className="tick" aria-label={`Pay ${d.feeHead} ${d.instalment}`} checked={p.on}
                        onChange={(e) => setPick({ ...pick, [d.feeDueId]: { ...p, on: e.target.checked } })} /> : <span className="tag tag-board">Paid</span>}</td>
                      <td><strong>{d.feeHead}</strong><div className="small muted">{d.instalment}</div></td>
                      <td className="small nowrap" style={late ? { color: 'var(--marigold)', fontWeight: 700 } : undefined}>{niceDate(d.dueOn)}</td>
                      <td className="money"><strong>{inr(d.balance)}</strong>
                        {Number(d.concession) || Number(d.paid) ? <div className="small muted">of {inr(d.amount)}{Number(d.concession) ? `, −${inr(d.concession)} concession` : ''}{Number(d.paid) ? `, ${inr(d.paid)} paid` : ''}</div> : null}</td>
                      <td className="money">{p ? <input className="input money-in" inputMode="decimal" aria-label="Amount to pay" disabled={!p.on}
                        value={p.amount} onChange={(e) => setPick({ ...pick, [d.feeDueId]: { ...p, amount: e.target.value.replace(/[^\d.]/g, '') } })} /> : null}</td>
                      <td className="money">{p ? <input className="input money-in" inputMode="decimal" aria-label="Late fine" disabled={!p.on}
                        value={p.fine} onChange={(e) => setPick({ ...pick, [d.feeDueId]: { ...p, fine: e.target.value.replace(/[^\d.]/g, '') } })} /> : null}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
          {dues.length && !open.length ? <div className="ledger-foot"><span className="tag tag-board">All fees for this year are paid</span></div>
            : dues.length ? <div className="ledger-foot"><span className="small muted">Selected</span><span className="total-big">{inr(total)}</span></div> : null}
        </section>
      </div>

      <div>
        <h2 style={{ marginBottom: 10 }}>Receipts</h2>
        <div className="sheet table-wrap">
          {receipts.length === 0 ? <div className="empty"><p>No receipts yet.</p></div> : (
            <table className="register">
              <thead><tr><th>Receipt no.</th><th>Date</th><th>Paid by</th><th className="money">Amount</th><th>Collected by</th><th></th></tr></thead>
              <tbody>{receipts.map((r) => (
                <tr key={r.id} className={r.status === 'cancelled' ? 'struck' : undefined}>
                  <td className="num">{r.receiptNo}</td>
                  <td className="small">{niceDate(r.paidOn)}</td>
                  <td className="small">{MODES[r.mode]}</td>
                  <td className="money">{inr(r.total)}</td>
                  <td className="small keep">{r.status === 'cancelled'
                    ? <span className="tag tag-off" title={r.cancelReason ?? ''}>Cancelled by {r.cancelledBy}: {r.cancelReason}</span> : r.collectedBy}</td>
                  <td className="actions keep">
                    <Link className="btn btn-plain" href={`/fees/receipts/${r.id}`}>View</Link>{' '}
                    {r.status === 'active' && can('fees.cancel_receipt') ? <button className="btn btn-quiet" onClick={() => setCancelling(r)}>Cancel</button> : null}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      <Panel open={!!cancelling} title={`Cancel receipt ${cancelling?.receiptNo ?? ''}`} onClose={() => setCancelling(null)}>
        {cancelling ? <CancelForm receipt={cancelling} onDone={async () => { setCancelling(null); await load(); toast.show('Receipt cancelled'); }} /> : null}
      </Panel>
      <Panel open={concessionOpen} title="Concessions" onClose={() => setConcessionOpen(false)}>
        {concessionOpen ? <Concessions studentId={studentId} list={concessions} onChanged={async (m) => { await load(); toast.show(m); }} /> : null}
      </Panel>
      {toast.node}
    </div>
  );
}

function CancelForm({ receipt, onDone }: { receipt: ReceiptRow; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(null);
      try { await api.post(`/fees/receipts/${receipt.id}/cancel`, { reason }); await onDone(); }
      catch (err) { setError(err instanceof ApiError ? err.message : 'Could not cancel'); }
      finally { setBusy(false); }
    }}>
      <div className="notice">Receipts are never deleted. This one will stay in the records marked <strong>Cancelled</strong>, with your name, the time and your reason. The {inr(receipt.total)} goes back to &ldquo;still to pay&rdquo;.</div>
      <Field label="Why is it being cancelled?" htmlFor="why" hint="For example: wrong student selected, amount entered wrongly, cheque bounced.">
        <textarea id="why" className="input" rows={3} required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorBox error={error} />
      <div><button className="btn btn-danger" disabled={busy || reason.trim().length < 5}>Cancel this receipt</button></div>
    </form>
  );
}

function Concessions({ studentId, list, onChanged }: { studentId: string; list: Concession[]; onChanged: (m: string) => Promise<void> }) {
  const [heads, setHeads] = useState<{ id: string; name: string }[]>([]);
  const [head, setHead] = useState('');
  const [kind, setKind] = useState<'percent' | 'flat'>('percent');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.get<{ heads: { id: string; name: string }[] }>('/fees/setup').then((s) => setHeads(s.heads)); }, []);
  return (
    <div className="stack">
      {list.length ? (
        <table className="register" style={{ border: '1px solid var(--rule)' }}><tbody>{list.map((c) => (
          <tr key={c.id}>
            <td><strong>{c.kind === 'percent' ? `${Number(c.value)}%` : inr(c.value)}</strong> on {c.feeHead ?? 'all fees'}
              <div className="small muted">{c.reason}. Given by {c.approvedBy}.</div></td>
            <td className="actions"><button className="btn btn-quiet" onClick={async () => {
              if (!confirm('Remove this concession?')) return;
              try { await api.del(`/fees/concessions/${c.id}`); await onChanged('Concession removed'); }
              catch (e) { setError(e instanceof ApiError ? e.message : 'Could not remove'); }
            }}>Remove</button></td>
          </tr>
        ))}</tbody></table>
      ) : <p className="muted">No concessions for this student.</p>}
      <form className="stack" style={{ borderTop: '1px solid var(--rule)', paddingTop: 16 }} onSubmit={async (e) => {
        e.preventDefault(); setError(null);
        try {
          await api.post('/fees/concessions', { studentId, feeHeadId: head || null, kind, value, reason });
          setValue(''); setReason(''); await onChanged('Concession added');
        } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save'); }
      }}>
        <h3>Add a concession</h3>
        <div className="grid-2">
          <Field label="On which fee" htmlFor="ch">
            <select id="ch" className="input" value={head} onChange={(e) => setHead(e.target.value)}>
              <option value="">All fees</option>{heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </Field>
          <Field label="How much" htmlFor="cv" hint={kind === 'percent' ? 'Percent of each fee line' : 'Rupees off each instalment'}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input id="cv" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} />
              <select className="input" style={{ width: 90 }} aria-label="Percent or rupees" value={kind} onChange={(e) => setKind(e.target.value as 'percent' | 'flat')}>
                <option value="percent">%</option><option value="flat">₹</option>
              </select>
            </div>
          </Field>
        </div>
        <Field label="Reason" htmlFor="cr" hint="For example: second child, staff ward, scholarship.">
          <input id="cr" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <div><button className="btn btn-primary" disabled={!value || reason.trim().length < 3}>Add concession</button></div>
      </form>
    </div>
  );
}
