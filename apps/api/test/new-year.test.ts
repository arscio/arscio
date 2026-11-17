// MOVING TO A NEW SCHOOL YEAR: prepare, decide, start (report cards filed), undo
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, api, loginAs, newPhone, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let office: ReturnType<typeof api>;
let teacher: ReturnType<typeof api>;
let cls: Record<string, string>;
let lastClass: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env);
  const p = await addMember(env, S.schoolId, ['principal'], 'Mrs Bora');
  office = api(env, (await loginAs(env, p.phone)).accessToken, S.schoolId);
  teacher = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['teacher'], 'Rina')).phone)).accessToken, S.schoolId);
  const rows = (await env.owner.query('SELECT id, name FROM classes WHERE school_id = $1 ORDER BY sort_order', [S.schoolId])).rows;
  cls = Object.fromEntries(rows.map((r) => [r.name, r.id]));
  lastClass = rows.at(-1).name;
  await env.owner.query("UPDATE academic_years SET name = '2026-27', starts_on = '2026-04-01', ends_on = '2027-03-31' WHERE id = $1", [S.yearId]);
  const sec = async (c: string, n: string) => (await env.owner.query(
    'INSERT INTO sections (school_id, academic_year_id, class_id, name, class_teacher_membership) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [S.schoolId, S.yearId, cls[c], n, p.membershipId])).rows[0].id as string;
  const s6 = await sec('6', 'A');
  const sLast = await sec(lastClass, 'A');
  const add = async (key: string, first: string, sectionId: string) => {
    ids[key] = (await office.post('/students', { firstName: first, sectionId, family: { phone: newPhone() } })).json().id;
  };
  await add('zara', 'Zara', s6); await add('arif', 'Arif', s6); await add('kabir', 'Kabir', s6); await add('mina', 'Mina', s6);
  await add('senior', 'Senior', sLast);
  // One published term with a mark, so report cards get filed
  const term = (await env.owner.query("INSERT INTO terms (school_id, academic_year_id, name, published_at) VALUES ($1, $2, 'Term 1', now()) RETURNING id", [S.schoolId, S.yearId])).rows[0].id;
  void term;
  // Fee structure for class 7, to check next year's fees get created
  const head = (await env.owner.query("INSERT INTO fee_heads (school_id, name) VALUES ($1, 'Tuition') RETURNING id", [S.schoolId])).rows[0].id;
  const inst = (await env.owner.query("INSERT INTO fee_instalments (school_id, academic_year_id, name, due_on) VALUES ($1, $2, 'April', '2026-04-10') RETURNING id", [S.schoolId, S.yearId])).rows[0].id;
  await env.owner.query('INSERT INTO fee_structure (school_id, class_id, fee_head_id, instalment_id, amount) VALUES ($1, $2, $3, $4, 1500)', [S.schoolId, cls['7'], head, inst]);
});
afterAll(async () => { await env.close(); });

describe('New school year', () => {
  let state: any;

  it('only the principal can do it', async () => {
    expect((await teacher.get('/new-year')).statusCode).toBe(403);
  });

  it('suggests the next year and prepares it with the same sections, teachers and fees', async () => {
    state = (await office.get('/new-year')).json();
    expect(state.suggest).toEqual({ name: '2027-28', startsOn: '2027-04-01', endsOn: '2028-03-31' });
    const r = await office.post('/new-year/prepare', { ...state.suggest, copyTeachers: true, copyFees: true });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ sections: 2, feeLines: 1 });
    expect((await office.post('/new-year/prepare', state.suggest)).statusCode).toBe(400);
    // Add a section to class 7 next year
    expect((await office.post('/new-year/sections', { classId: cls['7'], name: 'a' })).statusCode).toBe(200);
    state = (await office.get('/new-year')).json();
    expect(state.next.sections.map((s: any) => `${s.className}${s.name}`).sort()).toEqual(['6A', `${lastClass}A`, '7'].sort());
    expect(state.next.sections.find((s: any) => s.className === '6').classTeacher).toBe('Mrs Bora');
  });

  it('refuses until every student has a decision, and checks the class', async () => {
    const s7 = state.next.sections.find((s: any) => s.className === '7').id;
    const s6next = state.next.sections.find((s: any) => s.className === '6').id;
    expect((await office.post('/new-year/start', { decisions: [{ studentId: ids.zara, action: 'promote', sectionId: s7 }] })).json().error.message)
      .toMatch(/4 more students/);
    const wrong = await office.post('/new-year/start', { decisions: [
      { studentId: ids.zara, action: 'promote', sectionId: s6next }, { studentId: ids.arif, action: 'promote', sectionId: s7 },
      { studentId: ids.kabir, action: 'repeat', sectionId: s6next }, { studentId: ids.mina, action: 'leave' }, { studentId: ids.senior, action: 'passed_out' },
    ] });
    expect(wrong.json().error.message).toMatch(/Zara moves up from Class 6, but was put in Class 6/);
  });

  it('starts the new year: places students, files report cards, marks leavers, creates fees', async () => {
    const s7 = state.next.sections.find((s: any) => s.className === '7').id;
    const s6next = state.next.sections.find((s: any) => s.className === '6').id;
    const r = await office.post('/new-year/start', { decisions: [
      { studentId: ids.zara, action: 'promote', sectionId: s7 }, { studentId: ids.arif, action: 'promote', sectionId: s7 },
      { studentId: ids.kabir, action: 'repeat', sectionId: s6next }, { studentId: ids.mina, action: 'leave' }, { studentId: ids.senior, action: 'passed_out' },
    ] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ promoted: 2, repeated: 1, left: 1, passedOut: 1, reportCards: 5, feeLines: 2, from: '2026-27', to: '2027-28' });
    // Roll numbers by name in the new section: Arif 1, Zara 2
    const rolls = (await env.owner.query(
      `SELECT st.first_name, e.roll_no FROM enrollments e JOIN students st ON st.id = e.student_id JOIN academic_years y ON y.id = e.academic_year_id
        WHERE y.name = '2027-28' AND y.school_id = $1 ORDER BY e.roll_no, st.first_name`, [S.schoolId])).rows;
    expect(rolls).toEqual([{ first_name: 'Arif', roll_no: 1 }, { first_name: 'Kabir', roll_no: 1 }, { first_name: 'Zara', roll_no: 2 }]);
    const st = (await env.owner.query('SELECT first_name, status FROM students WHERE id = ANY($1) ORDER BY first_name', [[ids.mina, ids.senior]])).rows;
    expect(st).toEqual([{ first_name: 'Mina', status: 'left' }, { first_name: 'Senior', status: 'passed_out' }]);
    // The report card is in Zara's file, labelled with class and year
    const file = (await office.get(`/students/${ids.zara}/file`)).json();
    const rc = file.documents.find((d: any) => d.category === 'report_card');
    expect(rc).toMatchObject({ label: 'Class 6 report card', yearName: '2026-27', source: 'system' });
    expect(file.student.className).toBe('7');
  });

  it('can be undone the same day, and done again', async () => {
    expect((await office.post('/new-year/undo')).statusCode).toBe(200);
    const cur = (await env.owner.query('SELECT name FROM academic_years WHERE school_id = $1 AND is_current', [S.schoolId])).rows[0].name;
    expect(cur).toBe('2026-27');
    expect((await env.owner.query('SELECT status FROM students WHERE id = $1', [ids.mina])).rows[0].status).toBe('active');
    const again = (await office.get('/new-year')).json();
    expect(again.next.name).toBe('2027-28');
    const s7 = again.next.sections.find((s: any) => s.className === '7').id;
    const s6next = again.next.sections.find((s: any) => s.className === '6').id;
    const r = await office.post('/new-year/start', { decisions: [
      { studentId: ids.zara, action: 'promote', sectionId: s7 }, { studentId: ids.arif, action: 'promote', sectionId: s7 },
      { studentId: ids.kabir, action: 'promote', sectionId: s7 }, { studentId: ids.mina, action: 'promote', sectionId: s7 }, { studentId: ids.senior, action: 'passed_out' },
    ] });
    // Report cards were already filed the first time: not filed twice
    expect(r.json()).toMatchObject({ promoted: 4, reportCards: 0 });
  });
});
