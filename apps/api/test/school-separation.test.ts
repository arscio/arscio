// SEPARATE DATA PER SCHOOL: proven at the database level, not just in our code.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withContext } from '../src/db.js';
import { addFamily, addMember, api, loginAs, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let A: Awaited<ReturnType<typeof newSchool>>;
let B: Awaited<ReturnType<typeof newSchool>>;
let studentA: string;
let studentB: string;

beforeAll(async () => {
  env = await setupEnv();
  A = await newSchool(env, 'School A');
  B = await newSchool(env, 'School B');
  studentA = (await addFamily(env, A, ['Aman'])).students[0]!;
  studentB = (await addFamily(env, B, ['Bina'])).students[0]!;
});
afterAll(async () => { await env.close(); });

describe('School separation', () => {
  it('working for School A, the database only shows School A students', async () => {
    const rows = await withContext(env.db, { schoolId: A.schoolId }, async (tx) =>
      (await tx.query('SELECT id, school_id FROM students')).rows);
    expect(rows.map((r) => r.id)).toContain(studentA);
    expect(rows.map((r) => r.id)).not.toContain(studentB);
    expect(rows.every((r) => r.school_id === A.schoolId)).toBe(true);
  });

  it('even asking for School B\'s student by its exact id returns nothing', async () => {
    const rows = await withContext(env.db, { schoolId: A.schoolId }, async (tx) =>
      (await tx.query('SELECT * FROM students WHERE id = $1', [studentB])).rows);
    expect(rows).toHaveLength(0);
  });

  it('with no school chosen, nothing is visible at all', async () => {
    const n = await withContext(env.db, {}, async (tx) =>
      (await tx.query('SELECT count(*)::int AS n FROM students')).rows[0].n);
    expect(n).toBe(0);
  });

  it('cannot write a row into another school', async () => {
    await expect(
      withContext(env.db, { schoolId: A.schoolId }, (tx) =>
        tx.query("INSERT INTO subjects (school_id, name) VALUES ($1, 'Sneaky')", [B.schoolId])),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot change or move School B data while working for School A', async () => {
    const updated = await withContext(env.db, { schoolId: A.schoolId }, async (tx) =>
      (await tx.query("UPDATE students SET first_name = 'Hacked' WHERE id = $1", [studentB])).rowCount);
    expect(updated).toBe(0);
    await expect(
      withContext(env.db, { schoolId: A.schoolId }, (tx) =>
        tx.query('UPDATE students SET school_id = $1 WHERE id = $2', [B.schoolId, studentA])),
    ).rejects.toThrow(/row-level security/);
  });

  it('a School A principal asking for School B is refused', async () => {
    const p = await addMember(env, A.schoolId, ['principal']);
    const s = await loginAs(env, p.phone);
    expect((await api(env, s.accessToken, A.schoolId).get('/school')).statusCode).toBe(200);
    const r = await api(env, s.accessToken, B.schoolId).get('/school');
    expect(r.statusCode).toBe(403);
    const d = await api(env, s.accessToken, B.schoolId).get(`/students/${studentB}/dues`);
    expect(d.statusCode).toBe(403);
  });

  it('the app database user cannot create schools or switch off the protection', async () => {
    await expect(env.db.query("INSERT INTO schools (code, name) VALUES ('X', 'X')")).rejects.toThrow(/permission denied/);
    await expect(env.db.query('ALTER TABLE students DISABLE ROW LEVEL SECURITY')).rejects.toThrow(/must be owner/);
  });
});
