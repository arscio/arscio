'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/api';
import { classLabel, type Structure, type Subject } from '@/lib/types';
import { ErrorBox, Field, Loading, Panel, useToast } from '@/components/ui';

const CBSE_STARTERS = ['English', 'Hindi', 'Assamese', 'Mathematics', 'Environmental Studies', 'Science',
  'Social Science', 'Computer', 'General Knowledge', 'Drawing', 'Physical Education'];

export default function SubjectsPage() {
  const [data, setData] = useState<Structure | null>(null);
  const [editing, setEditing] = useState<Subject | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => setData(await api.get<Structure>('/setup/structure')), []);
  useEffect(() => { void load(); }, [load]);
  if (!data) return <Loading />;

  const usedIn = (id: string) => data.classes.filter((c) => c.subject_ids.includes(id)).map((c) => classLabel(c.name));
  const existing = new Set(data.subjects.map((s) => s.name.toLowerCase()));
  const starters = CBSE_STARTERS.filter((n) => !existing.has(n.toLowerCase()));

  const addStarter = async (name: string) => {
    setError(null);
    try { await api.post('/subjects', { name }); await load(); toast.show(`${name} added`); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not add'); }
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Subjects</h1><p>Every subject taught in the school. Then choose which ones each class studies on the Classes page.</p></div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>Add subject</button>
      </div>
      <ErrorBox error={error} />

      {starters.length ? (
        <div className="sheet sheet-pad stack" style={{ marginBottom: 18, gap: 10 }}>
          <div><strong>Common subjects</strong> <span className="muted small">Click to add.</span></div>
          <div className="checks">{starters.map((n) => (
            <button key={n} className="check" onClick={() => addStarter(n)}>+ {n}</button>
          ))}</div>
        </div>
      ) : null}

      <div className="sheet table-wrap">
        {data.subjects.length === 0 ? (
          <div className="empty"><h3>No subjects yet</h3><p>Add the common ones above, or your own.</p></div>
        ) : (
          <table className="register">
            <thead><tr><th>Code</th><th>Subject</th><th>Taught in</th><th></th></tr></thead>
            <tbody>{data.subjects.map((s) => {
              const used = usedIn(s.id);
              return (
                <tr key={s.id}>
                  <td className="muted">{s.code ?? '-'}</td>
                  <td><strong>{s.name}</strong></td>
                  <td className="small">{used.length ? used.join(', ') : <span className="muted">Not chosen for any class yet</span>}</td>
                  <td className="actions"><button className="btn btn-plain" onClick={() => setEditing(s)}>Edit</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>

      <Panel open={editing !== null} title={editing === 'new' ? 'Add subject' : 'Edit subject'} onClose={() => setEditing(null)}>
        {editing !== null ? (
          <SubjectForm subject={editing === 'new' ? null : editing}
            onDone={async (msg) => { setEditing(null); await load(); toast.show(msg); }} />
        ) : null}
      </Panel>
      {toast.node}
    </>
  );
}

function SubjectForm({ subject, onDone }: { subject: Subject | null; onDone: (msg: string) => Promise<void> }) {
  const [name, setName] = useState(subject?.name ?? '');
  const [code, setCode] = useState(subject?.code ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      if (subject) await api.patch(`/subjects/${subject.id}`, { name, code });
      else await api.post('/subjects', { name, code });
      await onDone(subject ? 'Subject saved' : `${name} added`);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!subject || !confirm(`Remove ${subject.name}?`)) return;
    setBusy(true); setError(null);
    try { await api.del(`/subjects/${subject.id}`); await onDone(`${subject.name} removed`); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not remove'); }
    finally { setBusy(false); }
  };

  return (
    <form className="stack" onSubmit={save}>
      <Field label="Subject name" htmlFor="sn">
        <input id="sn" className="input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Short code" htmlFor="sc" hint="Optional, for example ENG. Used where space is tight.">
        <input id="sc" className="input" style={{ width: 140 }} maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <ErrorBox error={error} />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-primary" disabled={busy || !name.trim()}>{subject ? 'Save subject' : 'Add subject'}</button>
        {subject ? <button type="button" className="btn btn-danger" disabled={busy} onClick={remove}>Remove subject</button> : null}
      </div>
    </form>
  );
}
