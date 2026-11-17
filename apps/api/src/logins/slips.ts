// Login slips: 8 per A4 page, cut along the dashed lines and send home.
// Low-ink: no filled blocks, just thin lines.
import QRCode from 'qrcode';
import { INK, PEACOCK, RULE, SOFT, finish, newDoc } from '../certificates/pdf.js';

export interface ParentSlip { studentName: string; className: string; admissionNo: string; hasDob: boolean }
export interface StaffSlip { name: string; logins: string[]; password: string }

const COLS = 2, ROWS = 4;

async function qr(url: string | undefined) {
  return url ? QRCode.toBuffer(url, { margin: 0, width: 220, errorCorrectionLevel: 'M' }) : null;
}

function grid(doc: PDFKit.PDFDocument, count: number, draw: (x: number, y: number, w: number, h: number, i: number) => void) {
  const W = doc.page.width, H = doc.page.height, M = 24;
  const w = (W - M * 2) / COLS, h = (H - M * 2) / ROWS;
  for (let i = 0; i < count; i++) {
    const k = i % (COLS * ROWS);
    if (i > 0 && k === 0) doc.addPage();
    const x = M + (k % COLS) * w, y = M + Math.floor(k / COLS) * h;
    doc.save().lineWidth(0.6).dash(4, { space: 3 }).strokeColor(RULE).rect(x, y, w, h).stroke().restore();
    draw(x + 16, y + 14, w - 32, h - 28, i);
  }
}

/** Slips fill the page edge to edge, so the page's own margins must not push text onto a new page. */
function slipDoc() {
  const doc = newDoc();
  const noMargins = () => { doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 }; };
  noMargins();
  doc.on('pageAdded', noMargins);
  return doc;
}

export async function parentSlipsPdf(school: string, slips: ParentSlip[], appUrl?: string) {
  const doc = slipDoc();
  const code = await qr(appUrl);
  grid(doc, slips.length, (x, y, w, h, i) => {
    const s = slips[i]!;
    const textW = code ? w - 92 : w;
    doc.font('display').fontSize(11.5).fillColor(INK).text(school, x, y, { width: textW });
    doc.font('regular').fontSize(8.5).fillColor(SOFT).text('Parent app login', { width: textW });
    doc.moveDown(0.5);
    doc.font('display').fontSize(11).fillColor(INK).text(s.studentName, { width: textW });
    doc.font('regular').fontSize(8.5).fillColor(SOFT).text(s.className, { width: textW });
    doc.moveDown(0.5);
    doc.font('regular').fontSize(8.5).fillColor(SOFT).text('Login ID (admission number)', { width: textW });
    doc.font('display').fontSize(13).fillColor(PEACOCK).text(s.admissionNo, { width: textW });
    doc.font('regular').fontSize(8.5).fillColor(SOFT).text('First password', { width: textW });
    doc.font('display').fontSize(10).fillColor(INK)
      .text(s.hasDob ? "Child's date of birth as DDMMYYYY" : 'Ask the school office (date of birth missing)', { width: textW });
    doc.font('regular').fontSize(8).fillColor(SOFT).text('Example: 5 August 2015 is 05082015', { width: textW });
    doc.font('regular').fontSize(7.5).fillColor(SOFT)
      .text('You will be asked to choose your own password after the first login. One login works for all your children at this school.',
        x, y + h - 26, { width: w });
    if (code) {
      doc.image(code, x + w - 80, y + 4, { width: 80 });
      doc.font('regular').fontSize(7).fillColor(SOFT).text('Scan to get the app', x + w - 84, y + 88, { width: 88, align: 'center' });
    }
  });
  if (!slips.length) doc.font('regular').fontSize(12).fillColor(SOFT).text('No students in this class.', 48, 60);
  return finish(doc);
}
