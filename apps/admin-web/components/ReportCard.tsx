'use client';
// A printable report card. It's the SCHOOL's document (school name, crest and colour),
// printed with little ink, with a small "Powered by Arscio" at the very bottom.
import { photoSrc } from '@/lib/api';
import { classLabel, sectionLabel } from '@/lib/types';
import { num, pct, type Report } from './Exams';

const date = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');

export function ReportCard({ r }: { r: Report }) {
  const initials = r.school.shortName ?? r.school.name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('').slice(0, 3);
  const studentInitials = r.student.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
  const marks = r.style === 'marks_and_grades';
  return (
    <article className="report" style={{ ['--school' as string]: r.school.brandColor ?? undefined }} aria-label={`Report card for ${r.student.name}`}>
      <div className="receipt-watermark" aria-hidden>{initials}</div>
      <header className="receipt-head">
        <div className="receipt-crest">{r.school.logoUrl ? <img src={`/api/school-logo/${r.school.id}`} alt="" /> : <span>{initials}</span>}</div>
        <div>
          <h2>{r.school.name}</h2>
          <div className="small muted">{[r.school.affiliationNo ? `${r.school.board} Affiliation No. ${r.school.affiliationNo}` : null, r.school.address].filter(Boolean).join(' · ')}</div>
        </div>
      </header>
      <div className="receipt-band">
        <span className="receipt-tag">REPORT CARD</span>
        <span className="small muted">Session {r.yearName}</span>
      </div>
      <div className="receipt-rule" aria-hidden />

      <div className="report-student">
        <dl>
          <div><dt>Student</dt><dd>{r.student.name}</dd></div>
          <div><dt>Class</dt><dd>{sectionLabel(r.student.className, r.student.sectionName)}{r.student.rollNo ? `, Roll ${String(r.student.rollNo).padStart(2, '0')}` : ''}</dd></div>
          <div><dt>Admission no.</dt><dd>{r.student.admissionNo}</dd></div>
          <div><dt>Date of birth</dt><dd>{date(r.student.dateOfBirth)}</dd></div>
          <div><dt>Father</dt><dd>{r.student.fatherName ?? '-'}</dd></div>
          <div><dt>Mother</dt><dd>{r.student.motherName ?? '-'}</dd></div>
        </dl>
        <div className="report-photo">{r.student.photoUrl ? <img src={photoSrc(r.student.photoUrl)!} alt="" /> : <span aria-hidden>{studentInitials}</span>}</div>
      </div>

      {r.terms.length === 0 ? <p className="muted" style={{ margin: '18px 0' }}>No results yet.</p> : r.terms.map((t) => (
        <section key={t.id} className="report-term">
          <h3>{t.name}</h3>
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                {t.exams.map((x) => <th key={x.id} className="c">{x.name}{marks ? <span className="w">{num(x.max)} marks · {num(x.weightagePct)}%</span> : null}</th>)}
                {marks ? <th className="c">Term</th> : null}
                <th className="c">Grade</th>
              </tr>
            </thead>
            <tbody>{t.rows.map((row) => (
              <tr key={row.subjectId}>
                <td>{row.subject}</td>
                {row.cells.map((c) => (
                  <td key={c.examId} className="c">
                    {!c.entered ? <span className="muted">-</span> : c.absent ? 'AB' : marks ? num(c.marks ?? 0) : c.grade}
                  </td>
                ))}
                {marks ? <td className="c">{pct(row.pct)}</td> : null}
                <td className="c"><strong>{row.grade ?? '-'}</strong></td>
              </tr>
            ))}</tbody>
            {marks ? (
              <tfoot><tr><td><strong>Overall</strong></td>{t.exams.map((x) => <td key={x.id} />)}<td className="c"><strong>{pct(t.pct)}</strong></td><td className="c"><strong>{t.grade ?? '-'}</strong></td></tr></tfoot>
            ) : null}
          </table>
          {t.remark ? <p className="report-remark"><span className="muted">Class teacher&apos;s remark: </span>{t.remark}</p> : null}
        </section>
      ))}

      {r.year && r.terms.length > 1 ? (
        <section className="report-term">
          <h3>Whole year</h3>
          <table>
            <thead><tr><th>Subject</th>{r.terms.map((t) => <th key={t.id} className="c">{t.name}</th>)}<th className="c">Year</th><th className="c">Grade</th></tr></thead>
            <tbody>{r.year.rows.map((row, i) => (
              <tr key={row.subject}><td>{row.subject}</td>{r.terms.map((t) => <td key={t.id} className="c">{pct(t.rows[i]!.pct)}</td>)}<td className="c">{pct(row.pct)}</td><td className="c"><strong>{row.grade ?? '-'}</strong></td></tr>
            ))}</tbody>
            <tfoot><tr><td><strong>Overall</strong></td>{r.terms.map((t) => <td key={t.id} className="c">{pct(t.pct)}</td>)}<td className="c"><strong>{pct(r.year.pct)}</strong></td><td className="c"><strong>{r.year.grade ?? '-'}</strong></td></tr></tfoot>
          </table>
        </section>
      ) : null}

      <div className="report-facts">
        <div><span className="muted">Attendance: </span><strong>{r.attendance.days ? `${num(r.attendance.present)} of ${r.attendance.days} days (${pct(r.attendance.pct)})` : '-'}</strong></div>
        {r.year?.needsSupportIn.length ? <div><span className="muted">Needs extra support in: </span><strong>{r.year.needsSupportIn.join(', ')}</strong></div> : null}
      </div>

      {r.scale.length ? (
        <p className="report-scale small muted">
          Grades: {r.scale.map((b) => (b.min !== undefined ? `${b.grade} ${b.min}–${Math.floor(b.max ?? 100)}` : `${b.grade} ${b.label ?? ''}`)).join(' · ')}{marks ? '. AB = absent.' : ''}
        </p>
      ) : null}

      <div className="report-signs">
        <span className="sign">Class teacher{r.student.classTeacher ? `: ${r.student.classTeacher}` : ''}</span>
        <span className="sign">Principal</span>
        <span className="sign">Parent</span>
      </div>
      <p className="receipt-powered">
        <svg width="11" height="11" viewBox="0 0 100 100" aria-hidden focusable="false">
          <g fill="#0B7FA6" stroke="#0B7FA6" strokeWidth="7" strokeLinejoin="round"><path d="M10 89L41 12H59L90 89H74L50 33L26 89Z" /></g>
          <path d="M41 80C41 66 49 58 61 57C61 71 53 79 41 80Z" fill="#F2A33A" />
        </svg>
        Powered by Arscio
      </p>
    </article>
  );
}
