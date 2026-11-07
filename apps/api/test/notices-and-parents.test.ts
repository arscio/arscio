// NOTICES, the PARENT app's data, the INBOX, and sending PHONE NOTIFICATIONS
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayIST } from '../src/routes/attendance.js';
import { sendQueuedPushes } from '../src/notify/push.js';
import { addFamily, addMember, addTuitionDue, api, loginAs, newSchool, setupEnv, type TestEnv } from './helpers.js';
import { TEST_OWNER_URL } from './global-setup.js';

let env: TestEnv;
let S: Awaited<ReturnType<typeof newSchool>>;
let office: ReturnType<typeof api>;
let teacher: ReturnType<typeof api>;
let teacherAccount: string;
let fam5: Awaited<ReturnType<typeof addFamily>>;   // two children in Class 5 A
let famOther: Awaited<ReturnType<typeof addFamily>>;
let parentToken: string;
let parent: ReturnType<typeof api>;
let class5: string;

beforeAll(async () => {
  env = await setupEnv();
  S = await newSchool(env, 'Green Valley Public School');
  office = api(env, (await loginAs(env, (await addMember(env, S.schoolId, ['office_admin'])).phone)).accessToken, S.schoolId);
  const t = await addMember(env, S.schoolId, ['teacher'], 'Rina Das');
  teacherAccount = t.accountId;
  teacher = api(env, (await loginAs(env, t.phone)).accessToken, S.schoolId);
  fam5 = await addFamily(env, S, ['Arif', 'Sana'], { withParentLogin: true });
  famOther = await addFamily(env, S, ['Tara'], { withParentLogin: true });
  parentToken = (await loginAs(env, fam5.phone)).accessToken;
  parent = api(env, parentToken, S.schoolId);
  class5 = (await env.owner.query('SELECT class_id FROM sections WHERE id = $1', [fam5.sectionId])).rows[0].class_id;
});
afterAll(async () => { await env.close(); });

describe('Notices', () => {
  it('to all parents: each family gets one message; staff do not', async () => {
    const r = await office.post('/notices', { title: 'Holiday on Monday', body: 'School stays closed for Bhogali Bihu.', audience: 'parents' });
    expect(r.statusCode).toBe(200);
    expect(r.json().recipients).toBe(2);
    const inbox = (await api(env, parentToken).get('/me/messages')).json();
    expect(inbox.messages[0]).toMatchObject({ title: 'Holiday on Monday', schoolName: 'Green Valley Public School', readAt: null });
    expect(inbox.unread).toBe(1);
    const t = await env.owner.query('SELECT count(*)::int AS n FROM notifications WHERE account_id = $1', [teacherAccount]);
    expect(t.rows[0].n).toBe(0);
  });

  it('to staff only; to chosen classes', async () => {
    expect((await office.post('/notices', { title: 'Staff meeting', body: 'At 3 pm in the library.', audience: 'staff' })).json().recipients).toBe(3); // owner, office, teacher
    const other = await env.owner.query("SELECT id FROM classes WHERE school_id = $1 AND name = '9'", [S.schoolId]);
    expect((await office.post('/notices', { title: 'Class 9 trip', body: 'Forms by Friday.', audience: 'classes', classIds: [other.rows[0].id] })).json().recipients).toBe(0);
    expect((await office.post('/notices', { title: 'Class 5 test', body: 'Maths test on Friday.', audience: 'classes', classIds: [class5] })).json().recipients).toBe(2);
    expect((await office.post('/notices', { title: 'Oops', body: 'No classes chosen', audience: 'classes' })).statusCode).toBe(400);
  });

  it('read counts, and withdrawing removes it from apps but keeps the record', async () => {
    const list = (await office.get('/notices')).json().notices;
    const holiday = list.find((n: { title: string }) => n.title === 'Holiday on Monday');
    const msg = (await api(env, parentToken).get('/me/messages')).json().messages.find((m: { title: string }) => m.title === 'Holiday on Monday');
    expect((await api(env, parentToken).post(`/me/messages/${msg.id}/read`)).statusCode).toBe(200);
    expect((await office.get('/notices')).json().notices.find((n: { id: string }) => n.id === holiday.id)).toMatchObject({ recipients: 2, readBy: 1 });

    expect((await office.post(`/notices/${holiday.id}/withdraw`)).statusCode).toBe(200);
    const after = (await api(env, parentToken).get('/me/messages')).json().messages.map((m: { title: string }) => m.title);
    expect(after).not.toContain('Holiday on Monday');
    expect((await office.get('/notices')).json().notices.find((n: { id: string }) => n.id === holiday.id).withdrawnAt).toBeTruthy();
    await expect(env.owner.query('DELETE FROM notices WHERE id = $1', [holiday.id])).rejects.toThrow(/not allowed/);
  });

  it('teachers and parents cannot send notices; nobody can read another person\'s messages', async () => {
    expect((await teacher.post('/notices', { title: 'Hi all', body: 'Test message', audience: 'everyone' })).statusCode).toBe(403);
    const mine = (await api(env, parentToken).get('/me/messages')).json().messages[0];
    const otherParent = (await loginAs(env, famOther.phone)).accessToken;
    expect((await api(env, otherParent).post(`/me/messages/${mine.id}/read`)).statusCode).toBe(404);
  });
});

describe('Parent app data', () => {
  it('summary for my child: today, this month, fees, homework, school identity', async () => {
    const [arif, sana] = fam5.students as [string, string];
    await addTuitionDue(env, S, arif);
    await teacher.put('/attendance/sheet', {
      sectionId: fam5.sectionId, date: todayIST(), period: 0,
      marks: [...fam5.students, ...famOther.students].map((studentId) => ({ studentId, status: studentId === sana ? 'absent' : 'present' })),
    });
    await teacher.post('/homework', { sectionId: fam5.sectionId, title: 'Learn table of 7' });
    const s = (await parent.get(`/parent/children/${arif}/summary`)).json();
    expect(s.child).toMatchObject({ firstName: 'Arif', className: '5', sectionName: 'A' });
    expect(s.attendance.today).toBe('present');
    expect(s.attendance.month).toMatchObject({ present: 1, absent: 0, leave: 0, days: 1 });
    expect(s.fees).toMatchObject({ due: '3000.00', hasFees: true });
    expect(s.homework[0].title).toBe('Learn table of 7');
    expect(s.school).toMatchObject({ name: 'Green Valley Public School', onlinePayments: false });
    expect((await parent.get(`/parent/children/${sana}/summary`)).json().attendance.today).toBe('absent');
  });

  it('a parent cannot see someone else\'s child', async () => {
    const tara = famOther.students[0]!;
    expect((await parent.get(`/parent/children/${tara}/summary`)).statusCode).toBe(403);
    expect((await parent.get(`/parent/children/${tara}/fees`)).statusCode).toBe(403);
    expect((await parent.get(`/parent/children/${tara}/attendance`)).statusCode).toBe(403);
  });

  it('attendance month, homework list and fees with receipts', async () => {
    const arif = fam5.students[0]!;
    const a = (await parent.get(`/parent/children/${arif}/attendance`)).json();
    expect(a.days).toEqual([{ date: todayIST(), status: 'present' }]);
    expect((await parent.get(`/parent/children/${arif}/homework`)).json().homework[0]).toMatchObject({ givenBy: 'Rina Das' });
    const f = (await parent.get(`/parent/children/${arif}/fees`)).json();
    expect(f.dues).toHaveLength(1);
    expect(f.receipts).toEqual([]);
  });

  it('children list carries each school\'s name, logo and colour', async () => {
    await env.owner.query("UPDATE schools SET brand_color = '#1F4E9A', short_name = 'GVPS' WHERE id = $1", [S.schoolId]);
    const kids = (await api(env, parentToken).get('/me/children')).json().children;
    expect(kids[0]).toMatchObject({ schoolName: 'Green Valley Public School', schoolColor: '#1F4E9A', schoolShortName: 'GVPS' });
  });
});

describe('Phone notifications', () => {
  it('sends to the parent\'s phone, skips corrected absences, forgets uninstalled phones', async () => {
    const p = api(env, parentToken);
    expect((await p.post('/me/push-devices', { app: 'parent', platform: 'android', pushToken: 'ExponentPushToken[aaa111]' })).statusCode).toBe(200);
    expect((await p.post('/me/push-devices', { app: 'parent', platform: 'ios', pushToken: 'ExponentPushToken[gone222]' })).statusCode).toBe(200);

    // Sana was marked absent earlier; now the teacher corrects her to present.
    await teacher.put('/attendance/sheet', {
      sectionId: fam5.sectionId, date: todayIST(), period: 0,
      marks: [...fam5.students, ...famOther.students].map((studentId) => ({ studentId, status: 'present' })),
    });

    const sentTo: string[] = [];
    const fakeFetch = async (_url: string, init: { body: string }) => {
      const msgs = JSON.parse(init.body) as { to: string }[];
      sentTo.push(...msgs.map((m) => m.to));
      return { ok: true, status: 200, json: async () => ({ data: msgs.map((m) => m.to.includes('gone')
        ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }) }) };
    };
    const owner = new pg.Pool({ connectionString: TEST_OWNER_URL });
    const r = await sendQueuedPushes(owner, fakeFetch);
    expect(r.skipped).toBeGreaterThanOrEqual(1); // the corrected "absent" alert
    expect(sentTo).toContain('ExponentPushToken[aaa111]');
    const absent = await owner.query("SELECT status, push_error FROM notifications WHERE data->>'kind' = 'absent'");
    expect(absent.rows[0]).toMatchObject({ status: 'failed', push_error: 'corrected_before_sending' });
    await new Promise((res) => setTimeout(res, 50));
    const devices = await owner.query('SELECT push_token FROM push_devices WHERE account_id = $1', [fam5.accountId]);
    expect(devices.rows.map((d) => d.push_token)).toEqual(['ExponentPushToken[aaa111]']);
    // Nothing is sent twice
    expect((await sendQueuedPushes(owner, fakeFetch)).sent).toBe(0);
    await owner.end();
  });

  it('a phone that changes hands moves to the new person', async () => {
    const other = api(env, (await loginAs(env, famOther.phone)).accessToken);
    expect((await other.post('/me/push-devices', { app: 'parent', platform: 'android', pushToken: 'ExponentPushToken[aaa111]' })).statusCode).toBe(200);
    const d = await env.owner.query("SELECT account_id FROM push_devices WHERE push_token = 'ExponentPushToken[aaa111]'");
    expect(d.rows[0].account_id).toBe(famOther.accountId);
  });
});
