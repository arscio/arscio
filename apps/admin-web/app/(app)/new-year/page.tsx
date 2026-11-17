'use client';
// Moving to a new school year: prepare it, decide for each student, then start it.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { classLabel, sectionLabel } from '@/lib/types';
import { ErrorBox, Field, Loading, useToast } from '@/components/ui';

type Action = 'promote' | 'repeat' | 'leave' | 'passed_out';
interface Section { id: string; classId: string; className: string; name: string; classTeacher: string | null; students: number }
interface Year { id: string; name: string; startsOn: string; endsOn: string }
interface State {
  current: Year; next: (Year & { sections: Section[] }) | null; suggest: { name: string; startsOn: string; endsOn: string };
  classes: { id: string; name: string; sortOrder: number }[]; sections: Section[];
  students: { id: string; name: string; admissionNo: string; sectionId: string; rollNo: number | null }[];
  publishedTerms: number;
  lastMove: { doneAt: string; toYear: string; canUndo: boolean; summary: Record<string, number | string> } | null;
}
const LABEL: Record<Action, string> = { promote: 'Moves up', repeat: 'Stays', leave: 'Leaving', passed_out: 'Passed out' };
const day = (s: string) => new Date(`${s}T00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

export default function NewYearPage() {
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState(0);
  const toast = useToast();
  useEffect(() => { api.get<State>('/new-year').then(setS).catch((e) => setErr(e.message)); }, [v]);
  const reload = () => setV((x) => x + 1);
  if (err) return <ErrorBox error={err} />;
  if (!s) return <Loading />;

  return (
    <>
      <div className="page-head"><div><h1>New school year</h1>
        <p>Usually done in April. The current year is {s.current.name} ({day(s.current.startsOn)} to {day(s.current.endsOn)}).</p></div></div>
      <div className="stack" style={{ gap: 22 }}>
        {s.lastMove ? <Moved s={s} onUndone={() => { reload(); toast.show(`Back to ${s.current.name}`); }} /> : null}
        {s.lastMove ? null : !s.next
          ? <Prepare s={s} onDone={(m) => { reload(); toast.show(m); }} />
          : <>
              <Prepared s={s} onChanged={(m) => { reload(); toast.show(m); }} />
              <Decide s={s} onStarted={() => { reload(); window.scrollTo({ top: 0 }); }} />
            </>}
      </div>
      {toast.node}
    </>
  );
}

function Moved({ s, onUndone }: { s: State; onUndone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const m = s.lastMove!.summary;
  return (
    <div className="sheet sheet-pad stack ny-done">
      <h2>{s.current.name} has started</h2>
      <p style={{ margin: 0 }}>
        {m.promoted} moved up, {m.repeated} stayed in the same class, {m.left} left, {m.passedOut} passed out.{' '}
        {m.reportCards ? `${m.reportCards} report cards were filed in the students’ files. ` : ''}
        {m.feeLines ? `${m.feeLines} fee lines were created for the new year; check the amounts in Fees.` : 'No fee structure was copied; set fees for the new year in Fees.'}
      </p>
      <ErrorBox error={err} />
      {s.lastMove!.canUndo ? (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">Made a mistake? You can undo this today, until attendance is taken or fees are collected in the new year.</span>
          <button className="btn btn-plain" disabled={busy} onClick={async () => {
            setBusy(true); setErr(null);
            try { await api.post('/new-year/undo', {}); onUndone(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not undo'); } finally { setBusy(false); }
          }}>{busy ? 'Undoing…' : `Undo, go back to ${m.from}`}</button>
        </div>
      ) : null}
    </div>
  );
}

function Prepare({ s, onDone }: { s: State; onDone: (m: string) => void }) {
  const [v, setV] = useState({ ...s.suggest, copyTeachers: true, copyTimetable: false, copyFees: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="sheet sheet-pad stack" onSubmit={async (e: FormEvent) => {
      e.preventDefault(); setBusy(true); setErr(null);
      try { const r = await api.post<{ sections: number }>('/new-year/prepare', v); onDone(`${v.name} prepared with ${r.sections} sections`); }
      catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not prepare the year'); } finally { setBusy(false); }
    }}>
      <div><h2>Prepare the next year</h2><p className="muted small" style={{ marginTop: 4 }}>
        Nothing changes for teachers or parents yet. You can still change or remove it.</p></div>
      <ErrorBox error={err} />
      <div className="grid-3">
        <Field label="Name" htmlFor="yn"><input id="yn" className="input num" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Starts on" htmlFor="ys"><input id="ys" type="date" className="input" required value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} /></Field>
        <Field label="Ends on" htmlFor="ye"><input id="ye" type="date" className="input" required value={v.endsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} /></Field>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <label className="check"><input type="checkbox" checked={v.copyTeachers} onChange={(e) => setV({ ...v, copyTeachers: e.target.checked })} /> Keep the same class teachers and subject teachers for each section</label>
        <label className="check"><input type="checkbox" checked={v.copyTimetable} onChange={(e) => setV({ ...v, copyTimetable: e.target.checked })} /> Keep this year’s timetable</label>
        <label className="check"><input type="checkbox" checked={v.copyFees} onChange={(e) => setV({ ...v, copyFees: e.target.checked })} /> Copy the fee structure (same amounts, due dates one year later; change them in Fees)</label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Sections are copied as they are: {s.sections.length} sections in {new Set(s.sections.map((x) => x.classId)).size} classes. You can add more sections next.</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" disabled={busy}>{busy ? 'Preparing…' : `Prepare ${v.name}`}</button></div>
    </form>
  );
}

function Prepared({ s, onChanged }: { s: State; onChanged: (m: string) => void }) {
  const n = s.next!;
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // Classes that have students now, or will receive students moving up
  const receives = new Set(s.sections.flatMap((x) => {
    const sort = s.classes.find((c) => c.id === x.classId)!.sortOrder;
    const nc = s.classes.find((c) => c.sortOrder > sort);
    return [x.classId, ...(nc ? [nc.id] : [])];
  }));
  const byClass = s.classes.map((c) => ({ ...c, sections: n.sections.filter((x) => x.classId === c.id) })).filter((c) => c.sections.length || receives.has(c.id));
  return (
    <div className="sheet sheet-pad stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h2>1. {n.name} is prepared</h2><p className="muted small" style={{ marginTop: 4 }}>{day(n.startsOn)} to {day(n.endsOn)}. These are next year’s sections.</p></div>
        <button className="btn btn-quiet" onClick={async () => {
          setErr(null);
          try { await api.del('/new-year'); onChanged(`${n.name} removed`); } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not remove'); }
        }}>Remove {n.name}</button>
      </div>
      <ErrorBox error={err} />
      <div className="ny-classes">
        {byClass.map((c) => (
          <div key={c.id} className={`ny-class ${c.sections.length ? '' : 'is-empty'}`}>
            <strong>{classLabel(c.name)}</strong>
            {!c.sections.length ? <span className="small" style={{ color: '#8A4B05' }}>Needs a section</span> : null}
            <div className="ny-chips">
              {c.sections.map((x) => <span key={x.id} className="ny-chip" title={x.classTeacher ? `Class teacher: ${x.classTeacher}` : 'No class teacher yet'}>{x.name}</span>)}
              {adding === c.id ? (
                <form className="row" style={{ gap: 4 }} onSubmit={async (e) => {
                  e.preventDefault(); setErr(null);
                  try { await api.post('/new-year/sections', { classId: c.id, name }); setAdding(null); setName(''); onChanged(`${sectionLabel(c.name, name.toUpperCase())} added`); }
                  catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not add'); }
                }}>
                  <input className="input" autoFocus style={{ width: 54, padding: '4px 8px' }} aria-label="New section name" value={name} onChange={(e) => setName(e.target.value)} />
                  <button className="btn-link small">Add</button>
                </form>
              ) : <button className="ny-chip ny-add" onClick={() => { setAdding(c.id); setName(''); }} aria-label={`Add a section to ${classLabel(c.name)}`}>+</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Decide({ s, onStarted }: { s: State; onStarted: () => void }) {
  const n = s.next!;
  const order = useMemo(() => new Map(s.classes.map((c) => [c.id, c.sortOrder])), [s.classes]);
  const nextClassOf = (classId: string) => s.classes.find((c) => c.sortOrder > (order.get(classId) ?? 0))?.id ?? null;
  const targets = (classId: string | null) => n.sections.filter((x) => x.classId === classId);
  const pick = (classId: string | null, name: string) => { const t = targets(classId); return (t.find((x) => x.name === name) ?? t[0])?.id ?? ''; };

  const defaults = () => {
    const d: Record<string, { action: Action; sectionId: string }> = {};
    for (const st of s.students) {
      const sec = s.sections.find((x) => x.id === st.sectionId)!;
      const nc = nextClassOf(sec.classId);
      d[st.id] = nc ? { action: 'promote', sectionId: pick(nc, sec.name) } : { action: 'passed_out', sectionId: '' };
    }
    return d;
  };
  const [dec, setDec] = useState(defaults);
  // When a section is added for next year, give it to students who had none
  useEffect(() => {
    setDec((d) => {
      let changed = false;
      const out = { ...d };
      for (const st of s.students) {
        const x = d[st.id];
        if (!x || x.sectionId || !['promote', 'repeat'].includes(x.action)) continue;
        const sec = s.sections.find((y) => y.id === st.sectionId)!;
        const id = pick(x.action === 'promote' ? nextClassOf(sec.classId) : sec.classId, sec.name);
        if (id) { out[st.id] = { ...x, sectionId: id }; changed = true; }
      }
      return changed ? out : d;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.sections.length]);
  const [rollOrder, setRollOrder] = useState<'name' | 'keep'>('name');
  const [open, setOpen] = useState<string | null>(s.sections[0]?.id ?? null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setAction = (st: { id: string; sectionId: string }, action: Action) => {
    const sec = s.sections.find((x) => x.id === st.sectionId)!;
    const cls = action === 'promote' ? nextClassOf(sec.classId) : action === 'repeat' ? sec.classId : null;
    setDec((d) => ({ ...d, [st.id]: { action, sectionId: cls ? (d[st.id]!.action === action ? d[st.id]!.sectionId : pick(cls, sec.name)) : '' } }));
  };
  const counts = Object.values(dec).reduce((a, d) => ({ ...a, [d.action]: (a[d.action] ?? 0) + 1 }), {} as Record<Action, number>);
  const missingSection = s.students.filter((st) => ['promote', 'repeat'].includes(dec[st.id]!.action) && !dec[st.id]!.sectionId);

  const start = async () => {
    setBusy(true); setErr(null);
    try {
      await api.post('/new-year/start', { rollOrder, decisions: s.students.map((st) => ({ studentId: st.id, action: dec[st.id]!.action, sectionId: dec[st.id]!.sectionId || null })) });
      onStarted();
    } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not start the new year'); setConfirming(false); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="sheet sheet-pad stack">
        <div><h2>2. What happens to each student</h2><p className="muted small" style={{ marginTop: 4 }}>
          Everyone moves up by default; students in the last class pass out. Change only the exceptions.</p></div>
        <div className="stack" style={{ gap: 10 }}>
          {s.sections.map((sec) => {
            const list = s.students.filter((st) => st.sectionId === sec.id);
            const nc = nextClassOf(sec.classId);
            const exceptions = list.filter((st) => dec[st.id]!.action !== (nc ? 'promote' : 'passed_out')).length;
            const isOpen = open === sec.id;
            return (
              <div key={sec.id} className={`ny-sec ${isOpen ? 'is-open' : ''}`}>
                <button className="ny-sec-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : sec.id)}>
                  <strong>{sectionLabel(sec.className, sec.name)}</strong>
                  <span className="muted small">{list.length} students · {nc ? `move up to ${classLabel(s.classes.find((c) => c.id === nc)!.name)}` : 'last class: pass out'}</span>
                  {exceptions ? <span className="tag tag-warn">{exceptions} changed</span> : null}
                  <span aria-hidden className="ny-caret">{isOpen ? '−' : '+'}</span>
                </button>
                {isOpen ? (
                  <table className="register ny-table">
                    <tbody>
                      {list.map((st) => {
                        const d = dec[st.id]!;
                        const cls = d.action === 'promote' ? nc : d.action === 'repeat' ? sec.classId : null;
                        const opts = targets(cls);
                        return (
                          <tr key={st.id}>
                            <td className="num muted" style={{ width: 40 }}>{st.rollNo ?? ''}</td>
                            <td><strong>{st.name}</strong> <span className="muted small num">{st.admissionNo}</span></td>
                            <td>
                              <div className="seg" role="radiogroup" aria-label={`${st.name}: next year`}>
                                {((nc ? ['promote', 'repeat', 'leave'] : ['passed_out', 'repeat', 'leave']) as Action[]).map((a) => (
                                  <button key={a} type="button" role="radio" aria-checked={d.action === a} className={d.action === a ? 'on' : ''} onClick={() => setAction(st, a)}>{LABEL[a]}</button>
                                ))}
                              </div>
                            </td>
                            <td style={{ width: 170 }}>
                              {cls ? (opts.length > 1 ? (
                                <select className="input" style={{ padding: '6px 10px' }} aria-label={`${st.name}: section next year`} value={d.sectionId}
                                  onChange={(e) => setDec((x) => ({ ...x, [st.id]: { ...d, sectionId: e.target.value } }))}>
                                  {opts.map((o) => <option key={o.id} value={o.id}>{sectionLabel(o.className, o.name)}</option>)}
                                </select>
                              ) : opts[0] ? <span className="small">{sectionLabel(opts[0].className, opts[0].name)}</span>
                                : <span className="small" style={{ color: '#8A4B05' }}>No section next year</span>) : null}
                            </td>
                          </tr>
                        );
                      })}
                      {!list.length ? <tr><td className="muted">No students.</td></tr> : null}
                    </tbody>
                  </table>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sheet sheet-pad stack">
        <h2>3. Start {n.name}</h2>
        <ul className="ny-summary">
          <li><strong>{counts.promote ?? 0}</strong> move up</li>
          <li><strong>{counts.repeat ?? 0}</strong> stay in the same class</li>
          <li><strong>{counts.leave ?? 0}</strong> leaving</li>
          <li><strong>{counts.passed_out ?? 0}</strong> passed out</li>
        </ul>
        {s.publishedTerms
          ? <div className="note">Each student’s {s.current.name} report card will be saved in their file, e.g. “Class 6 report card, {s.current.name}”.</div>
          : <div className="note note-warn">No report cards have been published for {s.current.name}, so none will be filed. Publish them in Exams first if you want them in the students’ files.</div>}
        <Field label="Roll numbers next year" htmlFor="ro">
          <select id="ro" className="input" style={{ maxWidth: 340 }} value={rollOrder} onChange={(e) => setRollOrder(e.target.value as 'name' | 'keep')}>
            <option value="name">Alphabetical by name, in each section</option>
            <option value="keep">Keep this year’s order</option>
          </select>
        </Field>
        <ErrorBox error={err ?? (missingSection.length ? `${missingSection.length} student${missingSection.length === 1 ? ' has' : 's have'} no section next year (e.g. ${missingSection[0]!.name}). Add a section above.` : null)} />
        {confirming ? (
          <div className="ny-confirm">
            <p style={{ margin: 0 }}><strong>Start {n.name} now?</strong> Teachers and parents will see the new classes straight away. Leavers come off attendance lists. You can undo this today.</p>
            <div className="row">
              <button className="btn btn-quiet" onClick={() => setConfirming(false)}>Not yet</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void start()}>{busy ? 'Starting… this can take a minute' : `Yes, start ${n.name}`}</button>
            </div>
          </div>
        ) : (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={!!missingSection.length} onClick={() => setConfirming(true)}>Start {n.name}</button>
          </div>
        )}
      </div>
    </>
  );
}
