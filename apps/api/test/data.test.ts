// EXCEL IMPORT AND EXPORT: permission, column matching, checking, importing, undo, exports, templates
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, api, loginAs, newPhone, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let principal: ReturnType<typeof api>;
let office: ReturnType<typeof api>;
let officeMember: string;
let sec7a: string;
let sec7b: string;

async function xlsx(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Admissions');
  ws.addRow(['Green Valley admissions 2026']); // a title row above the headings, as schools often have
  for (const r of rows) ws.addRow(r);
  return `data:application/octet-stream;base64,${Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')}`;
}

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env);
  principal = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['principal'], 'Mrs Bora')).phone)).accessToken, S.schoolId);
  const o = await addMember(env, S.schoolId, ['office_admin'], 'Mr Das');
  officeMember = o.membershipId;
  office = api(env, (await loginAs(env, o.phone)).accessToken, S.schoolId);
  const cls7 = (await env.owner.query("SELECT id FROM classes WHERE school_id = $1 AND name = '7'", [S.schoolId])).rows[0].id;
  sec7a = (await env.owner.query("INSERT INTO sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id", [S.schoolId, S.yearId, cls7])).rows[0].id;
  sec7b = (await env.owner.query("INSERT INTO sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'B') RETURNING id", [S.schoolId, S.yearId, cls7])).rows[0].id;
  await principal.post('/students', { admissionNo: 'OLD/1', firstName: 'Already', sectionId: sec7a, family: { phone: newPhone() } });
});
afterAll(async () => { await env.close(); });

describe('Permission', () => {
  it('only people given "Excel import and export" can use it', async () => {
    expect((await office.get('/data/options')).statusCode).toBe(403);
    expect((await office.put(`/staff/${officeMember}/permissions/data.import_export`, { on: true })).statusCode).toBe(403);
    expect((await principal.put(`/staff/${officeMember}/permissions/data.import_export`, { on: true })).statusCode).toBe(200);
    expect((await office.get('/data/options')).statusCode).toBe(200);
    const staff = (await principal.get('/staff')).json().staff;
    expect(staff.find((s: { membershipId: string }) => s.membershipId === officeMember).extra).toEqual(['data.import_export']);
  });
});

describe('Importing students from a messy Excel file', () => {
  const phone = newPhone().replace('+91', '');
  let file: string;
  let batch: string;
  const body = (mapping: Record<string, number | null>) => ({ kind: 'students', fileName: 'admissions.xlsx', dataUrl: file, mapping });

  it('finds the headings under a title row and guesses the columns', async () => {
    file = await xlsx([
      ['S.No', 'Adm No', 'Name of Student', 'Class', "Father's Name", 'Mobile No', 'DOB', 'Gender', 'Aadhar No'],
      [1, '', 'Riya Sharma', 'VII-A', 'Rakesh Sharma', Number(phone), new Date(Date.UTC(2014, 2, 14)), 'F', '1234 5678 9012'],
      [2, '', 'Rohan Sharma', '7 B', 'Rakesh Sharma', Number(phone), '05/08/2015', 'M', ''],
      [3, 'OLD/1', 'Already Here', '7A', 'X', '9876512345', '', '', ''],
      [4, '', 'Bad Class', 'Class 15', 'Y', '12345', '31/02/2014', 'boy', ''],
    ]);
    const r = (await office.post('/data/import/read', { kind: 'students', fileName: 'admissions.xlsx', dataUrl: file })).json();
    const s = r.sheets[0];
    expect(s.headers[2]).toBe('Name of Student');
    expect(s.rowCount).toBe(4);
    expect(s.suggested).toMatchObject({ admissionNo: 1, fullName: 2, className: 3, fatherName: 4, phone: 5, dateOfBirth: 6, gender: 7, aadhaar: 8 });
  });

  it('checks every row without saving, explaining each problem', async () => {
    const mapping = { admissionNo: 1, fullName: 2, className: 3, fatherName: 4, phone: 5, dateOfBirth: 6, gender: 7, aadhaar: 8 };
    const r = (await office.post('/data/import/check', body(mapping))).json();
    expect(r.counts).toEqual({ ok: 2, error: 1, skip: 1 });
    const bad = r.rows.find((x: { status: string }) => x.status === 'error');
    expect(bad.row).toBe(6);
    expect(bad.messages).toEqual(expect.arrayContaining([
      expect.stringMatching(/Class “Class 15” is not one of this school’s classes/),
      expect.stringMatching(/12345 is not a valid Indian mobile/),
      expect.stringMatching(/Date of birth “31\/02\/2014” is not a valid date/),
    ]));
    expect(r.rows[0].show).toMatchObject({ name: 'Riya Sharma', class: '7 A', admissionNo: '(new number)' });
    expect((await env.owner.query("SELECT count(*)::int AS n FROM students WHERE first_name = 'Riya'")).rows[0].n).toBe(0);
  });

  it('imports the good rows: siblings share a family, numbers are given, only Aadhaar last 4 kept', async () => {
    const mapping = { admissionNo: 1, fullName: 2, className: 3, fatherName: 4, phone: 5, dateOfBirth: 6, gender: 7, aadhaar: 8 };
    const r = await office.post('/data/import/run', body(mapping));
    expect(r.statusCode).toBe(200);
    batch = r.json().id;
    const kids = (await env.owner.query(
      `SELECT st.first_name, st.last_name, st.date_of_birth::text AS dob, st.gender, st.aadhaar_last4, st.family_id, s.name AS section, st.admission_no
         FROM students st JOIN enrollments e ON e.student_id = st.id JOIN sections s ON s.id = e.section_id
        WHERE st.school_id = $1 AND st.last_name = 'Sharma' ORDER BY st.first_name`, [S.schoolId])).rows;
    expect(kids).toHaveLength(2);
    expect(kids[0]).toMatchObject({ first_name: 'Riya', dob: '2014-03-14', gender: 'female', aadhaar_last4: '9012', section: 'A' });
    expect(kids[1]).toMatchObject({ first_name: 'Rohan', dob: '2015-08-05', gender: 'male', section: 'B' });
    expect(kids[0].family_id).toBe(kids[1].family_id);
    expect(kids[0].admission_no).toMatch(/\/\d{4}\/\d{4}$/);
    const list = (await office.get('/data/imports')).json().imports;
    expect(list[0]).toMatchObject({ kind: 'students', ok: 2, failed: 1, fileName: 'admissions.xlsx' });
  });

  it('can be undone while nothing has happened to those students', async () => {
    expect((await office.post(`/data/imports/${batch}/undo`)).statusCode).toBe(200);
    expect((await env.owner.query("SELECT count(*)::int AS n FROM students WHERE school_id = $1 AND last_name = 'Sharma'", [S.schoolId])).rows[0].n).toBe(0);
    expect((await env.owner.query('SELECT count(*)::int AS n FROM families WHERE school_id = $1 AND phone = $2', [S.schoolId, `+91${phone}`])).rows[0].n).toBe(0);
    expect((await office.post(`/data/imports/${batch}/undo`)).statusCode).toBe(400);
  });
});

describe('Staff and marks', () => {
  it('staff import needs the right to give roles', async () => {
    const file = await xlsx([['Name', 'Mobile', 'Role'], ['Tara Devi', '9123400001', 'Teacher'], ['Mr Owner', '9123400002', 'Owner']]);
    expect((await office.post('/data/import/read', { kind: 'staff', fileName: 's.xlsx', dataUrl: file })).statusCode).toBe(403);
    const r = (await principal.post('/data/import/check', { kind: 'staff', fileName: 's.xlsx', dataUrl: file, mapping: { name: 0, phone: 1, roles: 2 } })).json();
    expect(r.counts).toEqual({ ok: 1, error: 1, skip: 0 });
    expect(r.rows[1].messages[0]).toMatch(/cannot give the Owner role/);
  });

  it('imports marks by admission number, with AB for absent, and undoes them', async () => {
    await principal.put(`/staff/${officeMember}/permissions/data.import_export`, { on: true });
    const maths = (await env.owner.query("INSERT INTO subjects (school_id, name) VALUES ($1, 'Mathematics') RETURNING id", [S.schoolId])).rows[0].id;
    const eng = (await env.owner.query("INSERT INTO subjects (school_id, name) VALUES ($1, 'English') RETURNING id", [S.schoolId])).rows[0].id;
    const cls7 = (await env.owner.query("SELECT id FROM classes WHERE school_id = $1 AND name = '7'", [S.schoolId])).rows[0].id;
    await env.owner.query('INSERT INTO class_subjects (school_id, class_id, subject_id, sort_order) VALUES ($1, $2, $3, 1), ($1, $2, $4, 2)', [S.schoolId, cls7, maths, eng]);
    const term = (await env.owner.query("INSERT INTO terms (school_id, academic_year_id, name) VALUES ($1, $2, 'Term 1') RETURNING id", [S.schoolId, S.yearId])).rows[0].id;
    const exam = (await env.owner.query("INSERT INTO exams (school_id, term_id, name, default_max_marks) VALUES ($1, $2, 'Unit Test 1', 25) RETURNING id", [S.schoolId, term])).rows[0].id;
    // The template lists the students of the class
    const tpl = await office.get(`/data/templates/marks?examId=${exam}&sectionId=${sec7a}`);
    expect(tpl.headers['content-type']).toMatch(/spreadsheetml/);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(tpl.rawPayload as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.getRow(1).values).toEqual([undefined, 'Roll number', 'Admission number', 'Name', 'Mathematics (out of 25)', 'English (out of 25)']);
    expect(wb.worksheets[0]!.getRow(2).getCell(2).value).toBe('OLD/1');
    // Fill it in and import
    const file = await xlsx([['Admission number', 'Name', 'Mathematics (out of 25)', 'English (out of 25)'], ['OLD/1', 'Already', 21.5, 'AB'], ['NOPE', 'Ghost', 30, 10]]);
    const read = (await office.post('/data/import/read', { kind: 'marks', fileName: 'm.xlsx', dataUrl: file, examId: exam, sectionId: sec7a })).json();
    const mapping = read.sheets[0].suggested;
    expect(mapping).toMatchObject({ admissionNo: 0, name: 1, [`sub:${maths}`]: 2, [`sub:${eng}`]: 3 });
    const chk = (await office.post('/data/import/check', { kind: 'marks', fileName: 'm.xlsx', dataUrl: file, mapping, examId: exam, sectionId: sec7a })).json();
    expect(chk.counts).toEqual({ ok: 1, error: 1, skip: 0 });
    expect(chk.rows[1].messages.join(' ')).toMatch(/No student NOPE.*Mathematics: 30 is more than 25/);
    const run = (await office.post('/data/import/run', { kind: 'marks', fileName: 'm.xlsx', dataUrl: file, mapping, examId: exam, sectionId: sec7a })).json();
    const saved = (await env.owner.query('SELECT marks_obtained::float AS m, is_absent FROM marks WHERE exam_id = $1 ORDER BY is_absent', [exam])).rows;
    expect(saved).toEqual([{ m: 21.5, is_absent: false }, { m: null, is_absent: true }]);
    expect((await office.post(`/data/imports/${run.id}/undo`)).statusCode).toBe(200);
    expect((await env.owner.query('SELECT count(*)::int AS n FROM marks WHERE exam_id = $1', [exam])).rows[0].n).toBe(0);
  });
});

describe('Export', () => {
  it('downloads students as Excel, which can be imported again', async () => {
    const r = await office.get(`/data/export/students?sectionId=${sec7a}`);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename=".*Students and families.*\.xlsx"/);
    const dataUrl = `data:x;base64,${r.rawPayload.toString('base64')}`;
    const read = (await office.post('/data/import/read', { kind: 'students', fileName: 'x.xlsx', dataUrl })).json();
    expect(read.sheets[0].rowCount).toBe(1);
    expect(read.sheets[0].suggested).toMatchObject({ admissionNo: 0, firstName: 1, lastName: 2, className: 3, section: 4, phone: 13 });
    // Re-importing the same file: already there, so skipped
    const chk = (await office.post('/data/import/check', { kind: 'students', fileName: 'x.xlsx', dataUrl, mapping: read.sheets[0].suggested })).json();
    expect(chk.counts).toEqual({ ok: 0, error: 0, skip: 1 });
  });

  it('attendance needs a class and month; fees need the fee reports right', async () => {
    expect((await office.get('/data/export/attendance')).statusCode).toBe(400);
    expect((await office.get(`/data/export/attendance?sectionId=${sec7a}&month=2026-11`)).statusCode).toBe(200);
    expect((await office.get('/data/export/fees')).statusCode).toBe(403);
    expect((await principal.get('/data/export/fees?onlyDue=1')).statusCode).toBe(200);
    expect((await principal.get('/data/export/leave')).statusCode).toBe(200);
  });
});
