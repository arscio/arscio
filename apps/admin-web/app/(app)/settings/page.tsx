'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { classLabel, type Structure } from '@/lib/types';
import { ApiError, api, fileUrl, readUpload } from '@/lib/api';
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
        <Identity key={`i-${s.logo_url}${s.brand_color}${s.short_name}${s.affiliation_no}`} onSaved={async (m) => { await reload(); toast.show(m); }} />
        <Attendance key={`a-${s.attendance_mode}${s.periods_per_day}`} onSaved={async () => { await reload(); toast.show('Attendance setting saved'); }} />
        <AdmissionNumbers onSaved={() => toast.show('Admission number format saved')} />
        <DocumentChecklist onSaved={(m) => toast.show(m)} />
        <Certificates onSaved={(m) => toast.show(m)} />
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

const COLOURS = ['#0B7FA6', '#0E7C5F', '#1F4E9A', '#7A1F3D', '#B54708', '#5B2A86', '#0B6E99', '#9A1F1F', '#2F3B4C'];

function Identity({ onSaved }: { onSaved: (m: string) => Promise<void> }) {
  const { info } = useSchool();
  const s = info.school;
  const [color, setColor] = useState(s.brand_color ?? '');
  const [shortName, setShortName] = useState(s.short_name ?? '');
  const [aff, setAff] = useState(s.affiliation_no ?? '');
  const { busy, error, run } = useSave();

  const upload = (file: File) => run(async () => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new ApiError(400, 'bad', 'Choose a PNG, JPG or WebP picture');
    if (file.size > 300 * 1024) throw new ApiError(400, 'big', 'The logo is too large. Please use a picture under 300 KB.');
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file);
    });
    await api.put('/school/logo', { dataUrl });
    await onSaved('Logo saved');
  });

  return (
    <div className="sheet sheet-pad stack">
      <div>
        <h2>School identity</h2>
        <p className="muted small" style={{ marginTop: 4 }}>
          Your logo and colour appear on what families see: the school website, the parent app, receipts and report cards.
          Staff screens like this one use the Arscio look.
        </p>
      </div>
      <div className="row" style={{ gap: 18, alignItems: 'center' }}>
        <div style={{ width: 88, height: 88, border: '1px dashed var(--rule-strong)', borderRadius: 8, display: 'grid', placeItems: 'center', background: '#fff' }}>
          {s.logo_url ? <img src={`/api/school-logo/${s.id}?${encodeURIComponent(s.logo_url)}`} alt="School logo" style={{ maxWidth: 80, maxHeight: 80 }} />
            : <span className="small muted">No logo</span>}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <label className="btn btn-plain" style={{ cursor: 'pointer' }}>
            {s.logo_url ? 'Change logo' : 'Upload logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
          </label>
          <span className="small muted">PNG, JPG or WebP, under 300 KB. A square picture works best.</span>
          {s.logo_url ? <button className="btn btn-quiet" style={{ alignSelf: 'flex-start' }} disabled={busy}
            onClick={() => confirm('Remove the logo?') && run(async () => { await api.del('/school/logo'); await onSaved('Logo removed'); })}>Remove logo</button> : null}
        </div>
      </div>
      <div className="field">
        <span className="label">School colour</span>
        <div className="row">
          {COLOURS.map((c) => (
            <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={color.toLowerCase() === c.toLowerCase()} onClick={() => setColor(c)}
              style={{ width: 34, height: 34, borderRadius: 999, background: c, border: color.toLowerCase() === c.toLowerCase() ? '3px solid var(--ink)' : '3px solid #fff', boxShadow: '0 0 0 1px var(--rule-strong)', cursor: 'pointer' }} />
          ))}
          <input type="color" aria-label="Other colour" value={color || '#0B7FA6'} onChange={(e) => setColor(e.target.value)} style={{ width: 44, height: 34, border: 0, background: 'none' }} />
        </div>
      </div>
      <div className="grid-2">
        <Field label="Short name" htmlFor="sh" hint="Shown where space is tight, for example GVPS">
          <input id="sh" className="input" maxLength={20} value={shortName} onChange={(e) => setShortName(e.target.value)} />
        </Field>
        <Field label="CBSE affiliation number" htmlFor="af" hint="Printed on receipts and report cards">
          <input id="af" className="input" maxLength={30} value={aff} onChange={(e) => setAff(e.target.value)} />
        </Field>
      </div>
      <ErrorBox error={error} />
      <div><button className="btn btn-primary" disabled={busy} onClick={() => run(async () => {
        await api.patch('/school/identity', { brandColor: color || null, shortName, affiliationNo: aff });
        await onSaved('School identity saved');
      })}>Save school identity</button></div>
    </div>
  );
}

function AdmissionNumbers({ onSaved }: { onSaved: () => void }) {
  const year = new Date().getFullYear();
  const [format, setFormat] = useState<string | null>(null);
  const [nextNo, setNextNo] = useState('');
  const [preview, setPreview] = useState('');
  const { busy, error, run } = useSave();
  useEffect(() => { api.get<{ format: string; next: string }>(`/students/admission-number?year=${year}`).then((r) => { setFormat(r.format); setPreview(r.next); }); }, [year]);
  if (format === null) return null;
  const code = preview.split(/[/-]/)[0] ?? '';
  const live = format.replace('{CODE}', code).replace('{YEAR}', String(year)).replace('{YY}', String(year).slice(2))
    .replace('{SEQ}', String(Number(nextNo) || Number(/(\d+)$/.exec(preview)?.[1] ?? 1)).padStart(4, '0'));
  return (
    <form className="sheet sheet-pad stack" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(async () => {
      await api.put('/school/admission-format', { format, ...(nextNo ? { year, nextNo: Number(nextNo) } : {}) }); setNextNo(''); onSaved();
    }); }}>
      <div><h2>Admission numbers</h2><p className="muted small" style={{ marginTop: 4 }}>
        Given automatically when a student is added. Each student keeps the number for life.</p></div>
      <ErrorBox error={error} />
      <div className="grid-2">
        <Field label="Format" htmlFor="af" hint="{CODE} school code, {YEAR} joining year, {YY} short year, {SEQ} running number">
          <input id="af" className="input num" value={format} onChange={(e) => setFormat(e.target.value)} />
        </Field>
        <Field label={`Next number for ${year}`} htmlFor="an" hint="Only if you are carrying on from your old register">
          <input id="an" className="input num" inputMode="numeric" placeholder="Leave as it is" value={nextNo} onChange={(e) => setNextNo(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small">The next student will get <strong className="num">{live}</strong></span>
        <button className="btn btn-primary" disabled={busy}>Save</button>
      </div>
    </form>
  );
}

interface DocType { id: string; name: string; category: string; requiredClasses: string[]; system: boolean }
function DocumentChecklist({ onSaved }: { onSaved: (m: string) => void }) {
  const [types, setTypes] = useState<DocType[] | null>(null);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [newName, setNewName] = useState('');
  const { error, run } = useSave();
  const load = () => api.get<{ types: DocType[] }>('/documents/types').then((r) => setTypes(r.types.filter((t) => t.category === 'admission' && !t.system)));
  useEffect(() => { void load(); api.get<Structure>('/setup/structure').then((s) => setClasses(s.classes.map((c) => ({ id: c.id, name: c.name })))); }, []);
  if (!types) return null;
  const toggle = (t: DocType, classId: string | 'all') => run(async () => {
    const all = classes.map((c) => c.id);
    const next = classId === 'all'
      ? (t.requiredClasses.length === all.length ? [] : all)
      : t.requiredClasses.includes(classId) ? t.requiredClasses.filter((x) => x !== classId) : [...t.requiredClasses, classId];
    await api.put(`/documents/types/${t.id}`, { requiredClasses: next });
    setTypes(types.map((x) => (x.id === t.id ? { ...x, requiredClasses: next } : x)));
  });
  return (
    <div className="sheet sheet-pad stack">
      <div><h2>Documents needed at admission</h2><p className="muted small" style={{ marginTop: 4 }}>
        Tick what each class must bring. The office sees a checklist in every student’s file.</p></div>
      <ErrorBox error={error} />
      <div className="table-wrap">
        <table className="register doc-matrix">
          <thead><tr><th>Document</th><th className="c">All</th>{classes.map((c) => <th key={c.id} className="c">{classLabel(c.name).replace('Class ', '')}</th>)}</tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <th scope="row">{t.name}</th>
                <td className="c"><input type="checkbox" aria-label={`${t.name}: all classes`} checked={classes.length > 0 && t.requiredClasses.length === classes.length} onChange={() => void toggle(t, 'all')} /></td>
                {classes.map((c) => (
                  <td key={c.id} className="c"><input type="checkbox" aria-label={`${t.name}: ${classLabel(c.name)}`}
                    checked={t.requiredClasses.includes(c.id)} onChange={() => void toggle(t, c.id)} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(async () => {
        await api.post('/documents/types', { name: newName }); setNewName(''); await load(); onSaved(`${newName} added to the list`);
      }); }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder="Another document, e.g. Migration certificate" aria-label="New document name"
          value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn btn-plain" disabled={newName.trim().length < 2}>Add to the list</button>
      </form>
    </div>
  );
}

interface CertSettings {
  kinds: { kind: string; title: string; signMode: 'printed' | 'hand'; signerRole: 'principal' | 'owner' }[];
  signatures: { role: 'principal' | 'owner'; defaultTitle: string; uploaded: boolean; signerName: string | null; signerTitle: string | null; updatedAt: string | null }[];
}
function Certificates({ onSaved }: { onSaved: (m: string) => void }) {
  const [c, setC] = useState<CertSettings | null>(null);
  const [v, setV] = useState(0);
  const { error, run } = useSave();
  useEffect(() => { api.get<CertSettings>('/certificates/settings').then(setC); }, [v]);
  if (!c) return null;
  const setKind = (kind: string, patch: Partial<CertSettings['kinds'][number]>) => run(async () => {
    const k = { ...c.kinds.find((x) => x.kind === kind)!, ...patch };
    await api.put(`/certificates/settings/${kind}`, { signMode: k.signMode, signerRole: k.signerRole });
    setC({ ...c, kinds: c.kinds.map((x) => (x.kind === kind ? k : x)) });
    onSaved(`${k.title}: saved`);
  });
  return (
    <div className="sheet sheet-pad stack">
      <div><h2>Certificates and signatures</h2><p className="muted small" style={{ marginTop: 4 }}>
        For each certificate, choose a printed signature or signing by hand, and whose signature it is.</p></div>
      <ErrorBox error={error} />
      <table className="register cert-settings">
        <thead><tr><th>Certificate</th><th>How it is signed</th><th>Signed by</th></tr></thead>
        <tbody>
          {c.kinds.map((k) => (
            <tr key={k.kind}>
              <th scope="row">{k.title}</th>
              <td>
                <div className="seg" role="radiogroup" aria-label={`${k.title}: how it is signed`}>
                  <button type="button" role="radio" aria-checked={k.signMode === 'printed'} className={k.signMode === 'printed' ? 'on' : ''} onClick={() => void setKind(k.kind, { signMode: 'printed' })}>Printed signature</button>
                  <button type="button" role="radio" aria-checked={k.signMode === 'hand'} className={k.signMode === 'hand' ? 'on' : ''} onClick={() => void setKind(k.kind, { signMode: 'hand' })}>By hand</button>
                </div>
              </td>
              <td>
                <select className="input" style={{ padding: '7px 10px' }} aria-label={`${k.title}: signed by`} value={k.signerRole}
                  onChange={(e) => void setKind(k.kind, { signerRole: e.target.value as 'principal' | 'owner' })}>
                  <option value="principal">Principal</option><option value="owner">Owner / director</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid-2">
        {c.signatures.map((s) => <SignatureCard key={s.role} s={s} onSaved={() => { setV((x) => x + 1); onSaved('Signature saved'); }}
          needed={c.kinds.some((k) => k.signMode === 'printed' && k.signerRole === s.role)} />)}
      </div>
    </div>
  );
}

function SignatureCard({ s, needed, onSaved }: { s: CertSettings['signatures'][number]; needed: boolean; onSaved: () => void }) {
  const [name, setName] = useState(s.signerName ?? '');
  const [title, setTitle] = useState(s.signerTitle ?? '');
  const [img, setImg] = useState<string | null>(null);
  const { busy, error, run } = useSave();
  const who = s.role === 'principal' ? 'Principal' : 'Owner / director';
  return (
    <form className={`sig-card ${needed && !s.uploaded ? 'is-needed' : ''}`} onSubmit={(e: FormEvent) => { e.preventDefault(); void run(async () => {
      await api.put(`/signatures/${s.role}`, { signerName: name, signerTitle: title || null, ...(img ? { dataUrl: img } : {}) }); setImg(null); onSaved();
    }); }}>
      <strong>{who}’s signature</strong>
      {needed && !s.uploaded ? <div className="small" style={{ color: '#8A4B05' }}>Needed: a certificate is set to use it.</div> : null}
      <label className="sig-box">
        {img ? <img src={img} alt="New signature" /> : s.uploaded ? <img src={`${fileUrl(`/signatures/${s.role}/image`)}?v=${s.updatedAt}`} alt={`${who} signature`} /> : <span className="muted small">Upload a photo of the signature on white paper (PNG or JPG)</span>}
        <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = ''; if (f) setImg(await readUpload(f, { maxSide: 600, quality: 0.9, alwaysShrink: true }));
        }} />
      </label>
      <ErrorBox error={error} />
      <div className="grid-2" style={{ gap: 8 }}>
        <input className="input" aria-label="Name printed under the signature" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" aria-label="Title printed under the signature" placeholder={s.defaultTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <button className="btn btn-plain" disabled={busy || name.trim().length < 2 || (!img && !s.uploaded)}>{busy ? 'Saving…' : 'Save signature'}</button>
    </form>
  );
}
