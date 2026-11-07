'use client';
// Staff & roles. The owner and principal add people and give them roles;
// one person can hold several roles (for example Teacher + Accountant).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ROLES, ROLE_LABELS, canAssignRole, type Role } from '@aiedu/shared';
import { ApiError, api } from '@/lib/api';
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

  const load = useCallback(async () => setStaff((await api.get<{ staff: StaffMember[] }>('/staff')).staff), []);
  useEffect(() => { void load(); }, [load]);
  if (!staff) return <Loading />;

  const shown = staff.filter((s) => showInactive || s.status === 'active');
  const inactive = staff.length - staff.filter((s) => s.status === 'active').length;

  return (
    <>
      <div className="page-head">
        <div><h1>Staff & roles</h1><p>Everyone who works at the school. They log in with their own mobile number; the first time, they get a code by SMS.</p></div>
        {manage ? <button className="btn btn-primary" onClick={() => setEditing('new')}>Add staff member</button> : null}
      </div>

      <div className="sheet table-wrap">
        <table className="register">
          <thead><tr><th>Code</th><th>Name</th><th>Mobile</th><th>Roles</th><th>Login</th><th></th></tr></thead>
          <tbody>{shown.map((s) => (
            <tr key={s.membershipId} style={s.status === 'inactive' ? { opacity: 0.55 } : undefined}>
              <td className="muted">{s.employeeCode ?? '-'}</td>
              <td><strong>{s.name}</strong>{s.designation ? <div className="small muted">{s.designation}</div> : null}</td>
              <td className="num nowrap">{showPhone(s.phone)}</td>
              <td>{s.roles.filter((r) => r !== 'parent').map((r) => <span key={r} className="tag">{ROLE_LABELS[r]}</span>)}</td>
              <td className="small">
                {s.status === 'inactive' ? <span className="tag tag-off">Inactive</span>
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
            canReset={can('accounts.reset_login')}
            onDone={async (msg) => { await load(); toast.show(msg); }} onClose={() => setEditing(null)} />
        ) : null}
      </Panel>
      {toast.node}
    </>
  );
}

function StaffForm({ person, myRoles, canReset, onDone, onClose }: {
  person: StaffMember | null; myRoles: Role[]; canReset: boolean;
  onDone: (msg: string) => Promise<void>; onClose: () => void;
}) {
  const [name, setName] = useState(person?.name ?? '');
  const [phone, setPhone] = useState(person ? person.phone.slice(3) : '');
  const [designation, setDesignation] = useState(person?.designation ?? '');
  const [code, setCode] = useState(person?.employeeCode ?? '');
  const [roles, setRoles] = useState<Role[]>(person?.roles ?? ['teacher']);
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
      void run(() => api.post('/staff', { name, phone, designation, employeeCode: code, roles }), `${name} added`);
    } else {
      void run(async () => {
        await api.patch(`/staff/${person.membershipId}`, { name, designation, employeeCode: code });
        await api.put(`/members/${person.membershipId}/roles`, { roles });
      }, `${name} saved`);
    }
  };

  return (
    <form className="stack" onSubmit={save}>
      <Field label="Full name" htmlFor="n"><input id="n" className="input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Mobile number" htmlFor="p" hint={person ? 'The mobile number is their login and cannot be changed here.' : 'They will log in with this number.'}>
        {person ? <input id="p" className="input num" disabled value={showPhone(person.phone)} />
          : <PhoneInput id="p" value={phone} onChange={setPhone} required />}
      </Field>
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
          {canReset && person.hasLoggedIn ? (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">Forgot their password and can&apos;t get the SMS? Reset it so they set a new one with a code.</span>
              <button type="button" className="btn btn-plain" disabled={busy}
                onClick={() => confirm(`Reset ${person.name}'s login? They will be logged out everywhere.`) &&
                  run(() => api.post(`/accounts/${person.accountId}/reset-login`), `${person.name}'s login was reset`, false)}>
                Reset login</button>
            </div>
          ) : null}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">{person.status === 'active' ? 'Left the school? Make them inactive; their records stay.' : 'This person cannot use the school right now.'}</span>
            {person.status === 'active' ? (
              <button type="button" className="btn btn-danger" disabled={busy}
                onClick={() => confirm(`Make ${person.name} inactive?`) &&
                  run(() => api.patch(`/staff/${person.membershipId}`, { status: 'inactive' }), `${person.name} is now inactive`)}>
                Make inactive</button>
            ) : (
              <button type="button" className="btn btn-plain" disabled={busy}
                onClick={() => run(() => api.patch(`/staff/${person.membershipId}`, { status: 'active' }), `${person.name} is active again`)}>
                Make active again</button>
            )}
          </div>
        </div>
      ) : null}
    </form>
  );
}
