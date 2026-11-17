'use client';
// Enter or correct one subject's marks for one class, on a ledger page.
// "Save" keeps a draft; "Submit" shows the marks to parents and starts the 7 days for corrections.
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { classLabel } from '@/lib/types';
import { ExamsTabs, num, shortDate, type Band } from '@/components/Exams';
import { ErrorBox, Loading, useToast } from '@/components/ui';

interface Sheet {
  exam: { id: string; name: string; termName: string; maxMarks: string; locked: boolean; internalMax: string | null; marksDueOn: string | null };
  section: { id: string; className: string; sectionName: string; style: 'grades_only' | 'marks_and_grades' };
  subject: { id: string; name: string };
  gradeOptions: { grade: string; label: string | null }[];
  scale: Band[];
  canEdit: boolean; whyNot: string | null;
  submission: { submittedAt: string; editableUntil: string; open: boolean } | null;
  students: { id: string; firstName: string; lastName: string | null; rollNo: number | null; marks: string | null; grade: string | null;
    absent: boolean; internal: string | null }[];
}
type Row = { marks: string; grade: string; absent: boolean; internal: string };

export default function Page() { return <Suspense fallback={<Loading />}><Enter /></Suspense>; }

function Enter() {
  const p = useSearchParams();
  const q = `examId=${p.get('examId')}&sectionId=${p.get('sectionId')}&subjectId=${p.get('subjectId')}`;
  const toast = useToast();
  const [s, setS] = useState<Sheet | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [max, setMax] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [version, setVersion] = useState(0);
  useEffect(() => {
    api.get<Sheet>(`/marks/sheet?${q}`).then((r) => {
      setS(r); setMax(num(r.exam.maxMarks));
      setRows(Object.fromEntries(r.students.map((x) => [x.id, { marks: x.marks != null ? num(x.marks) : '', grade: x.grade ?? '', absent: x.absent,
        internal: x.internal != null ? num(x.internal) : '' }])));
    }).catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load'));
  }, [q, version]);
  if (!s) return error ? <ErrorBox error={error} /> : <Loading />;

  const gradesOnly = s.section.style === 'grades_only';
  const maxN = Number(max) || 0;
  const intMax = s.exam.internalMax ? Number(s.exam.internalMax) : 0;
  const gradeOf = (m: string, internal = '') => {
    if (m === '' || !maxN) return '';
    const pc = ((Number(m) + (Number(internal) || 0)) / (maxN + intMax)) * 100;
    return s.scale.find((b) => pc >= (b.min ?? 0) && pc <= (b.max ?? 100))?.grade ?? '';
  };
  const set = (id: string, patch: Partial<Row>) => setRows({ ...rows, [id]: { ...rows[id]!, ...patch } });
  const filled = Object.values(rows).filter((r) => r.absent || (gradesOnly ? r.grade : r.marks !== '')).length;
  const tooHigh = !gradesOnly && Object.values(rows).some((r) => (r.marks !== '' && Number(r.marks) > maxN) || (intMax > 0 && r.internal !== '' && Number(r.internal) > intMax));
  const submitted = !!s.submission;

  const save = async (submit: boolean) => {
    if (submit && !confirm(`Submit ${s.subject.name} marks? Parents will see them in the app straight away. You can still correct them for 7 days.`)) return;
    setBusy(true); setError(null);
    try {
      const r = await api.put<{ submittedNow: boolean; parentsTold: number }>('/marks/sheet', {
        examId: s.exam.id, sectionId: s.section.id, subjectId: s.subject.id, maxMarks: gradesOnly ? undefined : maxN, submit,
        rows: s.students.map((x) => {
          const r = rows[x.id]!;
          return { studentId: x.id, absent: r.absent, marks: gradesOnly || r.marks === '' ? null : Number(r.marks), grade: gradesOnly ? r.grade || null : null,
            internal: intMax && r.internal !== '' ? Number(r.internal) : null };
        }),
      });
      toast.show(r.submittedNow ? 'Submitted. Parents can see the marks now.' : submitted && r.parentsTold ? `Saved. ${r.parentsTold} ${r.parentsTold === 1 ? 'family was' : 'families were'} told about the correction.` : 'Saved');
      setVersion((v) => v + 1);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/exams/marks" className="small">Back to marks</Link>
          <h1 style={{ marginTop: 4 }}>{s.subject.name}, {classLabel(s.section.className)} {s.section.sectionName}</h1>
          <p>{s.exam.termName}: {s.exam.name}{s.exam.locked ? ' (locked: only the principal can change these marks)' : ''}
            {s.exam.marksDueOn && !submitted ? `. Due ${shortDate(s.exam.marksDueOn)}` : ''}</p>
          {s.submission ? (
            <p className="small" style={{ marginTop: 6 }}>
              <span className="tag tag-board">Submitted {shortDate(s.submission.submittedAt)}</span>{' '}
              {s.submission.open ? `Parents can see these. Corrections are possible until ${shortDate(s.submission.editableUntil)}; each family is told about a change.`
                : 'Final. The 7 days for corrections are over.'}
            </p>
          ) : null}
          {s.whyNot ? <p className="small" style={{ marginTop: 6, color: 'var(--marigold)' }}>{s.whyNot}</p> : null}
        </div>
      </div>
      <ExamsTabs />
      <section className="ledger" aria-label="Marks">
        <div className="ledger-head">
          <h2>Marks sheet</h2>
          {!gradesOnly ? (
            <label className="row small" style={{ gap: 8 }}>Out of
              <input className="input money-in" style={{ width: 80 }} inputMode="numeric" value={max} disabled={!s.canEdit}
                onChange={(e) => setMax(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Maximum marks" />
            </label>
          ) : <span className="small muted">Nursery and KG get grades only</span>}
        </div>
        <div className="table-wrap">
          <table className="register ledger-table">
            <thead><tr><th>Roll</th><th>Student</th><th>{gradesOnly ? 'Grade' : intMax ? `Written (out of ${maxN})` : 'Marks'}</th>
              {intMax ? <th>Internal (out of {intMax})</th> : null}{gradesOnly ? null : <th>Grade</th>}<th>Absent</th></tr></thead>
            <tbody>{s.students.map((x) => {
              const r = rows[x.id]!;
              const high = !gradesOnly && r.marks !== '' && Number(r.marks) > maxN;
              return (
                <tr key={x.id}>
                  <td className="muted">{x.rollNo ?? '-'}</td>
                  <td><strong>{x.firstName} {x.lastName ?? ''}</strong></td>
                  <td>
                    {gradesOnly ? (
                      <div className="seg" role="radiogroup" aria-label={`Grade for ${x.firstName}`}>
                        {s.gradeOptions.map((g) => (
                          <button key={g.grade} type="button" role="radio" aria-checked={r.grade === g.grade} title={g.label ?? undefined}
                            className={r.grade === g.grade ? 'on' : undefined} data-v="mode" disabled={!s.canEdit || r.absent}
                            onClick={() => set(x.id, { grade: r.grade === g.grade ? '' : g.grade })}>{g.grade}</button>
                        ))}
                      </div>
                    ) : (
                      <input className="input money-in" inputMode="decimal" aria-label={`Marks for ${x.firstName}`} aria-invalid={high}
                        disabled={!s.canEdit || r.absent} value={r.absent ? '' : r.marks}
                        onChange={(e) => set(x.id, { marks: e.target.value.replace(/[^\d.]/g, '') })} />
                    )}
                    {high ? <div className="small" style={{ color: 'var(--red-ink)' }}>More than {maxN}</div> : null}
                  </td>
                  {intMax ? (
                    <td>
                      <input className="input money-in" inputMode="decimal" aria-label={`Internal marks for ${x.firstName}`}
                        aria-invalid={r.internal !== '' && Number(r.internal) > intMax}
                        disabled={!s.canEdit || r.absent} value={r.absent ? '' : r.internal}
                        onChange={(e) => set(x.id, { internal: e.target.value.replace(/[^\d.]/g, '') })} />
                      {r.internal !== '' && Number(r.internal) > intMax ? <div className="small" style={{ color: 'var(--red-ink)' }}>More than {intMax}</div> : null}
                    </td>
                  ) : null}
                  {gradesOnly ? null : <td><strong>{r.absent ? 'AB' : gradeOf(r.marks, r.internal)}</strong></td>}
                  <td><input type="checkbox" className="tick" aria-label={`${x.firstName} was absent`} checked={r.absent} disabled={!s.canEdit}
                    onChange={(e) => set(x.id, { absent: e.target.checked })} /></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <div className="ledger-foot" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">{filled} of {s.students.length} filled.{submitted ? '' : ' Save keeps a draft that parents can’t see. Submit when everyone has marks or is marked absent.'}</span>
          <div className="row">
            <ErrorBox error={error} />
            <button className={submitted ? 'btn btn-primary' : 'btn btn-plain'} disabled={busy || !s.canEdit || tooHigh || (!gradesOnly && !maxN)}
              onClick={() => save(false)}>{submitted ? 'Save corrections' : 'Save draft'}</button>
            {!submitted ? (
              <button className="btn btn-primary" disabled={busy || !s.canEdit || tooHigh || (!gradesOnly && !maxN) || filled < s.students.length}
                onClick={() => save(true)}>Submit to parents</button>
            ) : null}
          </div>
        </div>
      </section>
      {toast.node}
    </>
  );
}
