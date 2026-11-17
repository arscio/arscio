// A year's report card as a PDF, filed in the student's file when the school year ends.
import { INK, PEACOCK, RULE, SOFT, finish, header, newDoc, type CertSchool } from '../certificates/pdf.js';
import { classFig, dateShort } from '../certificates/words.js';
import type { buildReport } from './report.js';

type Report = Awaited<ReturnType<typeof buildReport>>;

const cellText = (pct: number | null, grade: string | null, gradesOnly: boolean) =>
  gradesOnly ? (grade ?? '—') : pct === null ? '—' : `${pct}%${grade ? `  ${grade}` : ''}`;

export async function reportCardPdf(r: Report, school: CertSchool, result: string | null) {
  const doc = newDoc();
  const W = doc.page.width, M = 48;
  let y = header(doc, { school, title: 'Report card', serialNo: r.yearName, serialLabel: 'Session', admissionNo: r.student.admissionNo, duplicate: false });
  const gradesOnly = r.style === 'grades_only';

  // Student details, two columns
  const facts: [string, string][] = [
    ['Name', r.student.name], ['Class', `${classFig(r.student.className)}${r.student.sectionName ? ` ${r.student.sectionName}` : ''}`],
    ['Roll no.', r.student.rollNo != null ? String(r.student.rollNo) : '—'], ['Date of birth', r.student.dateOfBirth ? dateShort(String(r.student.dateOfBirth)) : '—'],
    ["Father's name", r.student.fatherName ?? '—'], ["Mother's name", r.student.motherName ?? '—'],
  ];
  const colW = (W - 2 * M) / 2;
  facts.forEach(([k, v], i) => {
    const x = M + (i % 2) * colW, yy = y + Math.floor(i / 2) * 18;
    doc.font('regular').fontSize(9).fillColor(SOFT).text(k, x, yy, { width: 90, lineBreak: false });
    doc.font('semibold').fontSize(10).fillColor(INK).text(v, x + 92, yy - 0.5, { width: colW - 100, lineBreak: false, ellipsis: true });
  });
  y += Math.ceil(facts.length / 2) * 18 + 12;

  // Marks table: subjects down, terms across, then the whole year
  const cols = [...r.terms.map((t) => t.name), ...(r.year ? ['Whole year'] : [])];
  const subjW = 170;
  const cw = Math.min(110, (W - 2 * M - subjW) / Math.max(cols.length, 1));
  const rowH = 20;
  const drawRow = (cells: string[], opts: { head?: boolean; total?: boolean }) => {
    if (opts.head || opts.total) doc.rect(M, y, subjW + cw * cols.length, rowH).fillColor(opts.head ? '#EEF6F9' : '#F6FAFB').fill();
    doc.font(opts.head || opts.total ? 'semibold' : 'regular').fontSize(9.5).fillColor(opts.head ? PEACOCK : INK);
    doc.text(cells[0]!, M + 8, y + 6, { width: subjW - 12, lineBreak: false, ellipsis: true });
    cells.slice(1).forEach((c, i) => doc.text(c, M + subjW + i * cw, y + 6, { width: cw, align: 'center', lineBreak: false }));
    y += rowH;
    doc.lineWidth(0.5).strokeColor(RULE).moveTo(M, y).lineTo(M + subjW + cw * cols.length, y).stroke();
  };
  drawRow(['Subject', ...cols], { head: true });
  const subjects = r.terms[0]?.rows.map((x) => x.subject) ?? r.year?.rows.map((x) => x.subject) ?? [];
  subjects.forEach((name, i) => {
    drawRow([name, ...r.terms.map((t) => cellText(t.rows[i]?.pct ?? null, t.rows[i]?.grade ?? null, gradesOnly)),
      ...(r.year ? [cellText(r.year.rows[i]?.pct ?? null, r.year.rows[i]?.grade ?? null, false)] : [])], {});
  });
  if (!gradesOnly) drawRow(['Overall', ...r.terms.map((t) => cellText(t.pct, t.grade, false)), ...(r.year ? [cellText(r.year.pct, r.year.grade, false)] : [])], { total: true });
  if (!subjects.length) { doc.font('regular').fontSize(10).fillColor(SOFT).text('No marks were recorded this year.', M, y + 8); y += 30; }
  y += 16;

  // Attendance and result
  doc.font('regular').fontSize(9.5).fillColor(SOFT).text('Attendance', M, y);
  doc.font('semibold').fontSize(10.5).fillColor(INK).text(
    r.attendance.days ? `${r.attendance.present} of ${r.attendance.days} days${r.attendance.pct !== null ? ` (${r.attendance.pct}%)` : ''}` : '—', M + 92, y - 0.5);
  if (result) {
    doc.font('regular').fontSize(9.5).fillColor(SOFT).text('Result', M + colW, y);
    doc.font('semibold').fontSize(10.5).fillColor(INK).text(result, M + colW + 92, y - 0.5, { width: colW - 92 });
  }
  y += 26;
  if (r.year?.needsSupportIn.length) {
    doc.font('regular').fontSize(9.5).fillColor(SOFT).text(`Needs support in: ${r.year.needsSupportIn.join(', ')}`, M, y); y += 18;
  }
  const remarks = r.terms.filter((t) => t.remark);
  if (remarks.length) {
    doc.font('semibold').fontSize(10).fillColor(INK).text("Class teacher's remarks", M, y); y = doc.y + 4;
    for (const t of remarks) {
      doc.font('regular').fontSize(9.5).fillColor(SOFT).text(`${t.name}: `, M, y, { continued: true }).fillColor(INK).text(t.remark!, { width: W - 2 * M });
      y = doc.y + 4;
    }
  }

  // Signatures
  const H = doc.page.height;
  doc.page.margins.bottom = 0;
  const sy = H - 110, sw = (W - 2 * M - 40) / 3;
  [`Class teacher${r.student.classTeacher ? `\n${r.student.classTeacher}` : ''}`, 'Principal', 'Parent'].forEach((label, i) => {
    const x = M + i * (sw + 20);
    doc.lineWidth(0.8).strokeColor(INK).moveTo(x, sy).lineTo(x + sw, sy).stroke();
    doc.font('regular').fontSize(9).fillColor(SOFT).text(label, x, sy + 6, { width: sw, align: 'center' });
  });
  doc.font('regular').fontSize(7.5).fillColor('#8AA3AD').text('Powered by Arscio', 0, H - 40, { width: W, align: 'center', lineBreak: false });
  return finish(doc);
}
