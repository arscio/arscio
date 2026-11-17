// Certificate PDFs (TC, bonafide, character). Low-ink: white header, outlined crest, thin lines.
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const FONT = (f: string) => fileURLToPath(new URL(`../../assets/fonts/${f}`, import.meta.url));
export const INK = '#0B3B4C';
export const SOFT = '#4A6B78';
export const PEACOCK = '#0B7FA6';
export const RULE = '#BFD3DB';

export interface CertSchool {
  name: string; address: string | null; phone: string | null; email: string | null; board: string;
  affiliationNo: string | null; code: string; logo: { mime: string; data: Buffer } | null;
}
export interface CertSign {
  mode: 'printed' | 'hand'; title: string; name: string | null; image: { mime: string; data: Buffer } | null;
}
export interface CertCommon {
  school: CertSchool; title: string; serialNo: string; admissionNo: string; issuedOn: string;
  duplicate: boolean; preparedBy: string; sign: CertSign; photo?: { mime: string; data: Buffer } | null;
  serialLabel?: string;
}

const pdfOk = (img: { mime: string } | null | undefined) => !!img && (img.mime === 'image/png' || img.mime === 'image/jpeg');

/** Draws the page frame and header; returns the y where the body starts. */
export function header(doc: PDFKit.PDFDocument, c: Pick<CertCommon, 'school' | 'title' | 'serialNo' | 'admissionNo' | 'duplicate' | 'serialLabel'>) {
  const W = doc.page.width;
  const M = 48;
  doc.lineWidth(0.8).strokeColor(RULE).rect(24, 24, W - 48, doc.page.height - 48).stroke();
  // Crest: the school's logo, or its initials in an outlined circle
  const cx = M + 30, cy = 84;
  if (pdfOk(c.school.logo)) {
    doc.image(c.school.logo!.data, cx - 30, cy - 30, { fit: [60, 60], align: 'center', valign: 'center' });
  } else {
    doc.lineWidth(1.4).strokeColor(PEACOCK).circle(cx, cy, 29).stroke();
    const ini = c.school.name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join('');
    doc.font('display').fontSize(18).fillColor(PEACOCK).text(ini, cx - 29, cy - 12, { width: 58, align: 'center' });
  }
  const tx = M + 76, tw = W - tx - M;
  doc.font('display').fontSize(19).fillColor(INK).text(c.school.name, tx, 56, { width: tw });
  doc.font('regular').fontSize(9.5).fillColor(SOFT);
  if (c.school.address) doc.text(c.school.address, { width: tw });
  const line2 = [c.school.affiliationNo ? `Affiliated to ${c.school.board}, No. ${c.school.affiliationNo}` : c.school.board,
    c.school.phone ? `Phone ${c.school.phone}` : null, c.school.email].filter(Boolean).join('   ');
  doc.text(line2, { width: tw });
  const y = Math.max(doc.y, cy + 34) + 12;
  doc.lineWidth(1.2).strokeColor(PEACOCK).moveTo(M, y).lineTo(W - M, y).stroke();

  // Title, outlined (no ink-heavy fill)
  const title = c.title.toUpperCase();
  doc.font('display').fontSize(13);
  const tW = doc.widthOfString(title, { characterSpacing: 2 }) + 36;
  const tY = y + 18;
  doc.lineWidth(1).strokeColor(PEACOCK).roundedRect((W - tW) / 2, tY, tW, 26, 13).stroke();
  doc.fillColor(PEACOCK).text(title, (W - tW) / 2, tY + 7, { width: tW, align: 'center', characterSpacing: 2 });
  if (c.duplicate) {
    doc.font('display').fontSize(9).fillColor('#B4432F').text('DUPLICATE COPY', W - M - 120, tY + 9, { width: 120, align: 'right' });
  }
  const mY = tY + 42;
  doc.font('regular').fontSize(9.5).fillColor(SOFT)
    .text(`${c.serialLabel ?? 'Serial no.'} `, M, mY, { continued: true }).font('semibold').fillColor(INK).text(c.serialNo);
  doc.font('semibold').fontSize(9.5);
  const vW = doc.widthOfString(c.admissionNo);
  doc.fillColor(INK).text(c.admissionNo, W - M - vW, mY, { lineBreak: false });
  doc.font('regular');
  const lW = doc.widthOfString('Admission no. ');
  doc.fillColor(SOFT).text('Admission no. ', W - M - vW - lW, mY, { lineBreak: false });
  return mY + 30;
}

function footer(doc: PDFKit.PDFDocument, c: CertCommon) {
  const W = doc.page.width, H = doc.page.height, M = 48;
  doc.page.margins.bottom = 0; // the footer sits below the normal margin; don't start a new page
  const y = H - 150;
  doc.font('regular').fontSize(9.5).fillColor(SOFT)
    .text('Date of issue', M, y + 40).font('semibold').fillColor(INK).text(c.issuedOn, M, y + 54)
    .font('regular').fillColor(SOFT).text(`Prepared by ${c.preparedBy}`, M, y + 72);
  const sx = W - M - 190;
  if (c.sign.mode === 'printed' && pdfOk(c.sign.image)) {
    doc.image(c.sign.image!.data, sx + 25, y - 6, { fit: [140, 52], align: 'center', valign: 'bottom' });
  }
  doc.lineWidth(0.8).strokeColor(INK).moveTo(sx, y + 52).lineTo(W - M, y + 52).stroke();
  doc.font('semibold').fontSize(10).fillColor(INK).text(c.sign.name ?? '', sx, y + 58, { width: 190, align: 'center' });
  doc.font('regular').fontSize(9.5).fillColor(SOFT).text(c.sign.title, sx, doc.y, { width: 190, align: 'center' });
  doc.text('(with school seal)', sx, doc.y, { width: 190, align: 'center' });
  doc.font('regular').fontSize(7.5).fillColor('#8AA3AD').text('Powered by Arscio', 0, H - 40, { width: W, align: 'center', lineBreak: false });
}

export function newDoc() {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Creator: 'Arscio' } });
  doc.registerFont('regular', FONT('Figtree_400Regular.ttf'));
  doc.registerFont('semibold', FONT('Figtree_600SemiBold.ttf'));
  doc.registerFont('display', FONT('BricolageGrotesque_700Bold.ttf'));
  return doc;
}
export const finish = (doc: PDFKit.PDFDocument) => new Promise<Buffer>((ok, fail) => {
  const parts: Buffer[] = [];
  doc.on('data', (b: Buffer) => parts.push(b)); doc.on('end', () => ok(Buffer.concat(parts))); doc.on('error', fail);
  doc.end();
});

/** Transfer certificate: numbered rows, as boards expect. */
export async function tcPdf(c: CertCommon, rows: [string, string][]) {
  const doc = newDoc();
  let y = header(doc, c);
  const W = doc.page.width, M = 48;
  const labelW = 230, valX = M + labelW + 12, valW = W - M - valX;
  rows.forEach(([label, value], i) => {
    doc.font('regular').fontSize(10).fillColor(SOFT);
    const lh = doc.heightOfString(`${i + 1}.  ${label}`, { width: labelW });
    doc.font('semibold').fontSize(10.5);
    const vh = doc.heightOfString(value || '—', { width: valW });
    const h = Math.max(lh, vh);
    doc.font('regular').fontSize(10).fillColor(SOFT).text(`${i + 1}.  ${label}`, M, y, { width: labelW });
    doc.font('semibold').fontSize(10.5).fillColor(INK).text(value || '—', valX, y - 0.5, { width: valW });
    y += h + 6;
    doc.lineWidth(0.5).strokeColor(RULE).dash(1.5, { space: 2.5 }).moveTo(valX, y - 3).lineTo(W - M, y - 3).stroke().undash();
    y += 5;
  });
  footer(doc, c);
  return finish(doc);
}

/** Bonafide and character certificates: a short letter. */
export async function letterPdf(c: CertCommon, paragraphs: string[]) {
  const doc = newDoc();
  const y = header(doc, c) + 16;
  const W = doc.page.width, M = 48;
  const tx = M + 10;
  let tw = W - 2 * M - 20;
  if (pdfOk(c.photo)) {
    // Bonafide often carries the student's photo, top right
    doc.save().roundedRect(W - M - 92, y, 82, 100, 6).clip().image(c.photo!.data, W - M - 92, y, { cover: [82, 100], align: 'center', valign: 'center' }).restore();
    doc.lineWidth(0.8).strokeColor(RULE).roundedRect(W - M - 92, y, 82, 100, 6).stroke();
    tw -= 100;
  }
  doc.font('regular').fontSize(12).fillColor(INK);
  doc.text('', tx, y);
  paragraphs.forEach((p, i) => {
    if (i === 1 && pdfOk(c.photo)) tw += 100; // text runs full width below the photo
    doc.text(p, tx, doc.y, { width: tw, align: 'justify', lineGap: 6 });
    doc.moveDown(1);
    if (doc.y < y + 110 && pdfOk(c.photo) && i === 0) doc.y = y + 110;
  });
  footer(doc, c);
  return finish(doc);
}
