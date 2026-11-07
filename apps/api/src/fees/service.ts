// Fee collection and receipts.
//
// Rules enforced here AND again by the database:
//   - you can't collect more than is owed on a fee line
//   - receipt numbers run in order with no gaps or repeats (per school, per year)
//   - receipts are never deleted; cancelling needs a reason, and saves who + when
import type { Tx } from '../db.js';
import { badRequest, notFound } from '../errors.js';

export interface ReceiptLineInput {
  feeDueId: string;
  amount: string;   // money as text, e.g. "1500.00"
  fine?: string;
}

export interface CreateReceiptInput {
  studentId: string;
  mode: 'cash' | 'upi' | 'cheque' | 'bank_transfer' | 'card' | 'online';
  reference?: string;
  paidOn?: string;
  lines: ReceiptLineInput[];
}

/** Money is handled in paise (whole numbers) to avoid rounding errors. */
export const toPaise = (v: string | number): number => {
  const s = String(v).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw badRequest('bad_amount', `Invalid amount: ${s}`);
  const [r, p = ''] = s.split('.');
  return Number(r) * 100 + Number(p.padEnd(2, '0'));
};
export const fromPaise = (p: number): string => `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;

/** Suggested late fine for an instalment, as of a date. */
export function lateFine(
  inst: { due_on: string; grace_days: number; fine_type: string; fine_amount: string; fine_cap: string | null },
  onDate: string,
): string {
  if (inst.fine_type === 'none') return '0.00';
  const due = Date.parse(`${inst.due_on}T00:00:00Z`) + inst.grace_days * 86_400_000;
  const today = Date.parse(`${onDate}T00:00:00Z`);
  const daysLate = Math.floor((today - due) / 86_400_000);
  if (daysLate <= 0) return '0.00';
  let fine = inst.fine_type === 'flat' ? toPaise(inst.fine_amount) : toPaise(inst.fine_amount) * daysLate;
  if (inst.fine_cap !== null) fine = Math.min(fine, toPaise(inst.fine_cap));
  return fromPaise(fine);
}

export async function studentDues(tx: Tx, studentId: string, onDate: string) {
  const rows = (
    await tx.query(
      `SELECT b.fee_due_id, h.name AS fee_head, i.name AS instalment, i.due_on, i.grace_days,
              i.fine_type, i.fine_amount, i.fine_cap, b.amount, b.concession, b.paid, b.balance
         FROM fee_due_balances b
         JOIN fee_heads h ON h.id = b.fee_head_id
         JOIN fee_instalments i ON i.id = b.instalment_id
        WHERE b.student_id = $1
        ORDER BY i.due_on, h.name`,
      [studentId],
    )
  ).rows;
  // The late fine is per INSTALMENT, not per fee type: suggest it once,
  // on the first unpaid line of each late instalment.
  const fineShown = new Set<string>();
  return rows.map((r) => {
    let suggestedFine = '0.00';
    if (toPaise(r.balance) > 0 && !fineShown.has(r.instalment)) {
      suggestedFine = lateFine(r, onDate);
      fineShown.add(r.instalment);
    }
    return {
    feeDueId: r.fee_due_id,
    feeHead: r.fee_head,
    instalment: r.instalment,
    dueOn: r.due_on,
    amount: r.amount,
    concession: r.concession,
    paid: r.paid,
    balance: r.balance,
    suggestedFine,
  };
  });
}

export async function createReceipt(tx: Tx, input: CreateReceiptInput, collectedBy: string) {
  if (input.lines.length === 0) throw badRequest('no_lines', 'Choose at least one fee to collect');
  const ids = input.lines.map((l) => l.feeDueId);
  if (new Set(ids).size !== ids.length) throw badRequest('duplicate_line', 'A fee line appears twice');

  // Lock these fee lines so two counters can't collect the same fee at once.
  const dues = (
    await tx.query<{ id: string; student_id: string; academic_year_id: string }>(
      'SELECT id, student_id, academic_year_id FROM fee_dues WHERE id = ANY($1::uuid[]) FOR UPDATE',
      [ids],
    )
  ).rows;
  if (dues.length !== ids.length) throw notFound('Some fee lines were not found');
  if (dues.some((d) => d.student_id !== input.studentId)) {
    throw badRequest('wrong_student', 'Fee lines belong to a different student');
  }
  const yearId = dues[0]!.academic_year_id;
  if (dues.some((d) => d.academic_year_id !== yearId)) {
    throw badRequest('mixed_years', 'One receipt can only cover one academic year');
  }

  const balances = new Map(
    (
      await tx.query<{ fee_due_id: string; balance: string; fee_head: string; instalment: string }>(
        `SELECT b.fee_due_id, b.balance, h.name AS fee_head, i.name AS instalment
           FROM fee_due_balances b
           JOIN fee_heads h ON h.id = b.fee_head_id
           JOIN fee_instalments i ON i.id = b.instalment_id
          WHERE b.fee_due_id = ANY($1::uuid[])`,
        [ids],
      )
    ).rows.map((r) => [r.fee_due_id, r]),
  );

  let total = 0;
  const lines = input.lines.map((l) => {
    const amount = toPaise(l.amount);
    const fine = toPaise(l.fine ?? '0');
    const due = balances.get(l.feeDueId)!;
    if (amount > toPaise(due.balance)) {
      throw badRequest('over_payment', `${due.fee_head} (${due.instalment}): only ₹${due.balance} is due`);
    }
    if (amount + fine === 0) throw badRequest('zero_line', 'A line has nothing to collect');
    total += amount + fine;
    return { ...l, amount, fine, description: `${due.fee_head} - ${due.instalment}` };
  });

  // Next receipt number for this school + year.
  const meta = (
    await tx.query<{ prefix: string; year: string; school_id: string }>(
      `SELECT s.receipt_prefix AS prefix, y.name AS year, s.id AS school_id
         FROM academic_years y JOIN schools s ON s.id = y.school_id WHERE y.id = $1`,
      [yearId],
    )
  ).rows[0]!;
  await tx.query(
    `INSERT INTO receipt_counters (school_id, academic_year_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [meta.school_id, yearId],
  );
  const no = (
    await tx.query<{ n: number }>(
      `UPDATE receipt_counters SET next_no = next_no + 1
        WHERE school_id = $1 AND academic_year_id = $2 RETURNING next_no - 1 AS n`,
      [meta.school_id, yearId],
    )
  ).rows[0]!.n;
  const receiptNo = `${meta.prefix}/${meta.year}/${String(no).padStart(5, '0')}`;

  const receipt = (
    await tx.query(
      `INSERT INTO receipts (school_id, academic_year_id, receipt_no, student_id, paid_on,
                             total_amount, mode, reference, collected_by)
       VALUES ($1, $2, $3, $4, coalesce($5::date, current_date), $6, $7, $8, $9)
       RETURNING id, receipt_no, paid_on, total_amount, mode, status`,
      [meta.school_id, yearId, receiptNo, input.studentId, input.paidOn ?? null,
       fromPaise(total), input.mode, input.reference ?? null, collectedBy],
    )
  ).rows[0];
  for (const l of lines) {
    await tx.query(
      `INSERT INTO receipt_lines (school_id, receipt_id, fee_due_id, description, amount, fine)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [meta.school_id, receipt.id, l.feeDueId, l.description, fromPaise(l.amount), fromPaise(l.fine)],
    );
  }
  return receipt;
}

export async function cancelReceipt(tx: Tx, receiptId: string, reason: string, cancelledBy: string) {
  const why = reason.trim();
  if (why.length < 5) {
    throw badRequest('reason_required', 'Please write the reason for cancelling (at least 5 letters)');
  }
  const current = (
    await tx.query<{ status: string }>('SELECT status FROM receipts WHERE id = $1 FOR UPDATE', [receiptId])
  ).rows[0];
  if (!current) throw notFound('Receipt not found');
  if (current.status === 'cancelled') throw badRequest('already_cancelled', 'This receipt is already cancelled');
  return (
    await tx.query(
      `UPDATE receipts SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3
        WHERE id = $1
        RETURNING id, receipt_no, status, cancelled_by, cancelled_at, cancel_reason`,
      [receiptId, cancelledBy, why],
    )
  ).rows[0];
}
