// RECEIPTS: never deleted; cancel needs a reason; who/when/why always saved.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withContext } from '../src/db.js';
import { lateFine } from '../src/fees/service.js';
import { addFamily, addMember, addTuitionDue, api, loginAs, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let accountant: { accountId: string; token: string };
let teacherToken: string;
let studentId: string;
let dueId: string;

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env);
  const acc = await addMember(env, S.schoolId, ['accountant'], 'Accountant');
  accountant = { accountId: acc.accountId, token: (await loginAs(env, acc.phone)).accessToken };
  const t = await addMember(env, S.schoolId, ['teacher']);
  teacherToken = (await loginAs(env, t.phone)).accessToken;
  studentId = (await addFamily(env, S, ['Riya'])).students[0]!;
  dueId = await addTuitionDue(env, S, studentId);
});
afterAll(async () => { await env.close(); });

const collect = (amount: string, extra: object = {}) =>
  api(env, accountant.token, S.schoolId).post('/fees/receipts', {
    studentId, mode: 'cash', lines: [{ feeDueId: dueId, amount, ...extra }],
  });

describe('Fee receipts', () => {
  it('numbers receipts in order per school and year', async () => {
    const r1 = await collect('1000');
    const r2 = await collect('500.50');
    expect(r1.statusCode).toBe(200);
    expect(r1.json().receipt_no).toMatch(/^RC\/2027-28\/\d{2}\/0001$/);
    expect(r2.json().receipt_no).toMatch(/^RC\/2027-28\/\d{2}\/0002$/);
    expect(r2.json().total_amount).toBe('500.50');
  });

  it('shows the remaining balance', async () => {
    const d = await api(env, accountant.token, S.schoolId).get(`/students/${studentId}/dues`);
    expect(d.json().dues[0].balance).toBe('1499.50');
  });

  it('refuses to collect more than is owed', async () => {
    const r = await collect('2000');
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('over_payment');
  });

  it('teachers cannot collect fees', async () => {
    const r = await api(env, teacherToken, S.schoolId).post('/fees/receipts', {
      studentId, mode: 'cash', lines: [{ feeDueId: dueId, amount: '10' }],
    });
    expect(r.statusCode).toBe(403);
  });

  it('cancelling needs a reason', async () => {
    const r = await collect('100');
    const c = await api(env, accountant.token, S.schoolId).post(`/fees/receipts/${r.json().id}/cancel`, { reason: '  ' });
    expect(c.statusCode).toBe(400);
    expect(c.json().error.code).toBe('reason_required');
  });

  it('cancelling saves who, when and why - and the receipt still exists', async () => {
    const r = await collect('200');
    const id = r.json().id;
    const c = await api(env, accountant.token, S.schoolId).post(`/fees/receipts/${id}/cancel`, {
      reason: 'Wrong student selected at counter',
    });
    expect(c.statusCode).toBe(200);
    expect(c.json()).toMatchObject({
      status: 'cancelled',
      cancelled_by: accountant.accountId,
      cancel_reason: 'Wrong student selected at counter',
    });
    expect(c.json().cancelled_at).toBeTruthy();

    // Cancelled money goes back to "due"
    const d = await api(env, accountant.token, S.schoolId).get(`/students/${studentId}/dues`);
    expect(d.json().dues[0].balance).toBe('1399.50'); // 3000 - 1000 - 500.50 - 100 (the 200 was cancelled)

    // Cannot cancel twice / un-cancel
    const again = await api(env, accountant.token, S.schoolId).post(`/fees/receipts/${id}/cancel`, { reason: 'again again' });
    expect(again.statusCode).toBe(400);

    // The audit log has the full before/after
    const audit = await env.owner.query(
      "SELECT action, account_id FROM audit_log WHERE table_name = 'receipts' AND row_id = $1 ORDER BY id", [id]);
    expect(audit.rows.map((a) => a.action)).toEqual(['INSERT', 'UPDATE']);
    expect(audit.rows[1].account_id).toBe(accountant.accountId);
  });

  it('the app cannot delete a receipt, even by going straight to the database', async () => {
    await expect(
      withContext(env.db, { schoolId: S.schoolId }, (tx) => tx.query('DELETE FROM receipts')),
    ).rejects.toThrow(/permission denied/);
  });

  it('even the database owner cannot delete a receipt', async () => {
    await expect(env.owner.query('DELETE FROM receipts')).rejects.toThrow(/not allowed/);
    await expect(env.owner.query('TRUNCATE receipts CASCADE')).rejects.toThrow(/not allowed/);
  });

  it('receipts cannot be edited (amount, date, student...) - only cancelled', async () => {
    await expect(
      withContext(env.db, { schoolId: S.schoolId }, (tx) =>
        tx.query("UPDATE receipts SET total_amount = 1 WHERE status = 'active'")),
    ).rejects.toThrow(/only be cancelled/);
    await expect(
      withContext(env.db, { schoolId: S.schoolId }, (tx) =>
        tx.query("UPDATE receipts SET status = 'cancelled' WHERE status = 'active'")),
    ).rejects.toThrow(/check constraint/);
    await expect(
      withContext(env.db, { schoolId: S.schoolId }, (tx) => tx.query('UPDATE receipt_lines SET amount = 0')),
    ).rejects.toThrow(/permission denied/);
  });

  it('the audit log itself cannot be changed', async () => {
    await expect(env.owner.query('DELETE FROM audit_log')).rejects.toThrow(/not allowed/);
    await expect(
      withContext(env.db, { schoolId: S.schoolId }, (tx) => tx.query("UPDATE audit_log SET action = 'x'")),
    ).rejects.toThrow(/permission denied/);
  });

  it('suggests late fines: Rs 10/day after due date, capped at Rs 200', () => {
    const inst = { due_on: '2027-04-10', grace_days: 0, fine_type: 'per_day', fine_amount: '10.00', fine_cap: '200.00' };
    expect(lateFine(inst, '2027-04-10')).toBe('0.00');
    expect(lateFine(inst, '2027-04-13')).toBe('30.00');
    expect(lateFine(inst, '2027-06-30')).toBe('200.00');
    expect(lateFine({ ...inst, fine_type: 'flat', fine_amount: '50' }, '2027-05-01')).toBe('50.00');
  });
});
