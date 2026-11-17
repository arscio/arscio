'use client';
// Results day. For each class the principal decides:
//   - which exams count towards the final result, and how much (Final only, all equally, or custom weights)
//   - the pass rule (minimum % in every subject and overall)
//   - the result date: from then parents can download the marksheet in the app
// Marksheets carry the principal's signature and a QR code anyone can scan to check them.
// A student below the pass rule gets the marksheet only after the principal confirms it here.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, fileUrl } from '@/lib/api';
import { classLabel } from '@/lib/types';
import { ExamsTabs, num, shortDate } from '@/components/Exams';
import { useSchool } from '@/components/AppShell';
import { ErrorBox, Field, Loading, Panel, useToast } from '@/components/ui';

interface ClassRow {
  id: string; name: string; style: string; students: number; made: number; held: number;
  weights: { examId: string; weight: number }[] | null; passSubjectPct: string | null; passOverallPct: string | null; resultDate: string | null;
  exams: { id: string; name: string; termName: string }[];
}
interface Setup { year: { id: string; name: string }; classes: ClassRow[]; today: string }
interface StudentResult {
  studentId: string; name: string; classLabel: string; rollNo: number | null; pct: number | null; grade: string | null;
  passed: boolean; result: string; complete: boolean; missing: string[];
  marksheet: { id: string; held: boolean; releasedAt: string | null; note: string | null; generatedAt: string; changedSince: boolean } | null;
}

export default function ResultsPage() {
  const { can } = useSchool();
  const manage = can('reportcards.manage');
  const toast = useToast();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const load = useCallback(async () => setSetup(await api.get<Setup>('/results/setup')), []);
  useEffect(() => { void load(); }, [load]);
  if (!setup) return <Loading />;
  const current = setup.classes.find((c) => c.id === classId) ?? null;

  return (
    <>
      <div className="page-head"><div><h1>Exams & report cards</h1>
        <p>Decide how each class&apos;s final result is worked out, the pass rule and the result date. On that date parents can download the marksheet in the app.</p></div></div>
      <ExamsTabs />
      {current ? (
        <ClassResults cls={current} today={setup.today} manage={manage} onBack={() => { setClassId(null); void load(); }}
          onEdit={() => setEditing(current)} toast={toast.show} />
      ) : (
        <div className="sheet table-wrap">
          <table className="register">
            <thead><tr><th>Class</th><th>How the result is worked out</th><th>Pass rule</th><th>Result date</th><th>Marksheets</th><th></th></tr></thead>
            <tbody>{setup.classes.map((c) => {
              const names = (c.weights ?? []).map((w) => `${c.exams.find((x) => x.id === w.examId)?.name ?? 'Exam'} ${pctOf(c.weights!, w.weight)}`);
              return (
                <tr key={c.id}>
                  <td className="nowrap"><strong>{classLabel(c.name)}</strong><div className="small muted">{c.students} students</div></td>
                  <td className="small">{c.weights?.length ? names.join(', ') : <span className="tag tag-warn">Not set</span>}</td>
                  <td className="small">{c.style === 'grades_only' ? 'Grades only' : c.passSubjectPct ? `${num(c.passSubjectPct)}% each subject, ${num(c.passOverallPct!)}% overall` : '-'}</td>
                  <td className="small nowrap">{c.resultDate ? shortDate(c.resultDate) : '-'}</td>
                  <td className="small">{c.made ? `${c.made} of ${c.students} made` : '-'}{c.held ? <div><span className="tag tag-warn">{c.held} waiting for you</span></div> : null}</td>
                  <td className="actions nowrap">
                    {manage ? <button className="btn btn-plain" onClick={() => setEditing(c)}>{c.weights?.length ? 'Change' : 'Set up'}</button> : null}
                    {c.weights?.length ? <button className="btn btn-primary" onClick={() => setClassId(c.id)}>Open</button> : null}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <Panel open={editing !== null} title={editing ? `${classLabel(editing.name)}: final result` : ''} onClose={() => setEditing(null)}>
        {editing ? <FormulaForm cls={editing} all={setup.classes} onDone={async (m) => { setEditing(null); await load(); toast.show(m); }} /> : null}
      </Panel>
      {toast.node}
    </>
  );
}

const pctOf = (ws: { weight: number }[], w: number) => {
  const t = ws.reduce((a, x) => a + Number(x.weight), 0);
  return t ? `${Math.round((Number(w) / t) * 1000) / 10}%` : '';
};

type Preset = 'final' | 'equal' | 'custom';

function FormulaForm({ cls, all, onDone }: { cls: ClassRow; all: ClassRow[]; onDone: (m: string) => Promise<void> }) {
  const has = cls.weights ?? [];
  const [preset, setPreset] = useState<Preset>(has.length === 1 ? 'final' : has.length > 1 ? 'custom' : 'custom');
  const [finalId, setFinalId] = useState(has.length === 1 ? has[0]!.examId : cls.exams.at(-1)?.id ?? '');
  const [weights, setWeights] = useState<Record<string, string>>(Object.fromEntries(has.map((w) => [w.examId, String(w.weight)])));
  const [passSub, setPassSub] = useState(cls.passSubjectPct ? num(cls.passSubjectPct) : '33');
  const [passAll, setPassAll] = useState(cls.passOverallPct ? num(cls.passOverallPct) : '33');
  const [resultDate, setResultDate] = useState(cls.resultDate ?? '');
  const [also, setAlso] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sameExams = all.filter((c) => c.id !== cls.id && c.style === cls.style);

  const chosen = useMemo(() => {
    if (preset === 'final') return finalId ? [{ examId: finalId, weight: 1 }] : [];
    if (preset === 'equal') return cls.exams.map((x) => ({ examId: x.id, weight: 1 }));
    return cls.exams.filter((x) => Number(weights[x.id]) > 0).map((x) => ({ examId: x.id, weight: Number(weights[x.id]) }));
  }, [preset, finalId, weights, cls.exams]);
  const total = chosen.reduce((a, w) => a + w.weight, 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.put(`/results/classes/${cls.id}`, { weights: chosen, passSubjectPct: Number(passSub), passOverallPct: Number(passAll),
        resultDate: resultDate || null, applyToClassIds: also });
      await onDone(also.length ? `Saved for ${also.length + 1} classes` : 'Saved');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save'); setBusy(false); }
  };

  if (!cls.exams.length) return <p className="muted">This class has no exams this year yet. Add them on the first tab.</p>;
  return (
    <form className="stack" onSubmit={save}>
      <div className="field">
        <span className="label">Which exams count?</span>
        <div className="stack" style={{ gap: 8, marginTop: 6 }}>
          {([['final', 'One exam only', 'For example only the Final exam, or only Half Yearly'],
             ['equal', 'All exams equally', `${cls.exams.length} exams, ${Math.round(1000 / cls.exams.length) / 10}% each`],
             ['custom', 'Your own weights', 'For example 10 / 30 / 10 / 50']] as const).map(([v, l, h]) => (
            <label key={v} className="check" style={{ justifyContent: 'flex-start' }}>
              <input type="radio" name="preset" checked={preset === v} onChange={() => setPreset(v)} />
              <span><strong>{l}</strong> <span className="small muted">{h}</span></span>
            </label>
          ))}
        </div>
      </div>
      {preset === 'final' ? (
        <Field label="Exam" htmlFor="fx">
          <select id="fx" className="input" value={finalId} onChange={(e) => setFinalId(e.target.value)}>
            {cls.exams.map((x) => <option key={x.id} value={x.id}>{x.termName}: {x.name}</option>)}
          </select>
        </Field>
      ) : null}
      {preset === 'custom' ? (
        <div className="field">
          <span className="label">Weight of each exam</span>
          <span className="hint">Leave empty for exams that don&apos;t count. They are used as proportions, so 10/30/10/50 and 1/3/1/5 give the same result.</span>
          <div className="stack" style={{ gap: 6, marginTop: 6 }}>
            {cls.exams.map((x) => (
              <label key={x.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{x.termName}: <strong>{x.name}</strong></span>
                <span className="row" style={{ gap: 8 }}>
                  <input className="input num" style={{ width: 80 }} inputMode="numeric" aria-label={`Weight of ${x.name}`} placeholder="-"
                    value={weights[x.id] ?? ''} onChange={(e) => setWeights({ ...weights, [x.id]: e.target.value.replace(/[^\d.]/g, '') })} />
                  <span className="small muted" style={{ width: 52 }}>{Number(weights[x.id]) > 0 && total ? `${Math.round((Number(weights[x.id]) / total) * 1000) / 10}%` : ''}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
      {cls.style !== 'grades_only' ? (
        <div className="grid-2">
          <Field label="Pass mark in every subject (%)" htmlFor="ps"><input id="ps" className="input" inputMode="numeric" value={passSub} onChange={(e) => setPassSub(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
          <Field label="Pass mark overall (%)" htmlFor="pa"><input id="pa" className="input" inputMode="numeric" value={passAll} onChange={(e) => setPassAll(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        </div>
      ) : null}
      <Field label="Result date" htmlFor="rd" hint="From this day parents can download the marksheet in the app. Students below the pass mark get theirs after you confirm.">
        <input id="rd" type="date" className="input" value={resultDate} onChange={(e) => setResultDate(e.target.value)} />
      </Field>
      {sameExams.length ? (
        <div className="field">
          <span className="label">Use the same for other classes</span>
          <div className="checks">{sameExams.map((c) => (
            <label key={c.id} className="check"><input type="checkbox" checked={also.includes(c.id)}
              onChange={() => setAlso(also.includes(c.id) ? also.filter((x) => x !== c.id) : [...also, c.id])} />{classLabel(c.name)}</label>
          ))}</div>
        </div>
      ) : null}
      <ErrorBox error={error} />
      <div><button className="btn btn-primary" disabled={busy || !chosen.length}>Save</button></div>
    </form>
  );
}

function ClassResults({ cls, today, manage, onBack, onEdit, toast }: {
  cls: ClassRow; today: string; manage: boolean; onBack: () => void; onEdit: () => void; toast: (m: string) => void;
}) {
  const [d, setD] = useState<{ className: string; students: StudentResult[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<StudentResult | null>(null);
  const load = useCallback(async () => setD(await api.get(`/results/classes/${cls.id}`)), [cls.id]);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <Loading />;

  const made = d.students.filter((s) => s.marksheet).length;
  const missing = d.students.filter((s) => !s.complete);
  const waiting = d.students.filter((s) => s.marksheet?.held && !s.marksheet.releasedAt);
  const changed = d.students.filter((s) => s.marksheet?.changedSince).length;
  const live = !!cls.resultDate && cls.resultDate <= today;
  const generate = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ made: number; missing: unknown[] }>(`/results/classes/${cls.id}/generate`);
      toast(`${r.made} marksheets made${r.missing.length ? `; ${r.missing.length} still have marks missing` : ''}`);
      await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not make the marksheets'); }
    finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="row">
          <button className="btn btn-quiet" onClick={onBack}>All classes</button>
          <h2>{d.className}</h2>
          <span className="small muted">Result date {cls.resultDate ? shortDate(cls.resultDate) : 'not set'}{live ? ' (parents can download now)' : ''}</span>
        </div>
        <div className="row">
          {manage ? <button className="btn btn-plain" onClick={onEdit}>Change rules</button> : null}
          {manage ? <button className="btn btn-primary" disabled={busy} onClick={generate}>{made ? 'Make marksheets again' : 'Make marksheets'}</button> : null}
        </div>
      </div>
      <ErrorBox error={error} />
      {missing.length ? (
        <div className="notice" role="status"><strong>{missing.length} {missing.length === 1 ? 'student has' : 'students have'} marks missing</strong>, so no marksheet can be made for them yet.
          {' '}{missing.slice(0, 3).map((s) => `${s.name}: ${s.missing.slice(0, 2).join(', ')}${s.missing.length > 2 ? '…' : ''}`).join('; ')}</div>
      ) : null}
      {changed ? <div className="notice" role="status">Marks changed for {changed} {changed === 1 ? 'student' : 'students'} after their marksheet was made. Make the marksheets again to update them (their QR codes stay the same).</div> : null}
      {made ? (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <a className="btn btn-plain" target="_blank" rel="noreferrer" href={fileUrl(`/results/classes/${cls.id}/marksheets.pdf?sign=printed`)}>Download all, signed</a>
          <a className="btn btn-plain" target="_blank" rel="noreferrer" href={fileUrl(`/results/classes/${cls.id}/marksheets.pdf?sign=hand`)}>Download all, blank to sign by hand</a>
          {waiting.length ? <span className="small muted">{waiting.length} waiting for your confirmation are left out until you confirm them.</span> : null}
        </div>
      ) : null}
      <div className="sheet table-wrap">
        <table className="register">
          <thead><tr><th>Roll</th><th>Student</th><th className="money">Overall</th><th>Grade</th><th>Result</th><th>Marksheet</th><th></th></tr></thead>
          <tbody>{d.students.map((s) => (
            <tr key={s.studentId}>
              <td className="muted">{s.rollNo ?? '-'}</td>
              <td><strong>{s.name}</strong><div className="small muted">{s.classLabel}</div></td>
              <td className="money">{s.pct === null ? '—' : `${num(s.pct)}%`}</td>
              <td><strong>{s.grade ?? '—'}</strong></td>
              <td className="small">{!s.complete ? <span className="tag tag-warn">Marks missing</span>
                : s.passed ? <span className="tag tag-board">{s.result}</span> : <span style={{ color: 'var(--red-ink)' }}>{s.result}</span>}</td>
              <td className="small">{!s.marksheet ? '-' : s.marksheet.held && !s.marksheet.releasedAt ? <span className="tag tag-warn">Waiting for you</span>
                : <>Made {shortDate(s.marksheet.generatedAt)}{s.marksheet.note ? <div className="muted">{s.marksheet.note}</div> : null}</>}</td>
              <td className="actions">
                {manage && s.marksheet?.held && !s.marksheet.releasedAt ? <button className="btn btn-primary" onClick={() => setConfirming(s)}>Confirm</button> : null}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <Panel open={confirming !== null} title={confirming ? `Confirm ${confirming.name}'s marksheet` : ''} onClose={() => setConfirming(null)}>
        {confirming ? <ReleaseForm s={confirming} onDone={async () => { setConfirming(null); await load(); toast('Confirmed. The family can download it now.'); }} /> : null}
      </Panel>
    </div>
  );
}

function ReleaseForm({ s, onDone }: { s: StudentResult; onDone: () => Promise<void> }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault(); setError(null);
      try { await api.post(`/results/marksheets/${s.marksheet!.id}/release`, { note: note.trim() || null }); await onDone(); }
      catch (err) { setError(err instanceof ApiError ? err.message : 'Could not confirm'); }
    }}>
      <p>{s.result}. The family gets this marksheet in the app once you confirm it.</p>
      <Field label="Note printed on the marksheet (optional)" htmlFor="rn" hint="For example: Promoted on review, Re-test in July, Not promoted">
        <input id="rn" className="input" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorBox error={error} />
      <div><button className="btn btn-primary">Confirm and give to the family</button></div>
    </form>
  );
}
