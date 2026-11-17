// RESULTS DAY: formula per class, pass rule, held marksheets, parent download, QR check.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addFamily, addMember, api, loginAs, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let principal: ReturnType<typeof api>;
let office: ReturnType<typeof api>;
let parent: ReturnType<typeof api>;
let sectionId: string; let classId: string; let kids: string[];
let maths: string; let english: string;
let ut1: string; let fin: string;

const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

async function enter(examId: string, subjectId: string, rows: { studentId: string; marks?: number; absent?: boolean }[], maxMarks: number) {
  const r = await principal.put('/marks/sheet', { examId, sectionId, subjectId, maxMarks, submit: true, rows });
  expect(r.statusCode).toBe(200);
}

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env, 'Green Valley School');
  principal = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['principal'], 'Dr. Anjali Bora')).phone)).accessToken, S.schoolId);
  office = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['office_admin'])).phone)).accessToken, S.schoolId);
  const fam = await addFamily(env, S, ['Arif', 'Sana'], { withParentLogin: true });
  parent = api(env, (await loginAs(env, fam.phone)).accessToken, S.schoolId);
  sectionId = fam.sectionId; kids = fam.students;
  classId = (await env.owner.query('SELECT class_id FROM sections WHERE id = $1', [sectionId])).rows[0].class_id;
  maths = (await principal.post('/subjects', { name: 'Mathematics' })).json().id;
  english = (await principal.post('/subjects', { name: 'English' })).json().id;
  await principal.put(`/classes/${classId}/subjects`, { subjectIds: [maths, english] });
  const term = (await principal.post('/exams/terms', { name: 'Term 1' })).json().id;
  ut1 = (await principal.post('/exams', { termId: term, name: 'Unit Test 1', maxMarks: 20, weightagePct: 20 })).json().id;
  fin = (await principal.post('/exams', { termId: term, name: 'Final', maxMarks: 100, weightagePct: 80 })).json().id;
  // Arif does well; Sana is below 33% in English
  await enter(ut1, maths, [{ studentId: kids[0]!, marks: 18 }, { studentId: kids[1]!, marks: 10 }], 20);
  await enter(ut1, english, [{ studentId: kids[0]!, marks: 16 }, { studentId: kids[1]!, marks: 4 }], 20);
  await enter(fin, maths, [{ studentId: kids[0]!, marks: 80 }, { studentId: kids[1]!, marks: 55 }], 100);
  await enter(fin, english, [{ studentId: kids[0]!, marks: 70 }, { studentId: kids[1]!, absent: true }], 100);
});
afterAll(async () => { await env.close(); });

describe('Result formula', () => {
  it('only the principal sets it, and only with exams this class writes', async () => {
    const body = { weights: [{ examId: ut1, weight: 20 }, { examId: fin, weight: 80 }], passSubjectPct: 33, passOverallPct: 33, resultDate: '2099-03-31' };
    expect((await office.put(`/results/classes/${classId}`, body)).statusCode).toBe(403);
    expect((await principal.put(`/results/classes/${classId}`, body)).statusCode).toBe(200);
    const setup = (await principal.get('/results/setup')).json();
    const c = setup.classes.find((x: { id: string }) => x.id === classId);
    expect(c.weights).toHaveLength(2);
    expect(c.resultDate).toBe('2099-03-31');
  });

  it('works out each subject from the weights and checks the pass rule', async () => {
    const r = (await principal.get(`/results/classes/${classId}`)).json();
    const arif = r.students.find((x: { studentId: string }) => x.studentId === kids[0]);
    // Maths: 90% x 0.2 + 80% x 0.8 = 82; English: 80% x 0.2 + 70% x 0.8 = 72; overall 77
    expect(arif).toMatchObject({ pct: 77, passed: true, result: 'Pass' });
    const sana = r.students.find((x: { studentId: string }) => x.studentId === kids[1]);
    expect(sana.passed).toBe(false);
    expect(sana.result).toBe('Below the pass mark in English');
  });

  it('"Final only" is just a different set of weights', async () => {
    await principal.put(`/results/classes/${classId}`, { weights: [{ examId: fin, weight: 1 }], passSubjectPct: 33, passOverallPct: 33, resultDate: '2099-03-31' });
    const arif = (await principal.get(`/results/classes/${classId}`)).json().students.find((x: { studentId: string }) => x.studentId === kids[0]);
    expect(arif.pct).toBe(75);
    await principal.put(`/results/classes/${classId}`, { weights: [{ examId: ut1, weight: 20 }, { examId: fin, weight: 80 }], passSubjectPct: 33, passOverallPct: 33, resultDate: '2099-03-31' });
  });
});

describe('Marksheets', () => {
  it('before the result date parents get nothing', async () => {
    await principal.post(`/results/classes/${classId}/generate`);
    expect((await parent.get(`/parent/children/${kids[0]}/marksheet`)).json().status).toBe('not_yet');
  });

  it('on the result date parents download it; a student below the pass rule waits for the principal', async () => {
    await env.owner.query('UPDATE result_settings SET result_date = $2 WHERE class_id = $1', [classId, today()]);
    const a = (await parent.get(`/parent/children/${kids[0]}/marksheet`)).json();
    expect(a.status).toBe('ready');
    expect(a.summary).toMatchObject({ pct: 77, result: 'Pass' });
    const pdf = await env.app.inject({ method: 'GET', url: a.downloadUrl });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    // a changed link is refused
    expect((await env.app.inject({ method: 'GET', url: a.downloadUrl.replace(/s=./, 's=x') })).statusCode).toBe(403);

    expect((await parent.get(`/parent/children/${kids[1]}/marksheet`)).json().status).toBe('with_school');
  });

  it('the principal confirms the held marksheet with a note; then the parent gets it', async () => {
    const r = (await principal.get(`/results/classes/${classId}`)).json();
    const held = r.students.find((x: { studentId: string }) => x.studentId === kids[1]).marksheet;
    expect(held.held).toBe(true);
    expect((await office.post(`/results/marksheets/${held.id}/release`, { note: 'Promoted on review' })).statusCode).toBe(403);
    expect((await principal.post(`/results/marksheets/${held.id}/release`, { note: 'Promoted on review' })).statusCode).toBe(200);
    const s = (await parent.get(`/parent/children/${kids[1]}/marksheet`)).json();
    expect(s.status).toBe('ready');
    expect(s.summary.note).toBe('Promoted on review');
  });

  it('the office downloads the whole class, signed or blank to sign', async () => {
    for (const sign of ['printed', 'hand']) {
      const r = await office.get(`/results/classes/${classId}/marksheets.pdf?sign=${sign}`);
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('application/pdf');
    }
  });

  it('anyone can check a marksheet by its QR code', async () => {
    const code = (await env.owner.query('SELECT verify_code FROM marksheets WHERE student_id = $1', [kids[0]])).rows[0].verify_code;
    const v = (await env.app.inject({ method: 'GET', url: `/verify/${code.toLowerCase()}` })).json();
    expect(v).toMatchObject({ valid: true, school: 'Green Valley School', student: 'Arif', pct: 77, result: 'Pass' });
    expect((await env.app.inject({ method: 'GET', url: '/verify/AAAA-BBBB-CCCC' })).json()).toEqual({ valid: false });
  });

  it('remaking the marksheets keeps the same QR code', async () => {
    const before = (await env.owner.query('SELECT verify_code FROM marksheets WHERE student_id = $1', [kids[0]])).rows[0].verify_code;
    await principal.post(`/results/classes/${classId}/generate`);
    const after = (await env.owner.query('SELECT verify_code FROM marksheets WHERE student_id = $1', [kids[0]])).rows[0].verify_code;
    expect(after).toBe(before);
  });
});

describe('Results day job', () => {
  it('on the result date makes the marksheets and tells each family once', async () => {
    const { runResultsDay } = await import('../src/results/job.js');
    const pg = (await import('pg')).default;
    const { TEST_OWNER_URL } = await import('./global-setup.js');
    const owner = new pg.Pool({ connectionString: TEST_OWNER_URL });
    await env.owner.query('DELETE FROM marksheets WHERE class_id = $1', [classId]);
    await env.owner.query('UPDATE result_settings SET announced_at = NULL WHERE class_id = $1', [classId]);
    const before = (await env.owner.query("SELECT count(*)::int AS n FROM notifications WHERE title = 'Results are out'")).rows[0].n;
    await runResultsDay(owner, env.db, today());
    await runResultsDay(owner, env.db, today()); // second run does nothing
    const after = (await env.owner.query("SELECT count(*)::int AS n FROM notifications WHERE title = 'Results are out'")).rows[0].n;
    expect(after - before).toBe(1); // Arif only; Sana waits for the principal
    expect((await env.owner.query('SELECT count(*)::int AS n FROM marksheets WHERE class_id = $1', [classId])).rows[0].n).toBe(2);
    await owner.end();
  });
});
