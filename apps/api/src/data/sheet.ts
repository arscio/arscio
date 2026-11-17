// Reading Excel/CSV files and turning messy cell values into clean ones.
import ExcelJS from 'exceljs';
import { badRequest } from '../errors.js';

export type Cell = string | number | boolean | Date | null;

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue);
    if ('text' in v) return String((v as { text: unknown }).text);
    if ('error' in v) return null;
  }
  return String(v);
}

function parseCsv(text: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [], cur = '', q = false;
  const delim = (text.split('\n')[0]!.match(/;/g)?.length ?? 0) > (text.split('\n')[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.map((r) => r.map((x) => (x === '' ? null : x)));
}

export interface Sheet { name: string; headers: string[]; rows: Cell[][]; headerRow: number; rowNumbers: number[] }

/** Read every sheet. The header row is the first row with at least two filled cells. */
export async function readWorkbook(buf: Buffer, fileName: string): Promise<Sheet[]> {
  let raw: { name: string; rows: Cell[][] }[];
  if (/\.csv$/i.test(fileName) || (!buf.subarray(0, 2).equals(Buffer.from('PK')))) {
    if (buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
      throw badRequest('old_excel', 'This is an old Excel file (.xls). In Excel, choose File, Save As, “Excel Workbook (.xlsx)”, then upload that.');
    }
    raw = [{ name: 'Sheet1', rows: parseCsv(buf.toString('utf8').replace(/^﻿/, '')) }];
  } else {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf as unknown as ArrayBuffer); } catch { throw badRequest('bad_file', 'This file could not be opened. Please upload an Excel (.xlsx) or CSV file.'); }
    raw = wb.worksheets.map((ws) => {
      const rows: Cell[][] = [];
      ws.eachRow({ includeEmpty: true }, (r, n) => {
        const vals = (r.values as ExcelJS.CellValue[]).slice(1).map(cellValue);
        rows[n - 1] = vals;
      });
      return { name: ws.name, rows: Array.from(rows, (r) => r ?? []) };
    });
  }
  return raw.map(({ name, rows }) => {
    const h = rows.findIndex((r) => r.filter((c) => c !== null && String(c).trim() !== '').length >= 2);
    if (h < 0) return { name, headers: [], rows: [], headerRow: 0, rowNumbers: [] };
    const width = Math.max(...rows.slice(h).map((r) => r.length));
    const headers = Array.from({ length: width }, (_, i) => text(rows[h]![i] ?? null) ?? `Column ${i + 1}`);
    const body = rows.slice(h + 1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null))
      .map((r, i) => ({ r, n: h + 2 + i }));
    // Drop blank rows, but remember real row numbers for error messages
    const kept = body.filter(({ r }) => r.some((c) => c !== null && String(c).trim() !== ''));
    return { name, headers, rows: kept.map((k) => k.r), headerRow: h + 1, rowNumbers: kept.map((k) => k.n) };
  }).filter((s) => s.headers.length);
}

// ---------------- Cleaning values ----------------

export function text(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Dates as Indian schools write them: 14/03/2013, 14-03-2013, 14.3.13, 14 Mar 2013, 2013-03-14, or an Excel date. */
export function date(v: Cell): { ok: true; value: string | null } | { ok: false } {
  if (v === null) return { ok: true, value: null };
  const iso = (y: number, m: number, d: number) => {
    if (y < 100) y += y > 50 ? 1900 : 2000;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { ok: false as const };
    return { ok: true as const, value: dt.toISOString().slice(0, 10) };
  };
  if (v instanceof Date) return iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') { // Excel serial date
    if (v < 1 || v > 80000) return { ok: false };
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return { ok: true, value: d.toISOString().slice(0, 10) };
  }
  const s = String(v).trim().toLowerCase();
  if (!s) return { ok: true, value: null };
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/.exec(s);
  if (m) return iso(+m[3]!, +m[2]!, +m[1]!);
  m = /^(\d{1,2})(?:st|nd|rd|th)?[-/ ,]*([a-z]{3})[a-z]*[-/ ,]*(\d{2,4})$/.exec(s);
  if (m && MONTHS.includes(m[2]!)) return iso(+m[3]!, MONTHS.indexOf(m[2]!) + 1, +m[1]!);
  return { ok: false };
}

const ROMAN: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12' };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Match a class (and maybe a section) written in many ways: "7", "VII", "Class 7", "7th", "Std VII",
 * "7A", "VII-B", "Class 7 A", "LKG", "Nur". Returns the school's class name and any section found.
 */
export function matchClass(v: Cell, classNames: string[]): { className: string; section: string | null } | null {
  const s = text(v);
  if (!s) return null;
  const t = s.toLowerCase().replace(/\b(class|std|standard|grade|cls)\b\.?/g, ' ').replace(/\s+/g, ' ').trim();
  const byName = new Map(classNames.map((c) => [norm(c), c]));
  if (byName.has(norm(t))) return { className: byName.get(norm(t))!, section: null };
  const alias: Record<string, string> = { nur: 'nursery', kg1: 'lkg', kg2: 'ukg', lowerkg: 'lkg', upperkg: 'ukg' };
  if (alias[norm(t)] && byName.has(alias[norm(t)]!)) return { className: byName.get(alias[norm(t)]!)!, section: null };
  // Split off a section letter at the end: "7a", "vii - b", "7 (a)"
  const m = /^(.*?)[\s\-/(]*([a-z])\)?$/.exec(t);
  const tries: [string, string | null][] = [[t, null]];
  if (m && m[1]) tries.push([m[1].trim(), m[2]!.toUpperCase()]);
  for (const [c, sec] of tries) {
    let k = c.replace(/(\d+)(st|nd|rd|th)$/, '$1');
    if (ROMAN[k]) k = ROMAN[k]!;
    if (byName.has(norm(k))) return { className: byName.get(norm(k))!, section: sec };
  }
  return null;
}

export function gender(v: Cell): 'male' | 'female' | 'other' | null | undefined {
  const s = text(v)?.toLowerCase();
  if (!s) return null;
  if (['m', 'male', 'boy', 'b'].includes(s)) return 'male';
  if (['f', 'female', 'girl', 'g'].includes(s)) return 'female';
  if (['o', 'other', 'others'].includes(s)) return 'other';
  return undefined; // not understood
}

export function int(v: Cell): number | null | undefined {
  if (v === null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isInteger(n) ? n : undefined;
}

/** Digits only (Excel often turns phone numbers into 9.87e9 or adds .0). */
export function digits(v: Cell): string | null {
  if (v === null) return null;
  if (typeof v === 'number') return String(Math.round(v));
  const s = String(v).replace(/\.0+$/, '').replace(/\D/g, '');
  return s || null;
}
