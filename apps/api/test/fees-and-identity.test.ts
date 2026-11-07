// FEES (setup -> dues -> concessions -> collect -> day book -> defaulters) and SCHOOL IDENTITY
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayIST } from '../src/routes/attendance.js';
import { addFamily, addMember, api, loginAs, newSchool, setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let acc: ReturnType<typeof api>;      // accountant
let principal: ReturnType<typeof api>;
let teacher: ReturnType<typeof api>;
let class5: string;
let tuition: string, transport: string, admission: string;
let q1: string, q2: string;
let arif: string, sana: string, tara: string;
let parentToken: string;

const shift = (n: number) => { const d = new Date(`${todayIST()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env, 'Green Valley Public School');
  acc = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['accountant'], 'Anil Accounts')).phone)).accessToken, S.schoolId);
  principal = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['principal'])).phone)).accessToken, S.schoolId);
  teacher = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['teacher'])).phone)).accessToken, S.schoolId);
  const f1 = await addFamily(env, S, ['Arif', 'Sana'], { withParentLogin: true });
  const f2 = await addFamily(env, S, ['Tara']);
  [arif, sana] = f1.students as [string, string];
  tara = f2.students[0]!;
  parentToken = (await loginAs(env, f1.phone)).accessToken;
  class5 = (await env.owner.query('SELECT class_id FROM sections WHERE id = $1', [f1.sectionId])).rows[0].class_id;
});
afterAll(async () => { await env.close(); });

describe('Fee setup', () => {
  it('accountant sets fee types and instalments', async () => {
    tuition = (await acc.post('/fees/heads', { name: 'Tuition' })).json().id;
    transport = (await acc.post('/fees/heads', { name: 'Transport' })).json().id;
    admission = (await acc.post('/fees/heads', { name: 'Admission' })).json().id;
    expect((await acc.post('/fees/heads', { name: 'Tuition' })).statusCode).toBe(400);
    // Q1 already overdue (10 days ago), Q2 due in the future
    q1 = (await acc.post('/fees/instalments', { name: 'Q1 (Apr-Jun)', dueOn: shift(-10), fineType: 'per_day', fineAmount: '10', fineCap: '200' })).json().id;
    q2 = (await acc.post('/fees/instalments', { name: 'Q2 (Jul-Sep)', dueOn: shift(30) })).json().id;
    const s = (await acc.get('/fees/setup')).json();
    expect(s.heads.map((h: { name: string }) => h.name)).toEqual(['Admission', 'Transport', 'Tuition']);
    expect(s.instalments.map((i: { name: string }) => i.name)).toEqual(['Q1 (Apr-Jun)', 'Q2 (Jul-Sep)']);
  });

  it('sets Class 5 fees and generates what each child owes (safe to run twice)', async () => {
    const put = await acc.put(`/fees/structure/${class5}`, { items: [
      { feeHeadId: tuition, instalmentId: q1, amount: '3000' },
      { feeHeadId: tuition, instalmentId: q2, amount: '3000' },
      { feeHeadId: admission, instalmentId: q1, amount: '2000' },
      { feeHeadId: transport, instalmentId: q1, amount: '0' },
    ] });
    expect(put.json().saved).toBe(3);
    const g = (await acc.post('/fees/generate-dues', {})).json();
    expect(g).toMatchObject({ added: 9, studentsWithFees: 3 });
    expect((await acc.post('/fees/generate-dues', {})).json().added).toBe(0);
    const dues = (await acc.get(`/students/${arif}/dues`)).json().dues;
    expect(dues).toHaveLength(3);
  });

  it('teachers cannot change fees', async () => {
    expect((await teacher.post('/fees/heads', { name: 'Sneaky' })).statusCode).toBe(403);
    expect((await teacher.get('/fees/defaulters')).statusCode).toBe(403);
  });
});

describe('Concessions', () => {
  it('a 50% tuition concession for a sibling reduces only tuition, and needs a reason', async () => {
    expect((await acc.post('/fees/concessions', { studentId: sana, feeHeadId: tuition, kind: 'percent', value: 50, reason: '' })).statusCode).toBe(400);
    expect((await acc.post('/fees/concessions', { studentId: sana, feeHeadId: tuition, kind: 'percent', value: 150, reason: 'Too much' })).statusCode).toBe(400);
    const r = await acc.post('/fees/concessions', { studentId: sana, feeHeadId: tuition, kind: 'percent', value: 50, reason: 'Second child (sibling)' });
    expect(r.statusCode).toBe(200);
    const dues = (await acc.get(`/students/${sana}/dues`)).json().dues;
    const t = dues.filter((d: { feeHead: string }) => d.feeHead === 'Tuition');
    expect(t.map((d: { balance: string }) => d.balance)).toEqual(['1500.00', '1500.00']);
    expect(dues.find((d: { feeHead: string }) => d.feeHead === 'Admission').balance).toBe('2000.00');
    const list = (await acc.get(`/students/${sana}/concessions`)).json().concessions;
    expect(list[0]).toMatchObject({ kind: 'percent', reason: 'Second child (sibling)', approvedBy: 'Anil Accounts' });
  });
});

describe('Collecting fees', () => {
  let receiptId: string;
  it('collects Q1 for Arif with the suggested late fine; receipt has the school identity and words', async () => {
    const dues = (await acc.get(`/students/${arif}/dues`)).json().dues;
    const q1Lines = dues.filter((d: { instalment: string }) => d.instalment.startsWith('Q1'));
    // The fine is suggested ONCE per instalment (10 days x Rs 10), not on every fee type
    expect(q1Lines.map((d: { suggestedFine: string }) => d.suggestedFine).sort()).toEqual(['0.00', '100.00']);
    const r = await acc.post('/fees/receipts', {
      studentId: arif, mode: 'cash',
      lines: q1Lines.map((d: { feeDueId: string; balance: string; feeHead: string }) => ({ feeDueId: d.feeDueId, amount: d.balance, fine: d.feeHead === 'Tuition' ? '100' : '0' })),
    });
    expect(r.statusCode).toBe(200);
    receiptId = r.json().id;
    const full = (await acc.get(`/fees/receipts/${receiptId}`)).json();
    expect(full).toMatchObject({ receiptNo: 'RC/2027-28/00001', total: '5100.00', mode: 'cash', collectedBy: 'Anil Accounts', status: 'active' });
    expect(full.school.name).toBe('Green Valley Public School');
    expect(full.student).toMatchObject({ name: 'Arif', className: '5', sectionName: 'A' });
    expect(full.lines).toHaveLength(2);
  });

  it('parents can open their own child\'s receipt; teachers cannot', async () => {
    expect((await api(env, parentToken, S.schoolId).get(`/fees/receipts/${receiptId}`)).statusCode).toBe(200);
    expect((await teacher.get(`/fees/receipts/${receiptId}`)).statusCode).toBe(403);
  });

  it('day book totals by payment mode; cancelled receipts are listed but not counted', async () => {
    const d = (await acc.get(`/students/${tara}/dues`)).json().dues.find((x: { feeHead: string; instalment: string }) => x.feeHead === 'Tuition' && x.instalment.startsWith('Q2'));
    const upi = (await acc.post('/fees/receipts', { studentId: tara, mode: 'upi', reference: 'UPI-778899', lines: [{ feeDueId: d.feeDueId, amount: '1000' }] })).json();
    const wrong = (await acc.post('/fees/receipts', { studentId: tara, mode: 'cash', lines: [{ feeDueId: d.feeDueId, amount: '500' }] })).json();
    await acc.post(`/fees/receipts/${wrong.id}/cancel`, { reason: 'Entered twice by mistake' });
    const book = (await acc.get('/fees/receipts')).json();
    expect(book.receipts).toHaveLength(3); // Arif's, Tara's UPI, and the cancelled one
    expect(book).toMatchObject({ total: '6100.00', cancelled: 1, byMode: { cash: '5100.00', upi: '1000.00' } });
    expect(upi.receipt_no).toBe('RC/2027-28/00002');
  });
});

describe('Defaulters and summary', () => {
  it('lists only families with money past its due date, biggest first', async () => {
    const r = (await acc.get('/fees/defaulters')).json();
    // Arif paid Q1. Sana owes Q1 (1500 tuition after concession + 2000 admission). Tara owes Q1 (3000 + 2000).
    expect(r.defaulters.map((d: { name: string; overdue: string }) => [d.name, d.overdue])).toEqual([['Tara', '5000.00'], ['Sana', '3500.00']]);
    expect(r.total).toBe('8500.00');
    expect(r.defaulters[0].phone).toMatch(/^\+91/);
  });

  it('summary: today, this month, year billed and collected, 6-month chart', async () => {
    const s = (await principal.get('/fees/summary')).json();
    expect(s).toMatchObject({ today: '6100.00', thisMonth: '6100.00', overdue: '8500.00', defaulters: 2 });
    // billed: Arif 8000, Sana 5000 (after concession), Tara 8000
    expect(s.yearBilled).toBe('21000.00');
    expect(s.yearCollected).toBe('6000.00'); // fines are not part of fee lines
    expect(s.months).toHaveLength(6);
    expect(s.months[5].collected).toBe('6100.00');
  });

  it('changing the structure updates only lines nobody has paid on', async () => {
    await acc.put(`/fees/structure/${class5}`, { items: [
      { feeHeadId: tuition, instalmentId: q1, amount: '3500' },
      { feeHeadId: tuition, instalmentId: q2, amount: '3500' },
      { feeHeadId: admission, instalmentId: q1, amount: '2000' },
    ] });
    const g = (await acc.post('/fees/generate-dues', { updateUnpaid: true })).json();
    // Unpaid tuition lines: Arif Q2, Sana Q1 + Q2, Tara Q1 = 4 (Arif Q1 paid, Tara Q2 part-paid: left alone)
    expect(g.updated).toBe(4);
    const sanaT = (await acc.get(`/students/${sana}/dues`)).json().dues.filter((d: { feeHead: string }) => d.feeHead === 'Tuition');
    expect(sanaT.map((d: { balance: string }) => d.balance)).toEqual(['1750.00', '1750.00']); // 50% concession re-applied
  });

  it('an instalment children already owe cannot be removed', async () => {
    const del = await acc.del(`/fees/instalments/${q1}`);
    expect(del.statusCode).toBe(400);
  });
});

describe('School identity', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  it('principal uploads a logo; anyone can see it (for the website and receipts)', async () => {
    const r = await principal.put('/school/logo', { dataUrl: png });
    expect(r.statusCode).toBe(200);
    const pub = await env.app.inject({ method: 'GET', url: `/schools/${S.schoolId}/logo` });
    expect(pub.statusCode).toBe(200);
    expect(pub.headers['content-type']).toBe('image/png');
    expect((await principal.get('/school')).json().school.logo_url).toMatch(/\/logo\?v=/);
  });

  it('refuses things that are not pictures (like SVG, which can hide scripts)', async () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`;
    expect((await principal.put('/school/logo', { dataUrl: svg })).statusCode).toBe(400);
    expect((await acc.put('/school/logo', { dataUrl: png })).statusCode).toBe(403);
  });

  it('colour, short name and affiliation number', async () => {
    const r = await principal.patch('/school/identity', { brandColor: '#1F4E9A', shortName: 'GVPS', affiliationNo: '2030456' });
    expect(r.json()).toEqual({ brandColor: '#1F4E9A', shortName: 'GVPS', affiliationNo: '2030456' });
    expect((await principal.patch('/school/identity', { brandColor: 'blue' })).statusCode).toBe(400);
  });
});
