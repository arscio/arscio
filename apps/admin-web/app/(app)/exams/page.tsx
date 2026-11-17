'use client';
// Exams and weightage: terms, the exams in each term, how much each exam counts,
// which classes write it, the grade scale, and publishing results to parents.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { classLabel } from '@/lib/types';
import { ExamsTabs, num, shortDate, type Exam, type ExamSetup, type Term } from '@/components/Exams';
import { ErrorBox, Field, Loading, Panel, useToast } from '@/components/ui';

export default function ExamsPage() {
  const toast = useToast();
  const [s, setS] = useState<ExamSetup | null>(null);
  const [termName, setTermName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ term: Term; exam: Exam | null } | null>(null);
  const load = useCallback(async () => setS(await api.get<ExamSetup>('/exams/setup')), []);
  useEffect(() => { void load(); }, [load]);
  if (!s) return <Loading />;

  const addTerm = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    try { await api.post('/exams/terms', { name: termName }); setTermName(''); await load(); toast.show('Term added'); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not add'); }
  };
  const publish = async (t: Term, on: boolean) => {
    if (on && !confirm(`Show ${t.name} report cards to parents in the app? Each family gets one message.`)) return;
    const r = await api.post<{ notified: number }>(`/exams/terms/${t.id}/publish`, { published: on });
    await load();
    toast.show(on ? `Published. ${r.notified} families told.` : 'Hidden from parents again');
  };
  const lock = async (x: Exam) => { await api.patch(`/exams/${x.id}`, { locked: !x.locked }); await load(); toast.show(x.locked ? 'Marks unlocked' : 'Marks locked'); };
  const marksScale = s.scales.find((x) => x.bands.some((b) => b.min !== undefined));
  const gradeScale = s.scales.find((x) => x.bands.every((b) => b.min === undefined));
  const className = (id: string) => classLabel(s.classes.find((c) => c.id === id)?.name ?? '');
  const setupSubject = (id: string) => s.subjects?.find((x) => x.id === id)?.name ?? 'Subject';

  return (
    <>
      <div className="page-head"><div><h1>Exams & report cards</h1><p>Session {s.year.name}. Set up terms and exams, then teachers enter marks in the teacher app.</p></div></div>
      <ExamsTabs />
      <div className="stack" style={{ gap: 22 }}>
        {s.terms.length === 0 ? (
          <div className="sheet empty"><h3>Start with the first term</h3><p>For example &ldquo;Term 1&rdquo;. Then add its exams, like Periodic Test 1 and Half Yearly.</p></div>
        ) : s.terms.map((t) => {
          const total = t.exams.reduce((a, x) => a + Number(x.weightagePct), 0);
          return (
            <section key={t.id} className="sheet">
              <div className="sheet-pad row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <h2>{t.name}</h2>
                  <p className="small muted" style={{ marginTop: 4 }}>
                    {t.exams.length ? <>Weightage adds up to <strong style={{ color: total === 100 ? 'var(--lagoon-deep)' : 'var(--marigold)' }}>{num(total)}%</strong>{total !== 100 ? ' (it is used as a proportion, so this still works)' : ''}.</> : 'No exams yet.'}
                  </p>
                </div>
                <div className="row">
                  {t.publishedAt ? <span className="tag tag-board">Shown to parents</span> : <span className="tag">Not shown to parents</span>}
                  {t.publishedAt
                    ? <button className="btn btn-plain" onClick={() => publish(t, false)}>Hide from parents</button>
                    : <button className="btn btn-plain" disabled={!t.exams.length} onClick={() => publish(t, true)}>Publish to parents</button>}
                  <button className="btn btn-primary" onClick={() => setEditing({ term: t, exam: null })}>Add exam</button>
                </div>
              </div>
              {t.exams.length ? (
                <div className="table-wrap">
                  <table className="register">
                    <thead><tr><th>#</th><th>Exam</th><th>Classes</th><th className="money">Max marks</th><th className="money">Weightage</th><th>Marks</th><th></th></tr></thead>
                    <tbody>{t.exams.map((x, i) => (
                      <tr key={x.id}>
                        <td className="muted">{i + 1}</td>
                        <td><strong>{x.name}</strong>
                          {x.startsOn ? <div className="small muted">{shortDate(x.startsOn)}{x.endsOn && x.endsOn !== x.startsOn ? ` to ${shortDate(x.endsOn)}` : ''}</div> : null}
                          {x.marksDueOn ? <div className="small muted">Marks due {shortDate(x.marksDueOn)}</div> : null}
                          {x.internals?.length ? <div className="small muted">Internal marks: {x.internals.map((i) => `${setupSubject(i.subjectId)} (${num(i.internalMax)})`).join(', ')}</div> : null}</td>
                        <td className="small">{x.classIds.length ? x.classIds.map(className).join(', ') : 'All classes'}</td>
                        <td className="money">{num(x.maxMarks)}</td>
                        <td className="money"><strong>{num(x.weightagePct)}%</strong></td>
                        <td>{x.locked ? <span className="tag tag-warn">Locked</span> : <span className="tag">{x.marksEntered} entered</span>}</td>
                        <td className="actions">
                          <button className="btn btn-quiet" onClick={() => lock(x)}>{x.locked ? 'Unlock' : 'Lock marks'}</button>
                          <button className="btn btn-plain" onClick={() => setEditing({ term: t, exam: x })}>Edit</button>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : null}
            </section>
          );
        })}

        <form className="sheet sheet-pad row" onSubmit={addTerm} style={{ alignItems: 'flex-end' }}>
          <Field label="Add a term" htmlFor="term" hint="For example: Term 1, Term 2. Exams belong to a term.">
            <input id="term" className="input" style={{ width: 260 }} value={termName} onChange={(e) => setTermName(e.target.value)} placeholder="Term 1" />
          </Field>
          <button className="btn btn-plain" disabled={termName.trim().length < 2}>Add term</button>
          <ErrorBox error={error} />
        </form>

        <section className="sheet sheet-pad">
          <h2>Grade scale</h2>
          <p className="small muted" style={{ marginTop: 4, marginBottom: 14 }}>Used on report cards. Classes 1 to 10 get marks and grades; Nursery and KG get grades only.</p>
          <div className="grid-2">
            <div>
              <h3 style={{ marginBottom: 8 }}>{marksScale?.name ?? 'Marks'}</h3>
              <div className="checks">{marksScale?.bands.map((b) => <span key={b.grade} className="chip-section"><b>{b.grade}</b> <span className="small muted">{b.min}–{Math.floor(b.max ?? 100)}%</span></span>)}</div>
            </div>
            <div>
              <h3 style={{ marginBottom: 8 }}>{gradeScale?.name ?? 'Grades'}</h3>
              <div className="checks">{gradeScale?.bands.map((b) => <span key={b.grade} className="chip-section"><b>{b.grade}</b> <span className="small muted">{b.label}</span></span>)}</div>
            </div>
          </div>
        </section>
      </div>

      <Panel open={!!editing} title={editing?.exam ? `Edit ${editing.exam.name}` : `Add an exam to ${editing?.term.name ?? ''}`} onClose={() => setEditing(null)}>
        {editing ? <ExamForm setup={s} term={editing.term} exam={editing.exam} onDone={async (m) => { setEditing(null); await load(); toast.show(m); }} /> : null}
      </Panel>
      {toast.node}
    </>
  );
}

function ExamForm({ setup, term, exam, onDone }: { setup: ExamSetup; term: Term; exam: Exam | null; onDone: (m: string) => Promise<void> }) {
  const [name, setName] = useState(exam?.name ?? '');
  const [max, setMax] = useState(exam ? num(exam.maxMarks) : '100');
  const [weight, setWeight] = useState(exam ? num(exam.weightagePct) : '');
  const [classIds, setClassIds] = useState<string[]>(exam?.classIds ?? []);
  const [startsOn, setStartsOn] = useState(exam?.startsOn?.slice(0, 10) ?? '');
  const [endsOn, setEndsOn] = useState(exam?.endsOn?.slice(0, 10) ?? '');
  const [dueOn, setDueOn] = useState(exam?.marksDueOn?.slice(0, 10) ?? '');
  const [internals, setInternals] = useState<Record<string, string>>(
    Object.fromEntries((exam?.internals ?? []).map((i) => [i.subjectId, num(i.internalMax)])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const others = term.exams.filter((x) => x.id !== exam?.id).reduce((a, x) => a + Number(x.weightagePct), 0);
  const toggle = (id: string) => setClassIds(classIds.includes(id) ? classIds.filter((x) => x !== id) : [...classIds, id]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    const body = { name, maxMarks: Number(max), weightagePct: Number(weight || 0), classIds, startsOn: startsOn || null,
      endsOn: endsOn || null, marksDueOn: dueOn || null,
      internals: Object.entries(internals).filter(([, v]) => Number(v) > 0).map(([subjectId, v]) => ({ subjectId, internalMax: Number(v) })) };
    try {
      if (exam) await api.patch(`/exams/${exam.id}`, body);
      else await api.post('/exams', { ...body, termId: term.id });
      await onDone(exam ? 'Exam updated' : 'Exam added');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save'); setBusy(false); }
  };
  const remove = async () => {
    if (!exam || !confirm(`Remove ${exam.name}?`)) return;
    try { await api.del(`/exams/${exam.id}`); await onDone('Exam removed'); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not remove'); }
  };

  return (
    <form className="stack" onSubmit={save}>
      <Field label="Exam name" htmlFor="xn"><input id="xn" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Half Yearly" /></Field>
      <div className="grid-2">
        <Field label="Maximum marks" htmlFor="xm" hint="Teachers can change it for a subject if needed."><input id="xm" className="input" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        <Field label="Weightage in the term" htmlFor="xw" hint={`Other exams in ${term.name}: ${others}%. Together they should make 100%.`}>
          <input id="xw" className="input" inputMode="numeric" value={weight} placeholder={String(Math.max(0, 100 - others))} onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, ''))} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="First exam day" htmlFor="xd" hint="Teachers see the exam in their app; marks open from this day.">
          <input id="xd" type="date" className="input" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /></Field>
        <Field label="Last exam day" htmlFor="xe"><input id="xe" type="date" className="input" min={startsOn || undefined} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></Field>
      </div>
      <Field label="Marks must be submitted by" htmlFor="xdue" hint="Teachers who are late are shown on the Marks tab. After submitting, a teacher can still correct marks for 7 days.">
        <input id="xdue" type="date" className="input" min={endsOn || startsOn || undefined} value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></Field>
      {setup.subjects?.length ? (
        <div className="field">
          <span className="label">Internal marks</span>
          <span className="hint">Only for subjects that have them. Type the internal maximum, for example 20 (written {num(max || 0)} + internal 20). Leave the rest empty.</span>
          <div className="checks">{setup.subjects.map((sub) => (
            <label key={sub.id} className="check" style={{ gap: 8 }}>
              <span style={{ flex: 1 }}>{sub.name}</span>
              <input className="input num" style={{ width: 72, padding: '4px 8px' }} inputMode="numeric" placeholder="-" aria-label={`Internal marks for ${sub.name}`}
                value={internals[sub.id] ?? ''} onChange={(e) => setInternals({ ...internals, [sub.id]: e.target.value.replace(/[^\d.]/g, '') })} />
            </label>
          ))}</div>
        </div>
      ) : null}
      <div className="field">
        <span className="label">Which classes write it?</span>
        <span className="hint">Leave all unticked for every class.</span>
        <div className="checks">{setup.classes.map((c) => (
          <label key={c.id} className="check"><input type="checkbox" checked={classIds.includes(c.id)} onChange={() => toggle(c.id)} />{classLabel(c.name)}</label>
        ))}</div>
      </div>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-primary" disabled={busy || name.trim().length < 2 || !Number(max)}>{exam ? 'Save changes' : 'Add exam'}</button>
        {exam ? <button type="button" className="btn btn-danger" onClick={remove}>Remove exam</button> : null}
      </div>
    </form>
  );
}
