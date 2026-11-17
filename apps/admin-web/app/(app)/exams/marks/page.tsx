'use client';
// Marks progress for one exam: every class and subject, who enters the marks, how far
// they are, and who is late. When several teachers teach a subject in a class, the
// principal picks who enters. Submitted marks can be corrected for 7 days; after that
// the principal can reopen them for a few days.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { classLabel, sectionLabel } from '@/lib/types';
import { ExamsTabs, shortDate, type ExamSetup } from '@/components/Exams';
import { ErrorBox, Loading, useToast } from '@/components/ui';

type Status = 'upcoming' | 'to_do' | 'draft' | 'submitted' | 'final' | 'locked';
interface Row {
  sectionId: string; className: string; sectionName: string; subjectId: string; subjectName: string;
  total: number; entered: number; submittedAt: string | null; editableUntil: string | null; status: Status; overdue: boolean;
  teacher: { membershipId: string | null; name: string | null; how: 'chosen' | 'only_teacher' | 'class_teacher' | 'needs_choice' | 'nobody';
    candidates: { membershipId: string; name: string }[] };
}
interface Progress { exam: { id: string; name: string; marksDueOn: string | null; locked: boolean }; rows: Row[] }

const STATUS: Record<Status, { label: string; cls: string }> = {
  upcoming: { label: 'Exam not started', cls: 'tag' },
  to_do: { label: 'Not started', cls: 'tag' },
  draft: { label: 'Being entered', cls: 'tag tag-warn' },
  submitted: { label: 'Submitted', cls: 'tag tag-board' },
  final: { label: 'Final', cls: 'tag tag-board' },
  locked: { label: 'Locked', cls: 'tag tag-off' },
};

export default function MarksPage() {
  const toast = useToast();
  const [setup, setSetup] = useState<ExamSetup | null>(null);
  const [examId, setExamId] = useState('');
  const [p, setP] = useState<Progress | null>(null);
  const [filter, setFilter] = useState<'all' | 'late' | 'needs'>('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<ExamSetup>('/exams/setup').then((s) => {
      setSetup(s);
      const all = s.terms.flatMap((t) => t.exams);
      const today = new Date().toISOString().slice(0, 10);
      // Start with the exam whose marks are due next (or the latest one)
      const next = all.filter((x) => x.marksDueOn && x.marksDueOn.slice(0, 10) >= today)
        .sort((a, b) => a.marksDueOn!.localeCompare(b.marksDueOn!))[0] ?? all[all.length - 1];
      setExamId(next?.id ?? '');
    });
  }, []);
  const load = useCallback(async () => { if (examId) setP(await api.get<Progress>(`/marks/progress?examId=${examId}`)); }, [examId]);
  useEffect(() => { setP(null); void load(); }, [load]);
  const exams = useMemo(() => setup?.terms.flatMap((t) => t.exams.map((x) => ({ ...x, termName: t.name }))) ?? [], [setup]);
  if (!setup) return <Loading />;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    try { await fn(); await load(); toast.show(msg); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
  };
  const rows = (p?.rows ?? []).filter((r) => filter === 'all' || (filter === 'late' ? r.overdue : r.teacher.how === 'needs_choice' || r.teacher.how === 'nobody'));
  const count = (f: (r: Row) => boolean) => (p?.rows ?? []).filter(f).length;
  const done = count((r) => r.status === 'submitted' || r.status === 'final');
  const late = count((r) => r.overdue);
  const needs = count((r) => r.teacher.how === 'needs_choice' || r.teacher.how === 'nobody');

  return (
    <>
      <div className="page-head"><div><h1>Exams & report cards</h1>
        <p>Teachers enter and submit marks in the teacher app. Parents see them as soon as they are submitted; teachers can correct them for 7 days, then they are final.</p></div></div>
      <ExamsTabs />
      {exams.length === 0 ? (
        <div className="sheet empty"><h3>No exams yet</h3><p>Add a term and its exams on the first tab, and choose subjects for each class.</p></div>
      ) : (
        <div className="stack">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label htmlFor="exam" className="small muted">Exam</label>
            <select id="exam" className="input" style={{ width: 320 }} value={examId} onChange={(e) => setExamId(e.target.value)}>
              {exams.map((x) => <option key={x.id} value={x.id}>{x.termName}: {x.name}</option>)}
            </select>
            {p ? <>
              <span className="tag tag-board">{done} of {p.rows.length} submitted</span>
              {p.exam.marksDueOn ? <span className="small muted">Due {shortDate(p.exam.marksDueOn)}</span> : null}
            </> : null}
          </div>
          {p && (late > 0 || needs > 0) ? (
            <div className="row" role="group" aria-label="Show">
              <button className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-plain'}`} onClick={() => setFilter('all')}>Everything</button>
              {late ? <button className={`btn ${filter === 'late' ? 'btn-primary' : 'btn-plain'}`} onClick={() => setFilter('late')}>Late ({late})</button> : null}
              {needs ? <button className={`btn ${filter === 'needs' ? 'btn-primary' : 'btn-plain'}`} onClick={() => setFilter('needs')}>Choose a teacher ({needs})</button> : null}
            </div>
          ) : null}
          <ErrorBox error={error} />
          {!p ? <Loading /> : (
            <div className="sheet table-wrap">
              <table className="register">
                <thead><tr><th>Class</th><th>Subject</th><th>Enters the marks</th><th>Entered</th><th>Status</th><th></th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={`${r.sectionId}-${r.subjectId}`}>
                    <td className="nowrap"><strong>{sectionLabel(r.className, r.sectionName)}</strong></td>
                    <td>{r.subjectName}</td>
                    <td style={{ minWidth: 190 }}>
                      {r.teacher.candidates.length > 1 ? (
                        <select className="input" aria-label={`Who enters ${r.subjectName} marks for ${sectionLabel(r.className, r.sectionName)}`}
                          value={r.teacher.how === 'chosen' ? r.teacher.membershipId ?? '' : ''}
                          onChange={(e) => act(() => api.put('/marks/teacher', { sectionId: r.sectionId, subjectId: r.subjectId, membershipId: e.target.value || null }),
                            e.target.value ? 'Teacher chosen' : 'Choice removed')}>
                          <option value="">Choose who enters…</option>
                          {r.teacher.candidates.map((c) => <option key={c.membershipId} value={c.membershipId}>{c.name}</option>)}
                        </select>
                      ) : r.teacher.name ? (
                        <span>{r.teacher.name}{r.teacher.how === 'class_teacher' ? <span className="small muted"> (class teacher)</span> : null}</span>
                      ) : <span className="tag tag-warn">No teacher for this subject</span>}
                    </td>
                    <td style={{ minWidth: 170 }}>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <div className="meter" aria-hidden><span style={{ width: `${r.total ? Math.round((r.entered / r.total) * 100) : 0}%` }} /></div>
                        <span className="small nowrap">{r.entered} of {r.total}</span>
                      </div>
                    </td>
                    <td className="small">
                      <span className={STATUS[r.status].cls}>{STATUS[r.status].label}</span>
                      {r.overdue ? <span className="tag tag-warn">Late</span> : null}
                      {r.status === 'submitted' && r.editableUntil ? <div className="muted">Can be corrected until {shortDate(r.editableUntil)}</div> : null}
                    </td>
                    <td className="actions nowrap">
                      {r.status === 'final' ? (
                        <button className="btn btn-plain" onClick={() => act(() => api.post('/marks/reopen', { examId, sectionId: r.sectionId, subjectId: r.subjectId, days: 3 }),
                          `The teacher can correct ${r.subjectName} marks for 3 more days`)}>Reopen 3 days</button>
                      ) : null}
                      <Link className={r.status === 'to_do' || r.status === 'draft' ? 'btn btn-primary' : 'btn btn-plain'}
                        href={`/exams/marks/enter?examId=${examId}&sectionId=${r.sectionId}&subjectId=${r.subjectId}`}>
                        {r.status === 'to_do' || r.status === 'draft' ? 'Enter marks' : 'Review'}</Link>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {toast.node}
    </>
  );
}
