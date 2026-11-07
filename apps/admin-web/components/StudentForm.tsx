'use client';
// One form for adding and editing a student. The family is identified by
// ONE phone number: type a number that already exists and the child joins
// that family (brothers and sisters show together in the parent app).
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { classLabel, type Structure } from '@/lib/types';
import { ErrorBox, Field, PhoneInput } from './ui';

export interface StudentValues {
  admissionNo: string; firstName: string; lastName: string; dateOfBirth: string; gender: string;
  bloodGroup: string; admissionDate: string; sectionId: string; rollNo: string; status?: string;
  family: { phone: string; fatherName: string; motherName: string; guardianName: string; altPhone: string; address: string };
}

export const emptyStudent: StudentValues = {
  admissionNo: '', firstName: '', lastName: '', dateOfBirth: '', gender: '', bloodGroup: '', admissionDate: '',
  sectionId: '', rollNo: '',
  family: { phone: '', fatherName: '', motherName: '', guardianName: '', altPhone: '', address: '' },
};

export function StudentForm({ initial, editing, onSubmit, submitLabel }: {
  initial: StudentValues; editing: boolean; submitLabel: string;
  onSubmit: (v: StudentValues) => Promise<void>;
}) {
  const [v, setV] = useState(initial);
  const [structure, setStructure] = useState<Structure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<Structure>('/setup/structure').then(setStructure); }, []);

  const set = (k: keyof StudentValues, val: string) => setV({ ...v, [k]: val });
  const setF = (k: keyof StudentValues['family'], val: string) => setV({ ...v, family: { ...v.family, [k]: val } });
  const sections = structure?.classes.flatMap((c) => c.sections.map((s) => ({ id: s.id, label: `${classLabel(c.name)} ${s.name}` }))) ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await onSubmit(v); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save'); window.scrollTo({ top: 0 }); }
    finally { setBusy(false); }
  };

  return (
    <form className="stack" style={{ gap: 22 }} onSubmit={submit}>
      <ErrorBox error={error} />
      <div className="sheet sheet-pad stack">
        <h2>Student</h2>
        <div className="grid-3">
          <Field label="Admission number" htmlFor="adm">
            <input id="adm" className="input" required value={v.admissionNo} onChange={(e) => set('admissionNo', e.target.value)} />
          </Field>
          <Field label="First name" htmlFor="fn">
            <input id="fn" className="input" required value={v.firstName} onChange={(e) => set('firstName', e.target.value)} />
          </Field>
          <Field label="Last name" htmlFor="ln">
            <input id="ln" className="input" value={v.lastName} onChange={(e) => set('lastName', e.target.value)} />
          </Field>
          <Field label="Date of birth" htmlFor="dob">
            <input id="dob" type="date" className="input" value={v.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
          </Field>
          <Field label="Gender" htmlFor="g">
            <select id="g" className="input" value={v.gender} onChange={(e) => set('gender', e.target.value)}>
              <option value="">Not given</option><option value="female">Girl</option><option value="male">Boy</option><option value="other">Other</option>
            </select>
          </Field>
          {!editing ? (
            <Field label="Admission date" htmlFor="ad">
              <input id="ad" type="date" className="input" value={v.admissionDate} onChange={(e) => set('admissionDate', e.target.value)} />
            </Field>
          ) : null}
        </div>
        <div className="grid-3">
          <Field label={`Class and section (${structure?.year.name ?? ''})`} htmlFor="sec"
            hint={structure && sections.length === 0 ? 'Add sections on the Classes page first.' : undefined}>
            <select id="sec" className="input" required value={v.sectionId} onChange={(e) => set('sectionId', e.target.value)}>
              <option value="">Choose…</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Roll number" htmlFor="roll" hint="Optional">
            <input id="roll" className="input num" inputMode="numeric" value={v.rollNo}
              onChange={(e) => set('rollNo', e.target.value.replace(/\D/g, '').slice(0, 3))} />
          </Field>
          {editing ? (
            <Field label="Status" htmlFor="st">
              <select id="st" className="input" value={v.status} onChange={(e) => set('status', e.target.value)}>
                <option value="active">Studying here</option><option value="left">Left the school</option>
                <option value="transferred">Transferred (TC issued)</option><option value="passed_out">Passed out</option>
              </select>
            </Field>
          ) : null}
        </div>
      </div>

      <div className="sheet sheet-pad stack">
        <div>
          <h2>Family</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            One mobile number per family. Parents log into the app with it and see all their children together.
          </p>
        </div>
        <div className="grid-3">
          <Field label="Family mobile number" htmlFor="fp"
            hint={editing ? 'To change the family number, ask us; it is the parents’ login.' : 'If this number is already in the school, the child joins that family.'}>
            {editing ? <input id="fp" className="input num" disabled value={v.family.phone} />
              : <PhoneInput id="fp" value={v.family.phone} onChange={(x) => setF('phone', x)} required />}
          </Field>
          <Field label="Father's name" htmlFor="ff">
            <input id="ff" className="input" value={v.family.fatherName} onChange={(e) => setF('fatherName', e.target.value)} />
          </Field>
          <Field label="Mother's name" htmlFor="fm">
            <input id="fm" className="input" value={v.family.motherName} onChange={(e) => setF('motherName', e.target.value)} />
          </Field>
          <Field label="Guardian's name" htmlFor="fg" hint="If not the parents">
            <input id="fg" className="input" value={v.family.guardianName} onChange={(e) => setF('guardianName', e.target.value)} />
          </Field>
          <Field label="Other phone" htmlFor="fa" hint="Optional, not used for login">
            <input id="fa" className="input num" inputMode="tel" value={v.family.altPhone} onChange={(e) => setF('altPhone', e.target.value)} />
          </Field>
        </div>
        <Field label="Address" htmlFor="addr">
          <textarea id="addr" className="input" rows={2} value={v.family.address} onChange={(e) => setF('address', e.target.value)} />
        </Field>
      </div>

      <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button></div>
    </form>
  );
}

/** Turn the form into what the server expects (blank boxes become "not given"). */
export function toPayload(v: StudentValues, editing: boolean) {
  const blank = (s: string) => (s.trim() === '' ? null : s.trim());
  const family = {
    fatherName: blank(v.family.fatherName), motherName: blank(v.family.motherName),
    guardianName: blank(v.family.guardianName), altPhone: blank(v.family.altPhone), address: blank(v.family.address),
  };
  return {
    admissionNo: v.admissionNo.trim(), firstName: v.firstName.trim(), lastName: blank(v.lastName),
    dateOfBirth: blank(v.dateOfBirth), gender: blank(v.gender), sectionId: v.sectionId,
    rollNo: v.rollNo ? Number(v.rollNo) : null,
    ...(editing ? { status: v.status, family } : {
      admissionDate: blank(v.admissionDate), bloodGroup: blank(v.bloodGroup), family: { ...family, phone: v.family.phone },
    }),
  };
}
