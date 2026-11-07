'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { useSchool } from '@/components/AppShell';
import { ErrorBox, Field, useToast } from '@/components/ui';

export default function SettingsPage() {
  const { info, reload } = useSchool();
  const s = info.school;
  const toast = useToast();

  return (
    <>
      <div className="page-head"><div><h1>School settings</h1><p>Only the owner and principal can change these.</p></div></div>
      <div className="stack" style={{ gap: 22, maxWidth: 760 }}>
        <Profile key={`p-${s.name}${s.address}${s.phone}${s.email}`} onSaved={async () => { await reload(); toast.show('School details saved'); }} />
        <Attendance key={`a-${s.attendance_mode}${s.periods_per_day}`} onSaved={async () => { await reload(); toast.show('Attendance setting saved'); }} />
        <Payments key={`o-${s.online_payments_enabled}`} onSaved={async (on) => { await reload(); toast.show(on ? 'Online payment is ON' : 'Online payment is OFF'); }} />
      </div>
      {toast.node}
    </>
  );
}

function useSave() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };
  return { busy, error, run };
}

function Profile({ onSaved }: { onSaved: () => Promise<void> }) {
  const { info } = useSchool();
  const s = info.school;
  const [v, setV] = useState({ name: s.name, address: s.address ?? '', phone: s.phone ?? '', email: s.email ?? '' });
  const { busy, error, run } = useSave();
  const save = (e: FormEvent) => { e.preventDefault(); void run(async () => { await api.patch('/school/profile', v); await onSaved(); }); };
  return (
    <form className="sheet sheet-pad stack" onSubmit={save}>
      <div><h2>School details</h2><p className="muted small" style={{ marginTop: 4 }}>Printed on receipts and report cards.</p></div>
      <Field label="School name" htmlFor="sn"><input id="sn" className="input" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <Field label="Address" htmlFor="sa"><textarea id="sa" className="input" rows={2} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
      <div className="grid-2">
        <Field label="Office phone" htmlFor="sp"><input id="sp" className="input num" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label="Email" htmlFor="se"><input id="se" type="email" className="input" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
      </div>
      <ErrorBox error={error} />
      <div><button className="btn btn-primary" disabled={busy}>Save school details</button></div>
    </form>
  );
}

function Attendance({ onSaved }: { onSaved: () => Promise<void> }) {
  const { info } = useSchool();
  const [mode, setMode] = useState(info.school.attendance_mode);
  const [periods, setPeriods] = useState(String(info.school.periods_per_day));
  const { busy, error, run } = useSave();
  const changed = mode !== info.school.attendance_mode || Number(periods) !== info.school.periods_per_day;
  return (
    <div className="sheet sheet-pad stack">
      <div><h2>Attendance</h2><p className="muted small" style={{ marginTop: 4 }}>How often teachers take attendance in the teacher app.</p></div>
      <div className="grid-2" role="radiogroup" aria-label="Attendance mode">
        {([['daily', 'Once a day', 'The class teacher marks it in the morning.'],
           ['period', 'Every period', 'Each subject teacher marks it in their period.']] as const).map(([val, title, what]) => (
          <label key={val} className="check" style={{ borderRadius: 'var(--r-md)', alignItems: 'flex-start', padding: '12px 14px' }}>
            <input type="radio" name="mode" checked={mode === val} onChange={() => setMode(val)} style={{ marginTop: 3 }} />
            <span><strong>{title}</strong><br /><span className="small muted">{what}</span></span>
          </label>
        ))}
      </div>
      {mode === 'period' ? (
        <Field label="Periods in a day" htmlFor="ppd">
          <input id="ppd" className="input num" style={{ width: 100 }} inputMode="numeric" value={periods}
            onChange={(e) => setPeriods(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        </Field>
      ) : null}
      <ErrorBox error={error} />
      <div><button className="btn btn-primary" disabled={busy || !changed}
        onClick={() => run(async () => {
          await api.patch('/school/settings', { attendanceMode: mode, ...(mode === 'period' ? { periodsPerDay: Number(periods) } : {}) });
          await onSaved();
        })}>Save attendance setting</button></div>
    </div>
  );
}

function Payments({ onSaved }: { onSaved: (on: boolean) => Promise<void> }) {
  const { info } = useSchool();
  const on = info.school.online_payments_enabled;
  const [keyId, setKeyId] = useState('');
  const { busy, error, run } = useSave();
  return (
    <div className="sheet sheet-pad stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Online fee payment</h2>
        <span className={`tag ${on ? 'tag-board' : ''}`}>{on ? 'ON' : 'OFF'}</span>
      </div>
      <p className="small muted">
        When ON, parents can pay fees in the parent app with UPI or card through Razorpay. The money goes straight
        to the school&apos;s own Razorpay account and a receipt is made automatically. When OFF, fees are paid at the office.
      </p>
      {!on ? (
        <Field label="School's Razorpay Key ID" htmlFor="rk" hint="Starts with rzp_live_ or rzp_test_. The school gets this from its own Razorpay account.">
          <input id="rk" className="input" value={keyId} onChange={(e) => setKeyId(e.target.value.trim())} />
        </Field>
      ) : null}
      <ErrorBox error={error} />
      <div>
        {on ? (
          <button className="btn btn-danger" disabled={busy}
            onClick={() => confirm('Turn OFF online payment? Parents will pay at the office.') &&
              run(async () => { await api.patch('/school/settings', { onlinePaymentsEnabled: false }); await onSaved(false); })}>
            Turn off online payment</button>
        ) : (
          <button className="btn btn-primary" disabled={busy || !keyId}
            onClick={() => run(async () => {
              await api.patch('/school/settings', { onlinePaymentsEnabled: true, razorpayKeyId: keyId }); await onSaved(true);
            })}>Turn on online payment</button>
        )}
      </div>
    </div>
  );
}
