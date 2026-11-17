'use client';
// Staff & roles. The owner and principal add people and give them roles;
// one person can hold several roles (for example Teacher + Accountant).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ROLES, ROLE_LABELS, canAssignRole, type Role } from '@arscio/shared';
import { ApiError, api, auth, makeTempPassword } from '@/lib/api';
import { showPhone, type StaffMember } from '@/lib/types';
import { useSchool } from '@/components/AppShell';
import { ErrorBox, Field, Loading, Panel, PhoneInput, useToast } from '@/components/ui';

const STAFF_ROLES = ROLES.filter((r) => r !== 'parent');
const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including making principals',
  principal: 'Everything except making owners or principals',
  office_admin: 'Students, notices, resetting logins',
  accountant: 'Fees, receipts, cancelling receipts',
  teacher: 'Attendance, homework and marks in the teacher app',
  parent: '',
};

export default function StaffPage() {
  const { info, can } = useSchool();
  const manage = can('roles.assign');
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const toast = useToast();
  const [mode, setMode] = useState<'otp' | 'password'>('otp');
  useEffect(() => { auth.mode().then((m) => setMode(m.mode)).catch(() => {}); }, []);
  const [slip, setSlip] = useState<LoginSlip | null>(null);

  const load = useCallback(async () => setStaff((await api.get<{ staff: StaffMember[] }>('/staff')).staff), []);
  useEffect(() => { void load(); }, [load]);
  if (!staff) return <Loading />;

  const shown = staff.filter((s) => showInactive || s.status === 'active');
  const inactive = staff.length - staff.filter((s) => s.status === 'active').length;

  return (
    <>
      <div className="page-head">
        <div><h1>Staff & roles</h1><p>{mode === 'password'
          ? 'Everyone who works at the school. They log in with their email or mobile number and the first password you give them, then choose their own.'
          : 'Everyone who works at the school. They log in with their own mobile number; the first time, they get a code by SMS.'}</p></div>
        {manage ? <button className="btn btn-primary" onClick={() => setEditing('new')}>Add staff member</button> : null}
      </div>

      <div className="sheet table-wrap">
        <table className="register">
          <thead><tr><th>Code</th><th>Name</th><th>Mobile and email</th><th>Roles</th><th>Login</th><th></th></tr></thead>
          <tbody>{shown.map((s) => (
            <tr key={s.membershipId} style={s.status === 'inactive' ? { opacity: 0.55 } : undefined}>
              <td className="muted">{s.employeeCode ?? '-'}</td>
              <td><strong>{s.name}</strong>{s.designation ? <div className="small muted">{s.designation}</div> : null}</td>
              <td><span className="num nowrap">{showPhone(s.phone)}</span>{s.email ? <div className="small muted">{s.email}</div> : null}</td>
              <td>{s.roles.filter((r) => r !== 'parent').map((r) => <span key={r} className="tag">{ROLE_LABELS[r]}</span>)}</td>
              <td className="small">
                {s.status === 'inactive' ? <span className="tag tag-off">No access</span>
                  : s.mustChangePassword ? <span className="tag tag-warn">Waiting for first login</span>
                  : s.hasLoggedIn ? <span className="tag tag-board">Active</span>
                  : <span className="tag tag-warn">Not logged in yet</span>}
              </td>
              <td className="actions">{manage ? <button className="btn btn-plain" onClick={() => setEditing(s)}>Edit</button> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {inactive > 0 ? (
        <label className="row small muted" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show {inactive} inactive {inactive === 1 ? 'person' : 'people'}
        </label>
      ) : null}

      <Panel open={editing !== null} title={editing === 'new' ? 'Add staff member' : 'Edit staff member'} onClose={() => setEditing(null)}>
        {editing !== null ? (
          <StaffForm person={editing === 'new' ? null : editing} myRoles={info.me.roles}
            canReset={can('accounts.reset_login')} mode={mode} schoolName={info.school.name}
            onSlip={setSlip}
            onDone={async (msg) => { await load(); toast.show(msg); }} onClose={() => setEditing(null)} />
        ) : null}
      </Panel>
      <Panel open={slip !== null} title="Login details" onClose={() => setSlip(null)}>
        {slip ? <SlipView slip={slip} /> : null}
      </Panel>
      {toast.node}
    </>
  );
}

interface LoginSlip { schoolName: string; name: string; logins: string[]; password: string }

/** Shown once, right after a password is set: the principal hands it over (printed or read out). */
function SlipView({ slip }: { slip: LoginSlip }) {
  const print = () => {
    const w = window.open('', '_blank', 'width=480,height=600');
    if (!w) return;
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    w.document.write(`<!doctype html><title>Login slip</title><body style="font-family:system-ui;padding:24px">
      <div style="border:1.5px dashed #555;border-radius:10px;padding:20px;max-width:360px">
      <div style="font-weight:700;font-size:18px">${esc(slip.schoolName)}</div>
      <div style="color:#555;margin-bottom:14px">Staff login: teacher app and office website</div>
      <div><b>${esc(slip.name)}</b></div>
      <div style="margin-top:8px">Log in with: <b>${slip.logins.map(esc).join('</b> or <b>')}</b></div>
      <div style="margin-top:4px">First password: <b style="font-family:monospace;font-size:18px">${esc(slip.password)}</b></div>
      <div style="margin-top:12px;font-size:13px;color:#555">This password works once. You will be asked to choose your own after logging in. Do not share it.</div>
      </div><script>print()</script></body>`);
    w.document.close();
  };
  return (
    <div className="stack">
      <p className="muted">Give these to {slip.name}. The password is shown only now; if it is lost, give a new one.</p>
      <div className="sheet" style={{ padding: 18 }}>
        <div><strong>{slip.name}</strong></div>
        <div className="small" style={{ marginTop: 8 }}>Log in with: <strong>{slip.logins.join(' or ')}</strong></div>
        <div className="small" style={{ marginTop: 4 }}>First password: <strong className="num" style={{ fontSize: 18, letterSpacing: 1 }}>{slip.password}</strong></div>
      </div>
      <div className="row">
        <button className="btn btn-primary" onClick={print}>Print slip</button>
        <button className="btn btn-plain" onClick={() => void navigator.clipboard?.writeText(
          `${slip.schoolName}\nLogin: ${slip.logins.join(' or ')}\nFirst password: ${slip.password}\n(You will choose your own after logging in.)`)}>Copy</button>
      </div>
    </div>
  );
}

function StaffForm({ person, myRoles, canReset, mode, schoolName, onSlip, onDone, onClose }: {
  person: StaffMember | null; myRoles: Role[]; canReset: boolean; mode: 'otp' | 'password'; schoolName: string;
  onSlip: (s: LoginSlip) => void;
  onDone: (msg: string) => Promise<void>; onClose: () => void;
}) {
  const pwMode = mode === 'password';
  const [email, setEmail] = useState(person?.email ?? '');
  const [firstPw, setFirstPw] = useState(() => (pwMode ? makeTempPassword() : ''));
  const [newPw, setNewPw] = useState('');
  const amOwnerOrPrincipal = myRoles.includes('owner') || myRoles.includes('principal');
  const targetIsOwner = !!person?.roles.includes('owner');
  const canSetPassword = amOwnerOrPrincipal && (!targetIsOwner || myRoles.includes('owner'));
  const [name, setName] = useState(person?.name ?? '');
  const [phone, setPhone] = useState(person ? person.phone.slice(3) : '');
  const [designation, setDesignation] = useState(person?.designation ?? '');
  const [code, setCode] = useState(person?.employeeCode ?? '');
  const [roles, setRoles] = useState<Role[]>(person?.roles ?? ['teacher']);
  const [canData, setCanData] = useState(!!person?.extra?.includes('data.import_export'));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, msg: string, close = true) => {
    setBusy(true); setError(null);
    try { await fn(); await onDone(msg); if (close) onClose(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!roles.some((r) => r !== 'parent')) { setError('Choose at least one role.'); return; }
    if (!person) {
      if (pwMode && firstPw.length < 6) { setError('The first password must be at least 6 characters.'); return; }
      void run(async () => {
        await api.post('/staff', { name, phone, email: email.trim() || null, designation, employeeCode: code, roles,
          ...(pwMode ? { password: firstPw } : {}) });
        if (pwMode) onSlip({ schoolName, name, password: firstPw, logins: [email.trim(), `${phone.slice(0, 5)} ${phone.slice(5)}`].filter(Boolean) });
      }, `${name} added`);
    } else {
      void run(async () => {
        await api.patch(`/staff/${person.membershipId}`, { name, designation, employeeCode: code,
          ...(amOwnerOrPrincipal && (email.trim() || null) !== (person.email ?? null) ? { email: email.trim() || null } : {}) });
        await api.put(`/members/${person.membershipId}/roles`, { roles });
      }, `${name} saved`);
    }
  };

  return (
    <form className="stack" onSubmit={save}>
      <Field label="Full name" htmlFor="n"><input id="n" className="input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Mobile number" htmlFor="p" hint={person ? 'The mobile number is part of their login and cannot be changed here.' : 'They can log in with this number.'}>
        {person ? <input id="p" className="input num" disabled value={showPhone(person.phone)} />
          : <PhoneInput id="p" value={phone} onChange={setPhone} required />}
      </Field>
      <Field label={pwMode ? 'Email' : 'Email (optional)'} htmlFor="em"
        hint={pwMode ? 'They can log in with this email or their mobile number. Optional, but easier to remember.' : 'Optional.'}>
        <input id="em" className="input" type="email" autoComplete="off" disabled={!!person && !amOwnerOrPrincipal}
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {pwMode && !person ? (
        <Field label="First password" htmlFor="fp" hint="Made for you; you can type your own. They must change it the first time they log in.">
          <div className="row" style={{ gap: 8 }}>
            <input id="fp" className="input num" required value={firstPw} onChange={(e) => setFirstPw(e.target.value)} style={{ flex: 1 }} />
            <button type="button" className="btn btn-plain" onClick={() => setFirstPw(makeTempPassword())}>Make another</button>
          </div>
        </Field>
      ) : null}
      <div className="grid-2">
        <Field label="Designation" htmlFor="d" hint="For example TGT English, Clerk">
          <input id="d" className="input" value={designation} onChange={(e) => setDesignation(e.target.value)} />
        </Field>
        <Field label="Employee code" htmlFor="c" hint="Optional">
          <input id="c" className="input" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
      </div>
      <div className="field">
        <span className="label">Roles</span>
        <span className="hint">Tick every role this person has.</span>
        <div className="stack" style={{ gap: 8, marginTop: 6 }}>
          {STAFF_ROLES.map((r) => {
            const allowed = canAssignRole(myRoles, r);
            return (
              <label key={r} className="check" style={{ borderRadius: 'var(--r-sm)', justifyContent: 'flex-start' }}>
                <input type="checkbox" disabled={!allowed} checked={roles.includes(r)}
                  onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))} />
                <span><strong>{ROLE_LABELS[r]}</strong> <span className="small muted">{ROLE_HELP[r]}{!allowed ? '. Only the owner can give this.' : ''}</span></span>
              </label>
            );
          })}
        </div>
      </div>
      <ErrorBox error={error} />
      <div><button className="btn btn-primary" disabled={busy || !name.trim() || (!person && phone.length !== 10)}>
        {person ? 'Save changes' : 'Add staff member'}</button></div>

      {person ? (
        <div className="stack" style={{ borderTop: '1px solid var(--rule)', paddingTop: 18, gap: 12 }}>
          <h3>Login and access</h3>
          {(myRoles.includes('owner') || myRoles.includes('principal')) && !person.roles.some((r) => r === 'owner' || r === 'principal') ? (
            <label className="check" style={{ justifyContent: 'flex-start' }}>
              <input type="checkbox" disabled={busy} checked={canData}
                onChange={(e) => { const on = e.target.checked; void run(async () => { await api.put(`/staff/${person.membershipId}/permissions/data.import_export`, { on }); setCanData(on); },
                  e.target.checked ? `${person.name} can now use Excel import and export` : `${person.name} can no longer use Excel import and export`, false); }} />
              <span><strong>Excel import and export</strong> <span className="small muted">Download lists as Excel and import students and marks from Excel files.</span></span>
            </label>
          ) : null}
          {pwMode && canSetPassword && person.status === 'active' ? (
            <div className="stack" style={{ gap: 8 }}>
              <span className="small muted">Forgot their password? Give them a new one. They will be logged out everywhere and must choose their own again.</span>
              <div className="row" style={{ gap: 8 }}>
                <input className="input num" aria-label="New password" placeholder="New password" value={newPw}
                  onChange={(e) => setNewPw(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="btn btn-plain" onClick={() => setNewPw(makeTempPassword())}>Make one</button>
                <button type="button" className="btn btn-plain" disabled={busy || newPw.length < 6}
                  onClick={() => run(async () => {
                    await api.post(`/staff/${person.membershipId}/password`, { password: newPw });
                    onSlip({ schoolName, name: person.name, password: newPw,
                      logins: [person.email ?? '', showPhone(person.phone)].filter(Boolean) });
                    setNewPw('');
                  }, `New password given to ${person.name}`)}>Give new password</button>
              </div>
            </div>
          ) : null}
          {!pwMode && canReset && person.hasLoggedIn ? (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">Forgot their password and can&apos;t get the SMS? Reset it so they set a new one with a code.</span>
              <button type="button" className="btn btn-plain" disabled={busy}
                onClick={() => confirm(`Reset ${person.name}'s login? They will be logged out everywhere.`) &&
                  run(() => api.post(`/accounts/${person.accountId}/reset-login`), `${person.name}'s login was reset`, false)}>
                Reset login</button>
            </div>
          ) : null}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">{person.status === 'active' ? 'Left the school? Remove their access. They are logged out at once; their records stay.' : 'This person has no access to the school right now.'}</span>
            {!amOwnerOrPrincipal || (targetIsOwner && !myRoles.includes('owner')) ? null : person.status === 'active' ? (
              <button type="button" className="btn btn-danger" disabled={busy}
                onClick={() => confirm(`Remove ${person.name}'s access? They will be logged out of the app and website straight away.`) &&
                  run(() => api.patch(`/staff/${person.membershipId}`, { status: 'inactive' }), `${person.name} no longer has access`)}>
                Remove access</button>
            ) : (
              <button type="button" className="btn btn-plain" disabled={busy}
                onClick={() => run(() => api.patch(`/staff/${person.membershipId}`, { status: 'active' }), `${person.name} has access again`)}>
                Give access again</button>
            )}
          </div>
        </div>
      ) : null}
    </form>
  );
}
