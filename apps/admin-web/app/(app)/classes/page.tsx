'use client';
// Classes & sections for the current year, each section's class teacher,
// subjects per class, and how the class is assessed on report cards.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { classLabel, type ClassRow, type StaffMember, type Structure } from '@/lib/types';
import { useSchool } from '@/components/AppShell';
import { ErrorBox, Field, Loading, Panel, useToast } from '@/components/ui';

const STYLE_LABEL = { grades_only: 'Grades and comments', marks_and_grades: 'Marks and grades' };

export default function ClassesPage() {
  const { can } = useSchool();
  const edit = can('school.settings');
  const [data, setData] = useState<Structure | null>(null);
  const [teachers, setTeachers] = useState<StaffMember[]>([]);
  const [open, setOpen] = useState<ClassRow | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    const [s, st] = await Promise.all([api.get<Structure>('/setup/structure'), api.get<{ staff: StaffMember[] }>('/staff')]);
    setData(s);
    setTeachers(st.staff.filter((m) => m.status === 'active' && m.roles.includes('teacher')));
    return s;
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!data) return <Loading />;
  const subjectName = new Map(data.subjects.map((s) => [s.id, s.name]));
  const current = open ? data.classes.find((c) => c.id === open.id) ?? null : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Classes & sections</h1>
          <p>Academic year {data.year.name}. Add the sections each class has, and choose who is the class teacher.</p>
        </div>
      </div>

      <div className="sheet table-wrap">
        <table className="register">
          <thead><tr><th>Class</th><th>Sections</th><th>Report card</th><th>Subjects</th><th></th></tr></thead>
          <tbody>
            {data.classes.map((c) => (
              <tr key={c.id}>
                <td><strong>{classLabel(c.name)}</strong></td>
                <td>
                  {c.sections.length === 0 ? <span className="muted small">No sections yet</span> : c.sections.map((s) => (
                    <span key={s.id} className="chip-section" title={s.classTeacherName ? `Class teacher: ${s.classTeacherName}` : 'No class teacher yet'}>
                      <b>{s.name}</b>
                      <span className="small muted num">{s.students} {s.students === 1 ? 'student' : 'students'}</span>
                      {s.classTeacherName ? <span className="small">{s.classTeacherName}</span>
                        : <span className="tag tag-warn" style={{ margin: 0 }}>No class teacher</span>}
                    </span>
                  ))}
                </td>
                <td className="small">{STYLE_LABEL[c.assessment_style]}</td>
                <td className="small">{c.subject_ids.length ? c.subject_ids.map((id) => subjectName.get(id)).join(', ') : <span className="muted">None chosen</span>}</td>
                <td className="actions">{edit ? <button className="btn btn-plain" onClick={() => setOpen(c)}>Edit</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Panel open={!!current} title={current ? classLabel(current.name) : ''} onClose={() => setOpen(null)}>
        {current ? (
          <ClassEditor key={current.id} cls={current} data={data} teachers={teachers}
            onChanged={async (msg) => { await load(); toast.show(msg); }} />
        ) : null}
      </Panel>
      {toast.node}
    </>
  );
}

function ClassEditor({ cls, data, teachers, onChanged }: {
  cls: ClassRow; data: Structure; teachers: StaffMember[]; onChanged: (msg: string) => Promise<void>;
}) {
  const [newSection, setNewSection] = useState('');
  const [subjects, setSubjects] = useState<string[]>(cls.subject_ids);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true); setError(null);
    try { await fn(); await onChanged(msg); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };
  const nextLetter = String.fromCharCode(65 + cls.sections.length);

  return (
    <div className="stack" style={{ gap: 26 }}>
      <ErrorBox error={error} />

      <section className="stack">
        <h3>Sections</h3>
        {cls.sections.length === 0 ? <p className="muted small">No sections yet. Most classes start with section A.</p> : (
          <table className="register" style={{ border: '1px solid var(--rule)' }}>
            <thead><tr><th>Section</th><th>Class teacher</th><th></th></tr></thead>
            <tbody>
              {cls.sections.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong><div className="small muted num">{s.students} {s.students === 1 ? 'student' : 'students'}</div></td>
                  <td>
                    <select className="input" aria-label={`Class teacher for section ${s.name}`} value={s.classTeacherId ?? ''} disabled={busy}
                      onChange={(e) => run(() => api.patch(`/sections/${s.id}`, { classTeacherId: e.target.value || null }),
                        `Class teacher for ${classLabel(cls.name)} ${s.name} saved`)}>
                      <option value="">Not chosen</option>
                      {teachers.map((t) => <option key={t.membershipId} value={t.membershipId}>{t.name}</option>)}
                    </select>
                  </td>
                  <td className="actions">
                    {s.students === 0 ? (
                      <button className="btn btn-quiet" disabled={busy}
                        onClick={() => confirm(`Remove section ${s.name}?`) && run(() => api.del(`/sections/${s.id}`), `Section ${s.name} removed`)}>
                        Remove
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {teachers.length === 0 ? <p className="small muted">To choose class teachers, first add teachers on the Staff & roles page.</p> : null}
        <form className="row" onSubmit={(e) => {
          e.preventDefault();
          const name = newSection.trim() || nextLetter;
          void run(() => api.post('/sections', { classId: cls.id, name }), `Section ${name.toUpperCase()} added`).then(() => setNewSection(''));
        }}>
          <input className="input" style={{ width: 120 }} aria-label="New section name" placeholder={nextLetter}
            value={newSection} maxLength={20} onChange={(e) => setNewSection(e.target.value)} />
          <button className="btn btn-plain" disabled={busy}>Add section {newSection.trim().toUpperCase() || nextLetter}</button>
        </form>
      </section>

      <section className="stack">
        <h3>Subjects taught</h3>
        {data.subjects.length === 0 ? <p className="muted small">Add subjects on the Subjects page first.</p> : (
          <>
            <div className="checks">
              {data.subjects.map((s) => (
                <label key={s.id} className="check">
                  <input type="checkbox" checked={subjects.includes(s.id)}
                    onChange={(e) => setSubjects(e.target.checked ? [...subjects, s.id] : subjects.filter((x) => x !== s.id))} />
                  {s.name}
                </label>
              ))}
            </div>
            <div><button className="btn btn-primary" disabled={busy}
              onClick={() => run(() => api.put(`/classes/${cls.id}/subjects`, { subjectIds: subjects }), 'Subjects saved')}>
              Save subjects</button></div>
          </>
        )}
      </section>

      <section className="stack">
        <h3>Report card</h3>
        <Field label="How this class is assessed">
          <select className="input" value={cls.assessment_style} disabled={busy}
            onChange={(e) => run(() => api.patch(`/classes/${cls.id}`, { assessmentStyle: e.target.value }), 'Report card style saved')}>
            <option value="grades_only">Grades and comments (usual for Nursery to UKG)</option>
            <option value="marks_and_grades">Marks and grades (usual for Class 1 to 10)</option>
          </select>
        </Field>
      </section>
    </div>
  );
}
