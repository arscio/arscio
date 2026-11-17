'use client';
// The digital student file: photo, checklist, documents (view on screen, download one or all).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, fileUrl, photoSrc, readUpload } from '@/lib/api';
import { classLabel } from '@/lib/types';
import { ErrorBox, Field, Loading, useToast } from './ui';
import { IssueCertificate } from './IssueCertificate';

export interface Doc {
  id: string; label: string; yearName: string | null; fileName: string; mime: string; size: number;
  source: 'upload' | 'system'; createdAt: string; uploadedBy: string | null; typeId: string | null; typeName: string | null;
  category: 'admission' | 'report_card' | 'certificate' | 'other'; history?: Doc[];
}
interface FileData {
  student: { id: string; name: string; admissionNo: string; photoUrl: string | null; aadhaarLast4: string | null; status: string; className: string | null; sectionName: string | null };
  checklist: { typeId: string; name: string; done: boolean }[];
  missing: number;
  types: { id: string; name: string; asksForClass: boolean }[];
  documents: Doc[];
}

const initialsOf = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const day = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Photo chooser used on the admission form (the picture is uploaded after the student is saved). */
export function PhotoPicker({ value, onChange }: { value: string | null; onChange: (dataUrl: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="photo-pick">
      <button type="button" className="photo-round" onClick={() => input.current?.click()} aria-label={value ? 'Change photo' : 'Add photo'}>
        {value ? <img src={value} alt="" /> : <PhotoGlyph />}
      </button>
      <div className="small">
        <button type="button" className="btn-link" onClick={() => input.current?.click()}>{value ? 'Change photo' : 'Add photo'}</button>
        {value ? <> · <button type="button" className="btn-link" onClick={() => onChange(null)}>Remove</button></> : null}
        <div className="muted">Shows on the ID card, receipts, report cards and the apps.</div>
      </div>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden
        onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onChange(await readUpload(f, { maxSide: 640, alwaysShrink: true })); }} />
    </div>
  );
}

function PhotoGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" strokeLinejoin="round" /><circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function StudentFile({ studentId }: { studentId: string }) {
  const [f, setF] = useState<FileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Doc | null>(null);
  const [replacing, setReplacing] = useState<Doc | null>(null);
  const [v, setV] = useState(0);
  const [issuing, setIssuing] = useState(false);
  const [openAfterLoad, setOpenAfterLoad] = useState<string | null>(null);
  const toast = useToast();
  const reload = () => setV((x) => x + 1);

  useEffect(() => { api.get<FileData>(`/students/${studentId}/file`).then(setF).catch((e) => setError(e.message)); }, [studentId, v]);
  // After issuing a certificate, open it straight away so it can be printed
  useEffect(() => {
    if (!f || !openAfterLoad) return;
    const d = f.documents.find((x) => x.id === openAfterLoad);
    if (d) { setViewing(d); setOpenAfterLoad(null); }
  }, [f, openAfterLoad]);
  if (error) return <ErrorBox error={error} />;
  if (!f) return <Loading />;

  const groups: { key: Doc['category']; title: string; empty: string }[] = [
    { key: 'admission', title: 'Admission documents', empty: 'Nothing uploaded yet. Use “Add a document” to file the birth certificate, TC and others.' },
    { key: 'report_card', title: 'Report cards', empty: 'Report cards are filed here automatically each year when the class moves up.' },
    { key: 'certificate', title: 'Certificates issued', empty: 'Transfer, bonafide and character certificates issued by the school appear here.' },
    { key: 'other', title: 'Other', empty: '' },
  ];
  const done = f.checklist.filter((c) => c.done).length;

  return (
    <div className="file-layout">
      <aside className="stack" style={{ gap: 18 }}>
        <PhotoCard f={f} onChanged={() => { reload(); toast.show('Photo saved. It now shows everywhere.'); }} />
        <div className="sheet sheet-pad stack" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: '1.05rem' }}>Needed at admission</h2>
            {f.checklist.length ? <span className={`tag ${f.missing ? 'tag-warn' : ''}`}>{done} of {f.checklist.length}</span> : null}
          </div>
          {f.checklist.length ? (
            <ul className="file-checklist">
              {f.checklist.map((c) => (
                <li key={c.typeId} className={c.done ? 'is-done' : ''}>
                  <span className="file-tick" aria-hidden>{c.done ? '✓' : ''}</span>
                  {c.name}<span className="sr-only">{c.done ? ' (in the file)' : ' (missing)'}</span>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">No documents are required for this class. The principal sets this in Settings.</p>}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setIssuing(true)}>Issue a certificate</button>
        <a className="btn btn-plain" href={fileUrl(`/students/${studentId}/file.zip`)}
          aria-disabled={!f.documents.length} onClick={(e) => { if (!f.documents.length) { e.preventDefault(); toast.show('There are no documents to download yet'); } }}>
          Download the whole file (ZIP)
        </a>
      </aside>

      <div className="stack" style={{ gap: 18 }}>
        <AddDocument f={f} replacing={replacing} onCancelReplace={() => setReplacing(null)}
          onSaved={(label) => { setReplacing(null); reload(); toast.show(`${label} added to the file`); }} />
        {groups.map((g) => {
          const docs = f.documents.filter((d) => d.category === g.key);
          if (!docs.length && !g.empty) return null;
          // Report cards are shown newest year first
          const sorted = g.key === 'report_card' ? [...docs].sort((a, b) => (b.yearName ?? '').localeCompare(a.yearName ?? '')) : docs;
          return (
            <section key={g.key} className="sheet file-group" aria-labelledby={`g-${g.key}`}>
              <h2 id={`g-${g.key}`}>{g.title}{docs.length ? <span className="muted"> ({docs.length})</span> : null}</h2>
              {sorted.length ? (
                <ul className="doc-list">
                  {sorted.map((d) => <DocRow key={d.id} d={d} onView={setViewing}
                    onReplace={d.source === 'upload' ? () => { setReplacing(d); window.scrollTo({ top: 0, behavior: 'smooth' }); } : undefined} />)}
                </ul>
              ) : <p className="muted small" style={{ padding: '4px 20px 18px' }}>{g.empty}</p>}
            </section>
          );
        })}
      </div>
      {viewing ? <Viewer d={viewing} onClose={() => setViewing(null)} /> : null}
      <IssueCertificate studentId={studentId} open={issuing} onClose={() => setIssuing(false)}
        onIssued={(docId, serial) => { setIssuing(false); setOpenAfterLoad(docId); reload(); toast.show(`Certificate ${serial} issued and saved in the file`); }} />
      {toast.node}
    </div>
  );
}

function PhotoCard({ f, onChanged }: { f: FileData; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editAadhaar, setEditAadhaar] = useState(false);
  const [aadhaar, setAadhaar] = useState(f.student.aadhaarLast4 ?? '');
  const s = f.student;
  const upload = async (file: File) => {
    setBusy(true); setErr(null);
    try { await api.put(`/students/${s.id}/photo`, { dataUrl: await readUpload(file, { maxSide: 640, alwaysShrink: true }) }); onChanged(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save the photo'); }
    finally { setBusy(false); }
  };
  return (
    <div className="id-card file-id">
      <div className="id-band" />
      <div className="id-body">
        <button type="button" className="id-photo photo-edit" onClick={() => input.current?.click()} disabled={busy}
          aria-label={s.photoUrl ? 'Change photo' : 'Add photo'}>
          {s.photoUrl ? <img src={photoSrc(s.photoUrl)!} alt="" /> : <span aria-hidden>{initialsOf(s.name)}</span>}
          <em aria-hidden>{busy ? '…' : s.photoUrl ? 'Change' : 'Add photo'}</em>
        </button>
        <input ref={input} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) void upload(x); }} />
        <h2>{s.name}</h2>
        <ErrorBox error={err} />
        <dl className="id-facts">
          <div><dt>Admission no.</dt><dd className="num">{s.admissionNo}</dd></div>
          <div><dt>Class</dt><dd>{s.className ? `${classLabel(s.className)} ${s.sectionName ?? ''}` : '—'}</dd></div>
          <div style={{ gridColumn: '1 / -1' }}>
            <dt>Aadhaar (last 4)</dt>
            <dd>
              {editAadhaar ? (
                <form className="row" style={{ gap: 6 }} onSubmit={async (e: FormEvent) => {
                  e.preventDefault();
                  try { await api.put(`/students/${s.id}/aadhaar`, { last4: aadhaar || null }); setEditAadhaar(false); onChanged(); }
                  catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not save'); }
                }}>
                  <input className="input num" style={{ width: 90, padding: '6px 10px' }} inputMode="numeric" autoFocus aria-label="Aadhaar last 4 digits"
                    value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, '').slice(-4))} />
                  <button className="btn btn-plain" style={{ padding: '6px 12px' }}>Save</button>
                </form>
              ) : (
                <>{s.aadhaarLast4 ? <span className="num">XXXX XXXX {s.aadhaarLast4}</span> : <span className="muted">Not given</span>}{' '}
                  <button type="button" className="btn-link small" onClick={() => setEditAadhaar(true)}>Edit</button></>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function AddDocument({ f, replacing, onSaved, onCancelReplace }: {
  f: FileData; replacing: Doc | null; onSaved: (label: string) => void; onCancelReplace: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState('');
  const [forClass, setForClass] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!replacing) return;
    setOpen(true); setTypeId(replacing.typeId ?? '');
    const m = /\((Class [^)]+)\)/.exec(replacing.label); setForClass(m ? m[1]!.replace('Class ', '') : '');
  }, [replacing]);

  const type = f.types.find((t) => t.id === typeId);
  // Suggest the first missing checklist item
  const firstMissing = f.checklist.find((c) => !c.done)?.typeId;
  const start = () => { setOpen(true); setTypeId(firstMissing ?? ''); };
  const reset = () => { setOpen(false); setTypeId(''); setForClass(''); setNote(''); setFile(null); setErr(null); onCancelReplace(); };
  const preview = type ? [type.name, type.asksForClass && forClass ? `(${/^\d+$/.test(forClass) ? `Class ${forClass}` : forClass})` : null, note ? `· ${note}` : null].filter(Boolean).join(' ') : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) { setErr('Choose the scanned file or photo'); return; }
    setBusy(true); setErr(null);
    try {
      const dataUrl = await readUpload(file, { maxSide: 2200, quality: 0.85 });
      const r = await api.post<{ label: string }>(`/students/${f.student.id}/documents`, {
        typeId, forClass: type?.asksForClass ? forClass : null, note: note || null, fileName: file.name, dataUrl, replacesId: replacing?.id ?? null,
      });
      reset(); onSaved(r.label);
    } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not upload. Please try again.'); }
    finally { setBusy(false); }
  };

  if (!open) {
    return (
      <div className="file-add-bar">
        <div>
          <strong>{f.missing ? `${f.missing} document${f.missing === 1 ? '' : 's'} still needed` : 'Everything needed is in the file'}</strong>
          <div className="muted small">Scans and phone photos both work. Only the office can add documents.</div>
        </div>
        <button className="btn btn-primary" onClick={start}>Add a document</button>
      </div>
    );
  }
  return (
    <form className="sheet sheet-pad stack" onSubmit={submit}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '1.1rem' }}>{replacing ? `Replace: ${replacing.label}` : 'Add a document'}</h2>
        <button type="button" className="btn btn-quiet" onClick={reset}>Cancel</button>
      </div>
      {replacing ? <p className="small muted">The old copy is kept in the file’s history. Nothing is ever deleted.</p> : null}
      <ErrorBox error={err} />
      <div className="grid-3">
        <Field label="What is it?" htmlFor="dt">
          <select id="dt" className="input" required value={typeId} disabled={!!replacing} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">Choose…</option>
            {f.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        {type?.asksForClass ? (
          <Field label="For which class?" htmlFor="dc" hint="e.g. 6, or Nursery">
            <input id="dc" className="input" required value={forClass} onChange={(e) => setForClass(e.target.value)} />
          </Field>
        ) : null}
        <Field label="Note" htmlFor="dn" hint="Optional, e.g. “Mother’s”">
          <input id="dn" className="input" maxLength={60} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className={`drop ${file ? 'has-file' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const x = e.dataTransfer.files[0]; if (x) setFile(x); }}>
        <input ref={fileInput} id="df" type="file" accept="image/*,application/pdf" className="sr-only"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file ? (
          <span><strong>{file.name}</strong> <span className="muted">· {kb(file.size)}</span> <button type="button" className="btn-link" onClick={() => fileInput.current?.click()}>Choose another</button></span>
        ) : (
          <span>Drop the file here, or <label htmlFor="df" className="btn-link">choose a file</label>. <span className="muted">PDF, JPG or PNG, up to 10 MB.</span></span>
        )}
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small">{preview ? <>It will be filed as <strong>{preview}</strong></> : null}</span>
        <button className="btn btn-primary" disabled={busy || !typeId}>{busy ? 'Uploading…' : replacing ? 'Replace document' : 'Add to file'}</button>
      </div>
    </form>
  );
}

function DocRow({ d, onView, onReplace }: { d: Doc; onView: (d: Doc) => void; onReplace?: () => void }) {
  const [showHistory, setShowHistory] = useState(false);
  const isPdf = d.mime === 'application/pdf';
  return (
    <li className="doc-row">
      <button type="button" className={`doc-thumb ${isPdf ? 'is-pdf' : ''}`} onClick={() => onView(d)} aria-label={`View ${d.label}`}>
        {isPdf ? 'PDF' : <img src={fileUrl(`/documents/${d.id}/content`)} alt="" loading="lazy" />}
      </button>
      <div className="doc-main">
        <button type="button" className="doc-label" onClick={() => onView(d)}>{d.label}{d.yearName && d.category === 'report_card' ? `, ${d.yearName}` : ''}</button>
        <div className="muted small">
          {d.category === 'certificate' ? `Issued by ${d.uploadedBy ?? 'office'}` : d.source === 'system' ? 'Filed by Arscio' : `Added by ${d.uploadedBy ?? 'office'}`} on {day(d.createdAt)} · {kb(d.size)}
          {d.history?.length ? <> · <button type="button" className="btn-link" aria-expanded={showHistory} onClick={() => setShowHistory((x) => !x)}>
            {d.history.length} earlier version{d.history.length === 1 ? '' : 's'}</button></> : null}
        </div>
        {showHistory ? (
          <ul className="doc-history">
            {d.history!.map((h) => (
              <li key={h.id}>
                Replaced copy from {day(h.createdAt)}, added by {h.uploadedBy ?? 'office'}{' '}
                <button type="button" className="btn-link" onClick={() => onView(h)}>View</button>{' · '}
                <a className="btn-link" href={fileUrl(`/documents/${h.id}/content?download=1`)}>Download</a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="doc-actions">
        <button type="button" className="btn btn-plain" onClick={() => onView(d)}>View</button>
        <a className="btn btn-quiet" href={fileUrl(`/documents/${d.id}/content?download=1`)}>Download</a>
        {onReplace ? <button type="button" className="btn btn-quiet" onClick={onReplace}>Replace</button> : null}
      </div>
    </li>
  );
}

/** Opens a document on screen, without downloading it. */
function Viewer({ d, onClose }: { d: Doc; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const src = fileUrl(`/documents/${d.id}/content`);
  return (
    <dialog ref={ref} className="viewer" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <div className="viewer-head">
        <div><strong>{d.label}{d.yearName && d.category === 'report_card' ? `, ${d.yearName}` : ''}</strong><div className="small muted">{kb(d.size)} · added {day(d.createdAt)}</div></div>
        <div className="row">
          <a className="btn btn-plain" href={`${src}?download=1`}>Download</a>
          <button type="button" className="btn btn-primary" onClick={() => ref.current?.close()} autoFocus>Close</button>
        </div>
      </div>
      <div className="viewer-body">
        {d.mime === 'application/pdf'
          ? <iframe src={src} title={d.label} />
          : <img src={src} alt={d.label} />}
      </div>
    </dialog>
  );
}
