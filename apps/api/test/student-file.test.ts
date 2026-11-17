// DIGITAL STUDENT FILE: photo, automatic admission number, documents, checklist, history, ZIP
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, api, loginAs, newPhone, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let office: ReturnType<typeof api>;
let teacher: ReturnType<typeof api>;
let sec7: string;
let studentId: string;

// Tiny real files (the server checks what a file really is, not its name)
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64')}`;
const FAKE = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env);
  office = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['principal'], 'Mrs Bora')).phone)).accessToken, S.schoolId);
  teacher = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['teacher'], 'Rina')).phone)).accessToken, S.schoolId);
  const cls7 = (await env.owner.query("SELECT id FROM classes WHERE school_id = $1 AND name = '7'", [S.schoolId])).rows[0].id;
  sec7 = (await env.owner.query("INSERT INTO sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id", [S.schoolId, S.yearId, cls7])).rows[0].id;
});
afterAll(async () => { await env.close(); });

const code = async () => (await env.owner.query('SELECT code FROM schools WHERE id = $1', [S.schoolId])).rows[0].code as string;

describe('Admission number', () => {
  it('is given automatically when left blank, in order', async () => {
    const preview = (await office.get('/students/admission-number?year=2027')).json();
    expect(preview.next).toBe(`${await code()}/2027/0001`);
    const a = (await office.post('/students', {
      firstName: 'Arif', lastName: 'Hussain', admissionDate: '2027-04-03', sectionId: sec7, aadhaarLast4: '4821',
      family: { phone: newPhone(), fatherName: 'Imran' },
    })).json();
    const b = (await office.post('/students', {
      firstName: 'Sana', admissionDate: '2027-04-05', sectionId: sec7, family: { phone: newPhone() },
    })).json();
    expect(a.admissionNo).toBe(`${await code()}/2027/0001`);
    expect(b.admissionNo).toBe(`${await code()}/2027/0002`);
    studentId = a.id;
  });

  it('can still be typed in by hand, and skips numbers already used', async () => {
    const c = await code();
    expect((await office.post('/students', { admissionNo: `${c}/2027/0003`, firstName: 'Old', sectionId: sec7, family: { phone: newPhone() } })).statusCode).toBe(200);
    const d = (await office.post('/students', { firstName: 'New', admissionDate: '2027-05-01', sectionId: sec7, family: { phone: newPhone() } })).json();
    expect(d.admissionNo).toBe(`${c}/2027/0004`);
  });

  it('the principal can change the format', async () => {
    expect((await office.put('/school/admission-format', { format: 'ADM-{YY}-' })).statusCode).toBe(400);
    expect((await office.put('/school/admission-format', { format: '{CODE}-{YY}-{SEQ}' })).statusCode).toBe(200);
    expect((await office.get('/students/admission-number?year=2027')).json().next).toBe(`${await code()}-27-0005`);
    await office.put('/school/admission-format', { format: '{CODE}/{YEAR}/{SEQ}', year: 2028, nextNo: 188 });
    expect((await office.get('/students/admission-number?year=2028')).json().next).toBe(`${await code()}/2028/0188`);
  });

  it('Aadhaar keeps only the last 4 digits', async () => {
    expect((await office.put(`/students/${studentId}/aadhaar`, { last4: '1234 5678 9012' })).statusCode).toBe(400);
    expect((await office.get(`/students/${studentId}/file`)).json().student.aadhaarLast4).toBe('4821');
  });
});

describe('Photo', () => {
  it('uploaded once, opens from a signed link, refuses fakes', async () => {
    expect((await office.put(`/students/${studentId}/photo`, { dataUrl: FAKE })).statusCode).toBe(400);
    const r = await office.put(`/students/${studentId}/photo`, { dataUrl: PNG });
    expect(r.statusCode).toBe(200);
    const url = r.json().photoUrl as string;
    const img = await env.app.inject({ method: 'GET', url });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    // Tampered signature -> nothing
    expect((await env.app.inject({ method: 'GET', url: url.replace(/s=.*/, 's=wrongwrongwrongwrong12') })).statusCode).toBe(404);
    // The same link is what the student record now carries everywhere
    expect((await office.get(`/students/${studentId}`)).json().photoUrl).toBe(url);
  });
});

describe('Documents', () => {
  let birthType: string;
  let marksheetType: string;
  let firstDoc: string;

  it('shows the checklist for the class', async () => {
    const f = (await office.get(`/students/${studentId}/file`)).json();
    const names = f.checklist.map((c: { name: string }) => c.name);
    expect(names).toContain('Birth certificate');
    expect(names).toContain('Previous school TC'); // class 7 is class 2+
    expect(f.missing).toBe(f.checklist.length);
    birthType = f.types.find((t: { name: string }) => t.name === 'Birth certificate').id;
    marksheetType = f.types.find((t: { name: string }) => t.name === 'Previous school marksheet').id;
  });

  it('uploads with a clear label and ticks the checklist', async () => {
    expect((await office.post(`/students/${studentId}/documents`, { typeId: marksheetType, fileName: 'scan.pdf', dataUrl: PDF })).json().error.message)
      .toMatch(/which class/);
    const m = (await office.post(`/students/${studentId}/documents`, { typeId: marksheetType, forClass: '6', fileName: 'scan.pdf', dataUrl: PDF })).json();
    expect(m.label).toBe('Previous school marksheet (Class 6)');
    const b = await office.post(`/students/${studentId}/documents`, { typeId: birthType, fileName: 'birth.png', dataUrl: PNG });
    firstDoc = b.json().id;
    const f = (await office.get(`/students/${studentId}/file`)).json();
    expect(f.checklist.find((c: { name: string }) => c.name === 'Birth certificate').done).toBe(true);
  });

  it('opens on screen, or downloads', async () => {
    const view = await office.get(`/documents/${firstDoc}/content`);
    expect(view.headers['content-disposition']).toMatch(/^inline/);
    const dl = await office.get(`/documents/${firstDoc}/content?download=1`);
    expect(dl.headers['content-disposition']).toMatch(/^attachment; filename="Birth certificate.png"/);
  });

  it('replacing keeps the old one in history; nothing can be deleted', async () => {
    const r = await office.post(`/students/${studentId}/documents`, { typeId: birthType, fileName: 'better.pdf', dataUrl: PDF, replacesId: firstDoc });
    expect(r.statusCode).toBe(200);
    const f = (await office.get(`/students/${studentId}/file`)).json();
    const birth = f.documents.filter((d: { typeName: string }) => d.typeName === 'Birth certificate');
    expect(birth).toHaveLength(1);
    expect(birth[0].history).toHaveLength(1);
    expect(birth[0].history[0].id).toBe(firstDoc);
    await expect(env.owner.query('DELETE FROM student_documents WHERE id = $1', [firstDoc])).rejects.toThrow();
  });

  it('downloads the whole file as a ZIP, in folders', async () => {
    const z = await office.get(`/students/${studentId}/file.zip`);
    expect(z.headers['content-type']).toBe('application/zip');
    const zip = await JSZip.loadAsync(z.rawPayload);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir).sort();
    expect(names).toEqual([
      '1 Admission documents/Birth certificate.pdf',
      '1 Admission documents/Previous school marksheet (Class 6).pdf',
    ]);
  });

  it('teachers cannot see documents or the file', async () => {
    expect((await teacher.get(`/students/${studentId}/file`)).statusCode).toBe(403);
    expect((await teacher.get(`/documents/${firstDoc}/content`)).statusCode).toBe(403);
    expect((await teacher.get(`/students/${studentId}/file.zip`)).statusCode).toBe(403);
  });

  it('another school cannot reach them', async () => {
    const S2 = await newSchool(env, 'Other');
    const other = api(env, (await loginAs(env, (await addMember(env, S2.schoolId, ['principal'])).phone)).accessToken, S2.schoolId);
    expect((await other.get(`/documents/${firstDoc}/content`)).statusCode).toBe(404);
    expect((await other.get(`/students/${studentId}/file`)).statusCode).toBe(404);
  });
});
