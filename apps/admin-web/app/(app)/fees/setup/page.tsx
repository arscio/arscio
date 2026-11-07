'use client';
// Fee setup, in four steps the school does once a year:
//  1. fee types  2. instalments (due dates, late fine)  3. amounts per class  4. create each child's fee lines
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { classLabel } from '@/lib/types';
import { FeesTabs, inr, niceDate } from '@/components/FeesTabs';
import { ErrorBox, Field, Loading, Panel, useToast } from '@/components/ui';

interface Instalment {
  id: string; name: string; dueOn: string; graceDays: number; fineType: 'none' | 'flat' | 'per_day';
  fineAmount: string; fineCap: string | null; hasDues: boolean;
}
interface Setup {
  year: { id: string; name: string };
  heads: { id: string; name: string; isActive: boolean }[];
  instalments: Instalment[];
  classes: { id: string; name: string; students: number }[];
  structure: { classId: string; feeHeadId: string; instalmentId: string; amount: string }[];
  dues: { lines: number; students: number };
}

const fineText = (i: Instalment) =>
  i.fineType === 'none' ? 'No late fine'
    : i.fineType === 'flat' ? `${inr(i.fineAmount)} once`
    : `${inr(i.fineAmount)} a day${i.fineCap ? `, up to ${inr(i.fineCap)}` : ''}`;

export default function FeeSetup() {
  const [s, setS] = useState<Setup | null>(null);
  const [newHead, setNewHead] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [instEdit, setInstEdit] = useState<Instalment | 'new' | null>(null);
  const [classEdit, setClassEdit] = useState<Setup['classes'][number] | null>(null);
  const toast = useToast();
  const load = useCallback(async () => setS(await api.get<Setup>('/fees/setup')), []);
  useEffect(() => { void load(); }, [load]);
  if (!s) return <Loading />;

  const amount = (classId: string, instId: string) =>
    s.structure.filter((x) => x.classId === classId && x.instalmentId === instId).reduce((a, x) => a + Number(x.amount), 0);
  const yearTotal = (classId: string) => s.structure.filter((x) => x.classId === classId).reduce((a, x) => a + Number(x.amount), 0);

  return (
    <>
      <div className="page-head"><div><h1>Fees & receipts</h1></div></div>
      <FeesTabs />
      <p className="muted" style={{ marginBottom: 18 }}>Fee setup for {s.year.name}. Do these four steps in order. You can change things later; children who have already paid are never affected.</p>
      <ErrorBox error={error} />

      <section className="sheet sheet-pad stack" style={{ marginBottom: 18 }}>
        <h2>1. Fee types</h2>
        <div className="checks">
          {s.heads.map((h) => <span key={h.id} className="tag" style={{ fontSize: '0.9375rem', padding: '5px 12px' }}>{h.name}</span>)}
          {s.heads.length === 0 ? <span className="muted small">None yet. Common ones: Tuition, Admission, Annual charges, Transport, Exam.</span> : null}
        </div>
        <form className="row" onSubmit={async (e) => {
          e.preventDefault(); setError(null);
          try { await api.post('/fees/heads', { name: newHead }); setNewHead(''); await load(); toast.show('Fee type added'); }
          catch (err) { setError(err instanceof ApiError ? err.message : 'Could not add'); }
        }}>
          <input className="input" style={{ maxWidth: 260 }} placeholder="For example: Tuition" aria-label="New fee type" value={newHead} onChange={(e) => setNewHead(e.target.value)} />
          <button className="btn btn-plain" disabled={newHead.trim().length < 2}>Add fee type</button>
        </form>
      </section>

      <section className="sheet stack" style={{ marginBottom: 18, gap: 0 }}>
        <div className="sheet-pad row" style={{ justifyContent: 'space-between' }}>
          <div><h2>2. Instalments</h2><p className="small muted" style={{ marginTop: 4 }}>When fees are due, and the late fine after that.</p></div>
          <button className="btn btn-plain" onClick={() => setInstEdit('new')}>Add instalment</button>
        </div>
        {s.instalments.length ? (
          <table className="register">
            <thead><tr><th>Instalment</th><th>Due date</th><th>Grace</th><th>Late fine</th><th></th></tr></thead>
            <tbody>{s.instalments.map((i) => (
              <tr key={i.id}>
                <td><strong>{i.name}</strong></td>
                <td>{niceDate(i.dueOn)}</td>
                <td className="small">{i.graceDays ? `${i.graceDays} days` : 'None'}</td>
                <td className="small">{fineText(i)}</td>
                <td className="actions"><button className="btn btn-plain" onClick={() => setInstEdit(i)}>Edit</button></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="sheet-pad muted small" style={{ paddingTop: 0 }}>None yet. Many schools use four: April, July, October and January.</p>}
      </section>

      <section className="sheet stack" style={{ marginBottom: 18, gap: 0 }}>
        <div className="sheet-pad"><h2>3. Fees for each class</h2><p className="small muted" style={{ marginTop: 4 }}>The total per instalment is shown; open a class to set each fee type.</p></div>
        {s.heads.length === 0 || s.instalments.length === 0 ? <p className="sheet-pad muted small" style={{ paddingTop: 0 }}>Add fee types and instalments first.</p> : (
          <div className="table-wrap">
            <table className="register">
              <thead><tr><th>Class</th>{s.instalments.map((i) => <th key={i.id} className="money">{i.name}</th>)}<th className="money">Year total</th><th></th></tr></thead>
              <tbody>{s.classes.map((c) => (
                <tr key={c.id}>
                  <td><strong>{classLabel(c.name)}</strong><div className="small muted num">{c.students} {c.students === 1 ? 'student' : 'students'}</div></td>
                  {s.instalments.map((i) => <td key={i.id} className="money">{amount(c.id, i.id) ? inr(amount(c.id, i.id)) : <span className="muted">-</span>}</td>)}
                  <td className="money"><strong>{yearTotal(c.id) ? inr(yearTotal(c.id)) : <span className="muted">Not set</span>}</strong></td>
                  <td className="actions"><button className="btn btn-plain" onClick={() => setClassEdit(c)}>Edit</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <GenerateDues setup={s} onDone={async (m) => { await load(); toast.show(m); }} />

      <Panel open={instEdit !== null} title={instEdit === 'new' ? 'Add instalment' : 'Edit instalment'} onClose={() => setInstEdit(null)}>
        {instEdit !== null ? <InstalmentForm inst={instEdit === 'new' ? null : instEdit}
          onDone={async (m) => { setInstEdit(null); await load(); toast.show(m); }} /> : null}
      </Panel>
      <Panel open={!!classEdit} title={classEdit ? `${classLabel(classEdit.name)} fees` : ''} onClose={() => setClassEdit(null)}>
        {classEdit ? <ClassFees key={classEdit.id} setup={s} classId={classEdit.id}
          onDone={async (m) => { setClassEdit(null); await load(); toast.show(m); }} /> : null}
      </Panel>
      {toast.node}
    </>
  );
}

function InstalmentForm({ inst, onDone }: { inst: Instalment | null; onDone: (m: string) => Promise<void> }) {
  const [v, setV] = useState({
    name: inst?.name ?? '', dueOn: inst?.dueOn ?? '', graceDays: String(inst?.graceDays ?? 0),
    fineType: inst?.fineType ?? 'none', fineAmount: inst ? String(Number(inst.fineAmount)) : '', fineCap: inst?.fineCap ? String(Number(inst.fineCap)) : '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    const body = { name: v.name, dueOn: v.dueOn, graceDays: Number(v.graceDays) || 0, fineType: v.fineType,
      fineAmount: v.fineType === 'none' ? '0' : v.fineAmount || '0', fineCap: v.fineType === 'per_day' && v.fineCap ? v.fineCap : null };
    try {
      if (inst) await api.patch(`/fees/instalments/${inst.id}`, body); else await api.post('/fees/instalments', body);
      await onDone(inst ? 'Instalment saved' : `${v.name} added`);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save'); }
    finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={save}>
      <Field label="Name" htmlFor="in" hint="For example: Quarter 1 (April to June)">
        <input id="in" className="input" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </Field>
      <div className="grid-2">
        <Field label="Due date" htmlFor="id"><input id="id" type="date" className="input" required value={v.dueOn} onChange={(e) => setV({ ...v, dueOn: e.target.value })} /></Field>
        <Field label="Grace days" htmlFor="ig" hint="Days after the due date before a fine starts">
          <input id="ig" className="input num" inputMode="numeric" value={v.graceDays} onChange={(e) => setV({ ...v, graceDays: e.target.value.replace(/\D/g, '') })} />
        </Field>
      </div>
      <Field label="Late fine" htmlFor="ft">
        <select id="ft" className="input" value={v.fineType} onChange={(e) => setV({ ...v, fineType: e.target.value as Instalment['fineType'] })}>
          <option value="none">No late fine</option><option value="flat">A fixed amount, once</option><option value="per_day">An amount for every day late</option>
        </select>
      </Field>
      {v.fineType !== 'none' ? (
        <div className="grid-2">
          <Field label={v.fineType === 'flat' ? 'Fine (₹)' : 'Fine per day (₹)'} htmlFor="fa">
            <input id="fa" className="input num" inputMode="decimal" value={v.fineAmount} onChange={(e) => setV({ ...v, fineAmount: e.target.value.replace(/[^\d.]/g, '') })} />
          </Field>
          {v.fineType === 'per_day' ? (
            <Field label="Maximum fine (₹)" htmlFor="fc" hint="Optional">
              <input id="fc" className="input num" inputMode="decimal" value={v.fineCap} onChange={(e) => setV({ ...v, fineCap: e.target.value.replace(/[^\d.]/g, '') })} />
            </Field>
          ) : null}
        </div>
      ) : null}
      <p className="small muted">The counter is shown the fine; the accountant can reduce or waive it when collecting.</p>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-primary" disabled={busy}>{inst ? 'Save instalment' : 'Add instalment'}</button>
        {inst && !inst.hasDues ? <button type="button" className="btn btn-danger" disabled={busy} onClick={async () => {
          if (!confirm(`Remove ${inst.name}?`)) return;
          try { await api.del(`/fees/instalments/${inst.id}`); await onDone('Instalment removed'); }
          catch (err) { setError(err instanceof ApiError ? err.message : 'Could not remove'); }
        }}>Remove</button> : null}
      </div>
    </form>
  );
}

function ClassFees({ setup, classId, onDone }: { setup: Setup; classId: string; onDone: (m: string) => Promise<void> }) {
  const heads = setup.heads.filter((h) => h.isActive);
  const key = (h: string, i: string) => `${h}|${i}`;
  const fromClass = (cid: string) => Object.fromEntries(setup.structure.filter((x) => x.classId === cid)
    .map((x) => [key(x.feeHeadId, x.instalmentId), String(Number(x.amount))]));
  const [vals, setVals] = useState<Record<string, string>>(fromClass(classId));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const instTotal = (i: string) => heads.reduce((a, h) => a + (Number(vals[key(h.id, i)]) || 0), 0);
  const others = setup.classes.filter((c) => c.id !== classId && setup.structure.some((x) => x.classId === c.id));

  return (
    <div className="stack">
      {others.length ? (
        <div className="row">
          <span className="small muted">Start from another class:</span>
          <select className="input" style={{ width: 160 }} aria-label="Copy from class" defaultValue=""
            onChange={(e) => e.target.value && setVals(fromClass(e.target.value))}>
            <option value="">Choose…</option>{others.map((c) => <option key={c.id} value={c.id}>{classLabel(c.name)}</option>)}
          </select>
        </div>
      ) : null}
      <div className="table-wrap">
        <table className="register" style={{ border: '1px solid var(--rule)' }}>
          <thead><tr><th>Fee type</th>{setup.instalments.map((i) => <th key={i.id} className="money">{i.name}</th>)}</tr></thead>
          <tbody>
            {heads.map((h) => (
              <tr key={h.id}>
                <td><strong>{h.name}</strong></td>
                {setup.instalments.map((i) => (
                  <td key={i.id} className="money">
                    <input className="input money-in" inputMode="decimal" aria-label={`${h.name}, ${i.name}`} placeholder="0"
                      value={vals[key(h.id, i.id)] ?? ''} onChange={(e) => setVals({ ...vals, [key(h.id, i.id)]: e.target.value.replace(/[^\d.]/g, '') })} />
                  </td>
                ))}
              </tr>
            ))}
            <tr><td><strong>Total</strong></td>{setup.instalments.map((i) => <td key={i.id} className="money"><strong>{inr(instTotal(i.id))}</strong></td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">Leave a box empty if that fee doesn&apos;t apply (for example, Admission only in the first instalment).</p>
      <ErrorBox error={error} />
      <div><button className="btn btn-primary" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try {
          const items = Object.entries(vals).filter(([, a]) => Number(a) > 0).map(([k, amount]) => {
            const [feeHeadId, instalmentId] = k.split('|'); return { feeHeadId, instalmentId, amount };
          });
          await api.put(`/fees/structure/${classId}`, { items });
          await onDone('Class fees saved. Remember step 4 to apply them to students.');
        } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
        finally { setBusy(false); }
      }}>Save class fees</button></div>
    </div>
  );
}

function GenerateDues({ setup, onDone }: { setup: Setup; onDone: (m: string) => Promise<void> }) {
  const [updateUnpaid, setUpdateUnpaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totalStudents = setup.classes.reduce((a, c) => a + c.students, 0);
  return (
    <section className="sheet sheet-pad stack">
      <h2>4. Apply fees to students</h2>
      <p className="small muted">Creates what each child owes from the class fees above. Safe to press again any time (for example after adding new students): it only adds what&apos;s missing.</p>
      <p><strong className="num">{setup.dues.students}</strong> of <strong className="num">{totalStudents}</strong> students have fees applied.</p>
      <label className="row small"><input type="checkbox" checked={updateUnpaid} onChange={(e) => setUpdateUnpaid(e.target.checked)} />
        Also change unpaid fees to the new amounts (fees someone has already paid towards are never changed)</label>
      <ErrorBox error={error} />
      <div><button className="btn btn-primary" disabled={busy || setup.structure.length === 0} onClick={async () => {
        setBusy(true); setError(null);
        try {
          const r = await api.post<{ added: number; updated: number; studentsWithFees: number }>('/fees/generate-dues', { updateUnpaid });
          await onDone(`Done: ${r.added} fee lines added${r.updated ? `, ${r.updated} updated` : ''}.`);
        } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not apply'); }
        finally { setBusy(false); }
      }}>Apply fees to students</button></div>
    </section>
  );
}
