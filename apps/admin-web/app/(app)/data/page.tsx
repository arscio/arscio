'use client';
// Excel import and export: download any list, or bring in students, staff and marks from any Excel file.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, fileUrl } from '@/lib/api';
import { classLabel, sectionLabel } from '@/lib/types';
import { useSchool } from '@/components/AppShell';
import { ErrorBox, Field, Loading, useToast } from '@/components/ui';

type Kind = 'students' | 'staff' | 'marks';
interface FieldDef { key: string; label: string; required?: boolean; hint?: string }
interface Options {
  exports: { kind: string; label: string }[];
  sections: { id: string; classId: string; className: string; name: string }[];
  terms: { id: string; name: string }[];
  exams: { id: string; name: string; termName: string; classIds: string[]; locked: boolean; max: number }[];
}
interface ReadResult { fields: FieldDef[]; sheets: { name: string; headers: string[]; rowCount: number; sample: (string | null)[][]; suggested: Record<string, number | null> }[] }
interface CheckRow { row: number; status: 'ok' | 'error' | 'skip'; messages: string[]; show: Record<string, string | null> }
interface Batch { id: string; kind: Kind; fileName: string; total: number; ok: number; failed: number; createdAt: string; undoneAt: string | null; importedBy: string | null; label: string | null }

const EXPORT_HELP: Record<string, string> = {
  students: 'Every detail of each student and family. Choose a class, or all.',
  staff: 'Names, mobile numbers, roles and designations.',
  attendance: 'One class, one month: P, A, L for each day, with totals.',
  fees: 'What each student owes and has paid this year. Also a sheet with one line per student.',
  receipts: 'Every receipt between two dates, including cancelled ones.',
  marks: 'One sheet per exam in a term, subjects across.',
  register: 'Admission and withdrawal register, every student ever admitted.',
  certificates: 'Transfer, bonafide and character certificates issued.',
  leave: 'Teacher leave between two dates.',
};
const KIND_LABEL: Record<Kind, string> = { students: 'Students and families', staff: 'Staff', marks: 'Marks' };
const when = (s: string) => new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function DataPage() {
  const [tab, setTab] = useState<'export' | 'import' | 'history'>('export');
  const [o, setO] = useState<Options | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => { api.get<Options>('/data/options').then(setO).catch((e) => setErr(e.message)); }, []);
  if (err) return <ErrorBox error={err} />;
  if (!o) return <Loading />;
  return (
    <>
      <div className="page-head"><div><h1>Excel import and export</h1>
        <p>Download any list as an Excel file, or bring in students, staff and marks from your own Excel files.</p></div></div>
      <nav className="tabs" aria-label="Excel">
        {(['export', 'import', 'history'] as const).map((t) => (
          <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
            {t === 'export' ? 'Download' : t === 'import' ? 'Import' : 'Past imports'}
          </button>
        ))}
      </nav>
      {tab === 'export' ? <Exports o={o} /> : tab === 'import'
        ? <Import o={o} onDone={(m) => { toast.show(m); setTab('history'); }} />
        : <History onUndone={(m) => toast.show(m)} />}
      {toast.node}
    </>
  );
}

// ======================= Download =======================

function Exports({ o }: { o: Options }) {
  const { can } = useSchool();
  const [kind, setKind] = useState('students');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [f, setF] = useState({ classId: '', sectionId: '', status: 'active', month: today.slice(0, 7), from: `${today.slice(0, 7)}-01`, to: today, termId: o.terms[0]?.id ?? '', onlyDue: false });
  const needsFees = kind === 'fees' || kind === 'receipts';
  const classes = useMemo(() => [...new Map(o.sections.map((s) => [s.classId, s.className])).entries()], [o.sections]);
  const q = new URLSearchParams();
  if (['students', 'fees'].includes(kind)) { if (f.sectionId) q.set('sectionId', f.sectionId); else if (f.classId) q.set('classId', f.classId); }
  if (kind === 'students') q.set('status', f.status);
  if (kind === 'attendance') { if (f.sectionId) q.set('sectionId', f.sectionId); q.set('month', f.month); }
  if (kind === 'marks') { if (f.sectionId) q.set('sectionId', f.sectionId); if (f.termId) q.set('termId', f.termId); }
  if (['receipts', 'leave'].includes(kind)) { q.set('from', f.from); q.set('to', f.to); }
  if (kind === 'fees' && f.onlyDue) q.set('onlyDue', '1');
  const missing = (['attendance', 'marks'].includes(kind) && !f.sectionId) || (kind === 'marks' && !f.termId);
  const sectionSelect = (allowAll: boolean) => (
    <Field label="Class" htmlFor="xs">
      <select id="xs" className="input" value={f.sectionId || (allowAll && f.classId ? `c:${f.classId}` : '')} onChange={(e) => {
        const v = e.target.value;
        setF({ ...f, sectionId: v.startsWith('c:') || !v ? '' : v, classId: v.startsWith('c:') ? v.slice(2) : '' });
      }}>
        <option value="">{allowAll ? 'All classes' : 'Choose…'}</option>
        {classes.map(([cid, cname]) => (
          <optgroup key={cid} label={classLabel(cname)}>
            {allowAll ? <option value={`c:${cid}`}>{classLabel(cname)}, all sections</option> : null}
            {o.sections.filter((s) => s.classId === cid).map((s) => <option key={s.id} value={s.id}>{sectionLabel(s.className, s.name)}</option>)}
          </optgroup>
        ))}
      </select>
    </Field>
  );
  return (
    <div className="data-export">
      <div className="data-kinds" role="radiogroup" aria-label="What to download">
        {o.exports.map((x) => {
          const off = (x.kind === 'fees' || x.kind === 'receipts') && !can('fees.view_reports');
          return (
            <button key={x.kind} type="button" role="radio" aria-checked={kind === x.kind} disabled={off}
              className={`data-kind ${kind === x.kind ? 'on' : ''}`} onClick={() => setKind(x.kind)}>
              <strong>{x.label}</strong><span>{off ? 'Needs the fee reports right' : EXPORT_HELP[x.kind]}</span>
            </button>
          );
        })}
      </div>
      <div className="sheet sheet-pad stack data-filters">
        <h2>{o.exports.find((x) => x.kind === kind)!.label}</h2>
        <div className="grid-2">
          {kind === 'students' ? <>{sectionSelect(true)}
            <Field label="Who" htmlFor="xw"><select id="xw" className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="active">Studying here now</option><option value="left">Left or passed out</option><option value="all">Everyone</option></select></Field></> : null}
          {kind === 'fees' ? <>{sectionSelect(true)}
            <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.onlyDue} onChange={(e) => setF({ ...f, onlyDue: e.target.checked })} /> Only fees still due</label></> : null}
          {kind === 'attendance' ? <>{sectionSelect(false)}
            <Field label="Month" htmlFor="xm"><input id="xm" type="month" className="input" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} /></Field></> : null}
          {kind === 'marks' ? <>{sectionSelect(false)}
            <Field label="Term" htmlFor="xt"><select id="xt" className="input" value={f.termId} onChange={(e) => setF({ ...f, termId: e.target.value })}>
              {o.terms.length ? o.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>) : <option value="">No terms yet</option>}</select></Field></> : null}
          {kind === 'receipts' || kind === 'leave' ? <>
            <Field label="From" htmlFor="xf"><input id="xf" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
            <Field label="To" htmlFor="xto"><input id="xto" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></> : null}
        </div>
        {['staff', 'register', 'certificates'].includes(kind) ? <p className="small muted" style={{ margin: 0 }}>Everything is included.</p> : null}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <a className={`btn btn-primary ${missing || (needsFees && !can('fees.view_reports')) ? 'is-disabled' : ''}`} aria-disabled={missing}
            href={missing ? undefined : fileUrl(`/data/export/${kind}?${q.toString()}`)}>Download Excel file</a>
        </div>
      </div>
    </div>
  );
}

// ======================= Import =======================

function Import({ o, onDone }: { o: Options; onDone: (m: string) => void }) {
  const { can } = useSchool();
  const [kind, setKind] = useState<Kind>('students');
  const [examId, setExamId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [file, setFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [read, setRead] = useState<ReadResult | null>(null);
  const [sheet, setSheet] = useState(0);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [skipExisting, setSkipExisting] = useState(true);
  const [checked, setChecked] = useState<{ counts: { ok: number; error: number; skip: number }; rows: CheckRow[] } | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const exam = o.exams.find((x) => x.id === examId);
  const sectionsForExam = o.sections.filter((s) => !exam || !exam.classIds.length || exam.classIds.includes(s.classId));
  const ready = kind !== 'marks' || (examId && sectionId);
  const extra = kind === 'marks' ? { examId, sectionId } : {};
  const reset = () => { setFile(null); setRead(null); setChecked(null); setErr(null); };
  const call = async <T,>(label: string, fn: () => Promise<T>) => {
    setBusy(label); setErr(null);
    try { return await fn(); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Something went wrong. Please try again.'); return null; } finally { setBusy(null); }
  };

  const choose = async (f: File) => {
    reset();
    const dataUrl = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(f); });
    setFile({ name: f.name, dataUrl });
    const r = await call('read', () => api.post<ReadResult>('/data/import/read', { kind, fileName: f.name, dataUrl, ...extra }));
    if (r) { setRead(r); setSheet(0); setMapping(r.sheets[0]!.suggested); }
  };
  const body = () => ({ kind, fileName: file!.name, dataUrl: file!.dataUrl, sheet: read!.sheets[sheet]!.name, mapping, skipExisting, ...extra });
  const doCheck = async () => { const r = await call('check', () => api.post<typeof checked>('/data/import/check', body())); if (r) setChecked(r); };
  const doRun = async () => {
    const r = await call('run', () => api.post<{ counts: { ok: number } }>('/data/import/run', body()));
    if (r) { onDone(`${r.counts.ok} rows imported. You can undo this from Past imports.`); reset(); }
  };

  const s = read?.sheets[sheet];
  const shownCols = checked ? [...new Set(checked.rows.flatMap((r) => Object.keys(r.show)))] : [];
  const showLabel = (k: string) => ({ name: 'Name', admissionNo: 'Admission no.', class: 'Class', phone: 'Mobile', father: 'Father', roles: 'Role', designation: 'Designation' } as Record<string, string>)[k] ?? k;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="sheet sheet-pad stack">
        <h2>1. What are you importing?</h2>
        <div className="seg" role="radiogroup" aria-label="What to import">
          {(['students', 'staff', 'marks'] as Kind[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''}
              disabled={k === 'staff' && !can('roles.assign')} onClick={() => { setKind(k); reset(); }}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        {kind === 'marks' ? (
          <div className="grid-2">
            <Field label="Exam" htmlFor="ie"><select id="ie" className="input" value={examId} onChange={(e) => { setExamId(e.target.value); reset(); }}>
              <option value="">Choose…</option>
              {o.exams.map((x) => <option key={x.id} value={x.id} disabled={x.locked}>{x.termName}: {x.name}{x.locked ? ' (locked)' : ''}</option>)}</select></Field>
            <Field label="Class" htmlFor="ic"><select id="ic" className="input" value={sectionId} onChange={(e) => { setSectionId(e.target.value); reset(); }}>
              <option value="">Choose…</option>
              {sectionsForExam.map((x) => <option key={x.id} value={x.id}>{sectionLabel(x.className, x.name)}</option>)}</select></Field>
          </div>
        ) : null}
        <p className="small" style={{ margin: 0 }}>
          {kind === 'marks' ? 'Any file with an admission number, roll number or name column and one column per subject works. ' : 'Any Excel or CSV file works; you match its columns next. '}
          {ready ? <a className="btn-link" href={fileUrl(`/data/templates/${kind}${kind === 'marks' ? `?examId=${examId}&sectionId=${sectionId}` : ''}`)}>
            {kind === 'marks' ? 'Download a sheet with this class’s students' : 'Download a ready template'}</a> : null}
        </p>
        <div className="drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && ready) void choose(f); }}>
          <input ref={input} id="if" type="file" className="sr-only" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            disabled={!ready} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void choose(f); }} />
          {busy === 'read' ? <span>Opening {file?.name}…</span> : file && read
            ? <span><strong>{file.name}</strong> <span className="muted">· {s!.rowCount} rows</span> <label htmlFor="if" className="btn-link">Choose another file</label></span>
            : ready ? <span>Drop the Excel file here, or <label htmlFor="if" className="btn-link">choose a file</label>. <span className="muted">.xlsx or .csv, up to 10 MB.</span></span>
              : <span className="muted">Choose the exam and class first.</span>}
        </div>
        <ErrorBox error={!read ? err : null} />
      </div>

      {read && s ? (
        <div className="sheet sheet-pad stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>2. Match the columns</h2>
            {read.sheets.length > 1 ? (
              <select className="input" style={{ maxWidth: 220 }} aria-label="Sheet" value={sheet} onChange={(e) => { const i = Number(e.target.value); setSheet(i); setMapping(read.sheets[i]!.suggested); setChecked(null); }}>
                {read.sheets.map((x, i) => <option key={x.name} value={i}>Sheet: {x.name} ({x.rowCount} rows)</option>)}
              </select>
            ) : null}
          </div>
          <p className="small muted" style={{ margin: 0 }}>We guessed from the headings. Fix anything that’s wrong; leave a field as “Not in my file” if you don’t have it.</p>
          <table className="register map-table">
            <thead><tr><th>In Arscio</th><th>Column in your file</th><th>First row says</th></tr></thead>
            <tbody>
              {read.fields.map((f) => {
                const col = mapping[f.key];
                const sample = col != null ? s.sample[0]?.[col] ?? '' : '';
                return (
                  <tr key={f.key} className={col == null && f.required ? 'needs' : ''}>
                    <th scope="row">{f.label}{f.required ? <span aria-label="needed"> *</span> : null}{f.hint ? <div className="small muted" style={{ fontWeight: 400 }}>{f.hint}</div> : null}</th>
                    <td>
                      <select className="input" aria-label={`Column for ${f.label}`} value={col ?? ''} onChange={(e) => { setMapping({ ...mapping, [f.key]: e.target.value === '' ? null : Number(e.target.value) }); setChecked(null); }}>
                        <option value="">Not in my file</option>
                        {s.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    </td>
                    <td className="small">{sample}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {kind === 'students' ? <label className="check"><input type="checkbox" checked={skipExisting} onChange={(e) => { setSkipExisting(e.target.checked); setChecked(null); }} />
            Skip students whose admission number is already in Arscio</label> : null}
          <ErrorBox error={!checked ? err : null} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => void doCheck()}>{busy === 'check' ? 'Checking…' : 'Check the file'}</button>
          </div>
        </div>
      ) : null}

      {checked ? (
        <div className="sheet sheet-pad stack">
          <h2>3. Check and import</h2>
          <ul className="ny-summary">
            <li><strong>{checked.counts.ok}</strong> ready</li>
            <li className={checked.counts.error ? 'is-bad' : ''}><strong>{checked.counts.error}</strong> with problems</li>
            <li><strong>{checked.counts.skip}</strong> skipped</li>
          </ul>
          {checked.counts.error ? <p className="small" style={{ margin: 0 }}>Rows with problems are left out. Fix them in your file and import it again later; rows already imported will be skipped.</p> : null}
          <label className="check" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows with problems</label>
          <div className="table-wrap check-wrap">
            <table className="register check-table">
              <thead><tr><th>Row</th><th></th>{shownCols.map((c) => <th key={c}>{showLabel(c)}</th>)}<th>Notes</th></tr></thead>
              <tbody>
                {checked.rows.filter((r) => !onlyProblems || r.status === 'error').map((r) => (
                  <tr key={r.row} className={`is-${r.status}`}>
                    <td className="num muted">{r.row}</td>
                    <td><span className={`pill pill-${r.status}`}>{r.status === 'ok' ? 'Ready' : r.status === 'error' ? 'Problem' : 'Skip'}</span></td>
                    {shownCols.map((c) => <td key={c}>{r.show[c] ?? ''}</td>)}
                    <td className="small">{r.messages.map((m) => <div key={m}>{m}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ErrorBox error={err} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={!!busy || !checked.counts.ok} onClick={() => void doRun()}>
              {busy === 'run' ? 'Importing…' : `Import ${checked.counts.ok} row${checked.counts.ok === 1 ? '' : 's'}`}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ======================= Past imports =======================

function History({ onUndone }: { onUndone: (m: string) => void }) {
  const [list, setList] = useState<Batch[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState(0);
  useEffect(() => { api.get<{ imports: Batch[] }>('/data/imports').then((r) => setList(r.imports)).catch((e) => setErr(e.message)); }, [v]);
  if (!list) return err ? <ErrorBox error={err} /> : <Loading />;
  return (
    <div className="sheet table-wrap">
      <ErrorBox error={err} />
      <table className="register">
        <thead><tr><th>When</th><th>What</th><th>File</th><th className="c">Imported</th><th className="c">Left out</th><th>By</th><th></th></tr></thead>
        <tbody>
          {list.map((b) => (
            <tr key={b.id} className={b.undoneAt ? 'muted' : ''}>
              <td className="num">{when(b.createdAt)}</td>
              <td>{KIND_LABEL[b.kind]}{b.label ? <div className="small muted">{b.label}</div> : null}</td>
              <td className="small">{b.fileName}</td>
              <td className="c num">{b.ok}</td><td className="c num">{b.failed}</td>
              <td>{b.importedBy}</td>
              <td>{b.undoneAt ? <span className="small">Undone {when(b.undoneAt)}</span> : (
                <button className="btn btn-quiet" style={{ padding: '6px 12px' }} onClick={async () => {
                  if (!confirm(b.kind === 'marks' ? 'Put the marks back as they were before this import?' : `Remove everything this import added (${b.ok} rows)?`)) return;
                  setErr(null);
                  try { await api.post(`/data/imports/${b.id}/undo`, {}); onUndone('Import undone'); setV((x) => x + 1); }
                  catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not undo'); }
                }}>Undo</button>
              )}</td>
            </tr>
          ))}
          {!list.length ? <tr><td colSpan={7} className="muted">Nothing imported yet.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
