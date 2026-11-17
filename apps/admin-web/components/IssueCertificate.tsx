'use client';
// Issue a transfer, bonafide or character certificate. Arscio fills in what it already knows.
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { classLabel, sectionLabel } from '@/lib/types';
import { ErrorBox, Field, Loading, Panel } from './ui';

type Kind = 'tc' | 'bonafide' | 'character';
interface Prefill {
  student: { name: string; status: string; className: string | null; sectionName: string | null; gender: string | null };
  known: { duesPending: string; attendance: { days: number; present: number }; nextClass: string | null; inFinalClass: boolean };
  settings: { kind: Kind; signMode: 'printed' | 'hand'; signerRole: 'principal' | 'owner' }[];
  issued: { id: string; kind: Kind; serialNo: string; issuedAt: string; issuedBy: string | null; documentId: string | null }[];
}
const TITLES: Record<Kind, string> = { tc: 'Transfer certificate', bonafide: 'Bonafide certificate', character: 'Character certificate' };
const REASONS = ["Parent's transfer", 'Moving to another school', 'Family moving to another place', 'Completed the last class of this school', 'Other'];
const PURPOSES = ['opening a bank account', 'a scholarship application', 'a passport application', 'Aadhaar enrolment or update', 'Other'];
const CONDUCT = ['Excellent', 'Very good', 'Good', 'Satisfactory'];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export function IssueCertificate({ studentId, open, onClose, onIssued }: {
  studentId: string; open: boolean; onClose: () => void; onIssued: (documentId: string, serialNo: string) => void;
}) {
  const [p, setP] = useState<Prefill | null>(null);
  const [kind, setKind] = useState<Kind>('tc');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // TC
  const [tc, setTc] = useState({
    applicationDate: today(), leavingDate: today(), reason: REASONS[0]!, reasonOther: '', promotion: 'na' as 'yes' | 'no' | 'na',
    promotedTo: '', conduct: 'Good', workingDays: '', presentDays: '', subjects: '', remarks: '', markLeft: true,
  });
  const [purpose, setPurpose] = useState(PURPOSES[0]!);
  const [purposeOther, setPurposeOther] = useState('');
  const [includePhoto, setIncludePhoto] = useState(true);
  const [conduct, setConduct] = useState('Good');
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr(null);
    api.get<Prefill>(`/students/${studentId}/certificates`).then((r) => {
      setP(r);
      if (r.student.status !== 'active') setKind('character');
      setTc((t) => ({
        ...t, promotedTo: r.known.nextClass ?? '', promotion: r.known.inFinalClass ? 'na' : t.promotion,
        reason: r.known.inFinalClass ? 'Completed the last class of this school' : t.reason,
        workingDays: String(r.known.attendance.days), presentDays: String(r.known.attendance.present),
      }));
    }).catch((e) => setErr(e.message));
  }, [open, studentId]);

  const earlierTc = p?.issued.find((i) => i.kind === 'tc');
  const setting = p?.settings.find((s) => s.kind === kind);
  const who = setting?.signerRole === 'owner' ? 'the director' : 'the principal';
  const disabledReason = kind === 'bonafide' && p && p.student.status !== 'active' ? 'A bonafide certificate is only for students studying here now.' : null;

  const submit = async (e?: FormEvent, reissue = false) => {
    e?.preventDefault();
    setBusy(true); setErr(null);
    try {
      const details = kind === 'tc' ? {
        applicationDate: tc.applicationDate, leavingDate: tc.leavingDate,
        reason: tc.reason === 'Other' ? tc.reasonOther : tc.reason, completed: tc.reason.startsWith('Completed'),
        promotion: tc.promotion, promotedTo: tc.promotion === 'yes' ? tc.promotedTo || null : null, conduct: tc.conduct,
        workingDays: tc.workingDays ? Number(tc.workingDays) : null, presentDays: tc.presentDays ? Number(tc.presentDays) : null,
        subjects: tc.subjects || null, remarks: tc.remarks || null, markLeft: tc.markLeft,
      } : kind === 'bonafide'
        ? { purpose: purpose === 'Other' ? purposeOther : purpose, includePhoto }
        : { conduct, remarks: remarks || null };
      const r = await api.post<{ documentId: string; serialNo: string }>(`/students/${studentId}/certificates`, { kind, details, reissue });
      onIssued(r.documentId, r.serialNo);
    } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not make the certificate'); }
    finally { setBusy(false); }
  };

  const footer = (
    <>
      <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
      {kind === 'tc' && earlierTc
        ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit(undefined, true)}>{busy ? 'Making…' : 'Issue a duplicate copy'}</button>
        : <button type="submit" form="cert-form" className="btn btn-primary" disabled={busy || !!disabledReason}>{busy ? 'Making…' : `Issue ${TITLES[kind].toLowerCase()}`}</button>}
    </>
  );

  return (
    <Panel open={open} title="Issue a certificate" onClose={onClose} footer={footer}>
      {!p ? (err ? <ErrorBox error={err} /> : <Loading />) : (
        <form id="cert-form" className="stack" onSubmit={submit}>
          <div className="seg" role="radiogroup" aria-label="Certificate">
            {(['tc', 'bonafide', 'character'] as Kind[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setErr(null); }}>
                {TITLES[k].replace(' certificate', '')}
              </button>
            ))}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            For <strong>{p.student.name}</strong>{p.student.className ? `, ${sectionLabel(p.student.className, p.student.sectionName ?? '')}` : ''}.{' '}
            {setting?.signMode === 'printed' ? `It will carry the printed signature of ${who}.` : `Print it and ${who} signs by hand.`}
          </p>
          <ErrorBox error={err ?? disabledReason} />

          {kind === 'tc' ? (
            <>
              {earlierTc ? (
                <div className="note">A transfer certificate ({earlierTc.serialNo}) was already issued on {new Date(earlierTc.issuedAt).toLocaleDateString('en-IN')}.
                  You can issue a duplicate copy; it will say “Duplicate copy” and get a new serial number.</div>
              ) : null}
              {Number(p.known.duesPending) > 0 ? (
                <div className="note note-warn">₹{Number(p.known.duesPending).toLocaleString('en-IN')} of fees is still due. The certificate will say “No” for dues paid.</div>
              ) : null}
              <div className="grid-2">
                <Field label="Date of application" htmlFor="ad"><input id="ad" type="date" className="input" required value={tc.applicationDate} onChange={(e) => setTc({ ...tc, applicationDate: e.target.value })} /></Field>
                <Field label="Date of leaving" htmlFor="ld"><input id="ld" type="date" className="input" required value={tc.leavingDate} onChange={(e) => setTc({ ...tc, leavingDate: e.target.value })} /></Field>
              </div>
              <Field label="Reason for leaving" htmlFor="rs">
                <select id="rs" className="input" value={tc.reason} onChange={(e) => setTc({ ...tc, reason: e.target.value })}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
              </Field>
              {tc.reason === 'Other' ? <Field label="Reason, in a few words" htmlFor="ro"><input id="ro" className="input" required value={tc.reasonOther} onChange={(e) => setTc({ ...tc, reasonOther: e.target.value })} /></Field> : null}
              <div className="grid-2">
                <Field label="Qualified for promotion?" htmlFor="pr">
                  <select id="pr" className="input" value={tc.promotion} onChange={(e) => setTc({ ...tc, promotion: e.target.value as 'yes' | 'no' | 'na' })}>
                    <option value="yes">Yes</option><option value="no">No</option><option value="na">Not applicable (left mid-year)</option>
                  </select>
                </Field>
                {tc.promotion === 'yes' ? <Field label="To which class" htmlFor="pt"><input id="pt" className="input" value={tc.promotedTo} onChange={(e) => setTc({ ...tc, promotedTo: e.target.value })} /></Field> : null}
              </div>
              <div className="grid-3">
                <Field label="Conduct" htmlFor="cd"><select id="cd" className="input" value={tc.conduct} onChange={(e) => setTc({ ...tc, conduct: e.target.value })}>{CONDUCT.map((c) => <option key={c}>{c}</option>)}</select></Field>
                <Field label="Working days" htmlFor="wd" hint="From attendance"><input id="wd" className="input num" inputMode="numeric" value={tc.workingDays} onChange={(e) => setTc({ ...tc, workingDays: e.target.value.replace(/\D/g, '') })} /></Field>
                <Field label="Days present" htmlFor="pd"><input id="pd" className="input num" inputMode="numeric" value={tc.presentDays} onChange={(e) => setTc({ ...tc, presentDays: e.target.value.replace(/\D/g, '') })} /></Field>
              </div>
              <Field label="Subjects studied" htmlFor="sb" hint="Optional"><input id="sb" className="input" value={tc.subjects} onChange={(e) => setTc({ ...tc, subjects: e.target.value })} /></Field>
              <Field label="Other remarks" htmlFor="rm" hint="Optional"><input id="rm" className="input" value={tc.remarks} onChange={(e) => setTc({ ...tc, remarks: e.target.value })} /></Field>
              {!earlierTc ? (
                <label className="check"><input type="checkbox" checked={tc.markLeft} onChange={(e) => setTc({ ...tc, markLeft: e.target.checked })} />
                  Mark {p.student.name} as left from the leaving date (removes them from attendance lists)</label>
              ) : null}
            </>
          ) : kind === 'bonafide' ? (
            <>
              <Field label="Needed for" htmlFor="pu">
                <select id="pu" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>{PURPOSES.map((x) => <option key={x}>{x === 'Other' ? x : x[0]!.toUpperCase() + x.slice(1)}</option>)}</select>
              </Field>
              {purpose === 'Other' ? <Field label="Purpose" htmlFor="po"><input id="po" className="input" required placeholder="e.g. a sports trial" value={purposeOther} onChange={(e) => setPurposeOther(e.target.value)} /></Field> : null}
              <label className="check"><input type="checkbox" checked={includePhoto} onChange={(e) => setIncludePhoto(e.target.checked)} /> Print the student’s photo on it</label>
            </>
          ) : (
            <>
              <Field label="Conduct and character" htmlFor="cc"><select id="cc" className="input" value={conduct} onChange={(e) => setConduct(e.target.value)}>{CONDUCT.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Anything to add" htmlFor="cr" hint="Optional, e.g. “He was the school sports captain.”"><input id="cr" className="input" maxLength={200} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
            </>
          )}
          <p className="small muted" style={{ margin: 0 }}>It gets a serial number and is saved in the student file, so it can be printed again any time.</p>
        </form>
      )}
    </Panel>
  );
}
