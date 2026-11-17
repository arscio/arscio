'use client';
// Report cards for one class: check every child's results, write the class teacher's
// remark, then print one card or the whole class.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { classLabel, sectionLabel, type Structure } from '@/lib/types';
import { ExamsTabs, pct, type Report } from '@/components/Exams';
import { Loading, useToast } from '@/components/ui';

export default function ReportCardsPage() {
  const toast = useToast();
  const [structure, setStructure] = useState<Structure | null>(null);
  const [sectionId, setSectionId] = useState('');
  const [data, setData] = useState<{ reports: Report[] } | null>(null);
  const [termId, setTermId] = useState('');

  useEffect(() => {
    api.get<Structure>('/setup/structure').then((s) => {
      setStructure(s);
      const first = s.classes.flatMap((c) => c.sections)[0];
      if (first) setSectionId(first.id);
    });
  }, []);
  const load = useCallback(async () => {
    if (!sectionId) return;
    setData(null);
    const r = await api.get<{ reports: Report[] }>(`/reportcards/section/${sectionId}`);
    setData(r);
    // Default to the latest term that already has some marks.
    const withMarks = (r.reports[0]?.terms ?? []).filter((t) => r.reports.some((rep) => rep.terms.find((x) => x.id === t.id)?.rows.some((row) => row.cells.some((c) => c.entered))));
    setTermId((t) => (r.reports[0]?.terms.some((x) => x.id === t) ? t : (withMarks.at(-1) ?? r.reports[0]?.terms[0])?.id ?? ''));
  }, [sectionId]);
  useEffect(() => { void load(); }, [load]);
  if (!structure) return <Loading />;

  const terms = data?.reports[0]?.terms ?? [];
  // An exam has "started" once anyone in the class has marks for it; only then do gaps count as missing.
  const started = new Set((data?.reports ?? []).flatMap((rep) => rep.terms.flatMap((t) => t.rows.flatMap((row) => row.cells.filter((c) => c.entered).map((c) => c.examId)))));
  const saveRemark = async (studentId: string, remark: string) => {
    try { await api.put('/reportcards/remark', { termId, studentId, remark }); toast.show('Remark saved'); }
    catch (e) { toast.show(e instanceof ApiError ? e.message : 'Could not save'); }
  };

  return (
    <>
      <div className="page-head"><div><h1>Exams & report cards</h1><p>Check each child&apos;s results and write remarks, then print. Parents see a term only after you publish it.</p></div></div>
      <ExamsTabs />
      <div className="stack">
        <div className="row">
          <label htmlFor="sec" className="small muted">Class</label>
          <select id="sec" className="input" style={{ width: 200 }} value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            {structure.classes.flatMap((c) => c.sections.map((s) => <option key={s.id} value={s.id}>{sectionLabel(c.name, s.name)}</option>))}
          </select>
          {terms.length ? (<>
            <label htmlFor="term" className="small muted">Remarks for</label>
            <select id="term" className="input" style={{ width: 160 }} value={termId} onChange={(e) => setTermId(e.target.value)}>
              {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </>) : null}
          {data?.reports.length ? <Link className="btn btn-primary" style={{ marginLeft: 'auto' }} href={`/exams/report-cards/print?section=${sectionId}`}>Print the whole class</Link> : null}
        </div>
        {!data ? <Loading /> : data.reports.length === 0 ? (
          <div className="sheet empty"><h3>No students in this class</h3></div>
        ) : (
          <div className="sheet table-wrap">
            <table className="register">
              <thead><tr><th>Roll</th><th>Student</th>{terms.map((t) => <th key={t.id} className="money">{t.name}</th>)}<th className="money">Attendance</th><th>Class teacher&apos;s remark</th><th></th></tr></thead>
              <tbody>{data.reports.map((r) => {
                const term = r.terms.find((t) => t.id === termId);
                const missing = r.terms.reduce((a, t) => a + t.rows.reduce((b, row) => b + row.cells.filter((c) => !c.entered && started.has(c.examId)).length, 0), 0);
                return (
                  <tr key={r.student.id}>
                    <td className="muted">{r.student.rollNo ?? '-'}</td>
                    <td><strong>{r.student.name}</strong>{missing ? <div className="small" style={{ color: 'var(--marigold)' }}>{missing} marks missing</div> : null}</td>
                    {r.terms.map((t) => <td key={t.id} className="money">{r.style === 'grades_only' ? '' : pct(t.pct)} <strong>{t.grade ?? ''}</strong></td>)}
                    <td className="money">{pct(r.attendance.pct)}</td>
                    <td style={{ minWidth: 260 }}>
                      {term ? (
                        <input key={`${termId}-${r.student.id}`} className="input" defaultValue={term.remark ?? ''} placeholder="A short remark for the parents"
                          aria-label={`Remark for ${r.student.name}`} maxLength={400}
                          onBlur={(e) => { if (e.target.value.trim() !== (term.remark ?? '')) void saveRemark(r.student.id, e.target.value.trim()).then(load); }} />
                      ) : <span className="muted small">Add a term first</span>}
                    </td>
                    <td className="actions"><Link className="btn btn-plain" href={`/exams/report-cards/print?student=${r.student.id}`}>View</Link></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </div>
      {toast.node}
    </>
  );
}
