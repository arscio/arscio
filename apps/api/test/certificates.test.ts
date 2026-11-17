// CERTIFICATES: TC, bonafide, character; signature choices; filing into the student file; the register
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, api, loginAs, newPhone, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let office: ReturnType<typeof api>;
let teacher: ReturnType<typeof api>;
let arif: string;
let sana: string;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env);
  office = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['principal'], 'Mrs Bora')).phone)).accessToken, S.schoolId);
  teacher = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['teacher'], 'Rina')).phone)).accessToken, S.schoolId);
  const cls = (await env.owner.query("SELECT id FROM classes WHERE school_id = $1 AND name = '7'", [S.schoolId])).rows[0].id;
  const sec = (await env.owner.query("INSERT INTO sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id", [S.schoolId, S.yearId, cls])).rows[0].id;
  arif = (await office.post('/students', {
    firstName: 'Arif', lastName: 'Hussain', gender: 'male', dateOfBirth: '2013-03-14', admissionDate: '2021-04-03', sectionId: sec,
    family: { phone: newPhone(), fatherName: 'Imran Hussain', motherName: 'Rehana Begum' },
  })).json().id;
  sana = (await office.post('/students', {
    firstName: 'Sana', gender: 'female', admissionDate: '2022-04-04', sectionId: sec, family: { phone: newPhone(), fatherName: 'Abdul' },
  })).json().id;
});
afterAll(async () => { await env.close(); });

const tc = {
  applicationDate: '2026-11-02', leavingDate: '2026-11-06', reason: "Parent's transfer to Guwahati",
  promotion: 'na', conduct: 'Very good', markLeft: true,
};

describe('Certificates', () => {
  it('bonafide: serial number, PDF filed in the student file', async () => {
    const r = await office.post(`/students/${sana}/certificates`, { kind: 'bonafide', details: { purpose: 'opening a bank account' } });
    expect(r.statusCode).toBe(200);
    const c = r.json();
    expect(c.serialNo).toMatch(/\/BC\/.+\/0001$/);
    const pdf = await office.get(`/documents/${c.documentId}/content`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const file = (await office.get(`/students/${sana}/file`)).json();
    const certs = file.documents.filter((d: { category: string }) => d.category === 'certificate');
    expect(certs[0].label).toBe(`Bonafide certificate ${c.serialNo}`);
    expect(certs[0].source).toBe('system');
  });

  it('printed signature needs an uploaded signature first', async () => {
    expect((await office.put('/certificates/settings/character', { signMode: 'printed', signerRole: 'owner' })).statusCode).toBe(200);
    const r = await office.post(`/students/${arif}/certificates`, { kind: 'character', details: { conduct: 'Good' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toMatch(/no director signature/i);
    expect((await office.put('/signatures/owner', { signerName: 'Zahid Ahmed', dataUrl: PNG })).statusCode).toBe(200);
    const ok = await office.post(`/students/${arif}/certificates`, { kind: 'character', details: { conduct: 'Good' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().signMode).toBe('printed');
    // A signature in use can't be removed
    expect((await office.del('/signatures/owner')).statusCode).toBe(400);
  });

  it('TC: knows dues and attendance, marks the student as left, only once', async () => {
    const pre = (await office.get(`/students/${arif}/certificates`)).json();
    expect(pre.student.firstClass).toBe('7');
    expect(pre.known.attendance).toEqual({ days: 0, present: 0 });
    const r = await office.post(`/students/${arif}/certificates`, { kind: 'tc', details: tc });
    expect(r.statusCode).toBe(200);
    expect(r.json().serialNo).toMatch(/\/TC\/.+\/0001$/);
    const st = (await env.owner.query('SELECT status, left_on::text FROM students WHERE id = $1', [arif])).rows[0];
    expect(st).toEqual({ status: 'left', left_on: '2026-11-06' });
    // A second TC must be a duplicate copy
    expect((await office.post(`/students/${arif}/certificates`, { kind: 'tc', details: tc })).json().error.message).toMatch(/duplicate/);
    const dup = await office.post(`/students/${arif}/certificates`, { kind: 'tc', details: tc, reissue: true });
    expect(dup.statusCode).toBe(200);
    expect(dup.json().serialNo).toMatch(/\/0002$/);
    // No bonafide for someone who has left
    expect((await office.post(`/students/${arif}/certificates`, { kind: 'bonafide', details: { purpose: 'x x' } })).statusCode).toBe(400);
  });

  it('admission and withdrawal register shows the leaver with TC and reason', async () => {
    const rows = (await office.get('/registers/admission-withdrawal')).json().rows;
    const a = rows.find((r: { name: string }) => r.name === 'Arif Hussain');
    expect(a).toMatchObject({ classAdmitted: '7', leftOn: '2026-11-06', reason: "Parent's transfer to Guwahati", father: 'Imran Hussain' });
    expect(a.tcNo).toMatch(/\/TC\/.+\/0001$/);
    expect((await office.get('/registers/admission-withdrawal?show=studying')).json().rows.map((r: { name: string }) => r.name)).toEqual(['Sana']);
    expect((await office.get('/registers/admission-withdrawal?year=2021')).json().rows).toHaveLength(1);
  });

  it('teachers cannot issue or see certificates', async () => {
    expect((await teacher.post(`/students/${sana}/certificates`, { kind: 'bonafide', details: { purpose: 'test' } })).statusCode).toBe(403);
    expect((await teacher.get('/certificates')).statusCode).toBe(403);
    expect((await teacher.get('/registers/admission-withdrawal')).statusCode).toBe(403);
  });
});
