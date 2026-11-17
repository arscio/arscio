'use client';
// Classes & sections for the current year, each section's class teacher,
// subjects per class, and how the class is assessed on report cards.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { classLabel, sectionLabel, type ClassRow, type StaffMember, type Structure, type StudentRow } from '@/lib/types';
import { useSchool } from '@/components/AppShell';
import { ErrorBox, Field, Loading, Panel, useToast } from '@/components/ui';

const STYLE_LABEL = { grades_only: 'Grades and comments', marks_and_grades: 'Marks and grades' };

type Sheet = { kind: 'edit'; classId: string } | { kind: 'split'; classId: string; fromId: string } | { kind: 'move'; classId: string };

/** "Whole class" for a class's only section, otherwise "Section B". */
const sectionWord = (name: string) => (name ? `Section ${name}` : 'Whole class');
/** The letters the class will have after adding one more section. */
function lettersAfterAdding(cls: ClassRow) {
  const used = cls.sections.map((s) => s.name).filter(Boolean);
  const renamed = cls.sections.some((s) => !s.name);
  const all = renamed ? ['A', ...used] : used;
  let next = 'A';
  for (let i = 0; i < 26; i++) { const l = String.fromCharCode(65 + i); if (!all.includes(l)) { next = l; break; } }
  return { first: renamed ? 'A' : null, next };
}

export default function ClassesPage() {
  const { can } = useSchool();
  const edit = can('school.settings');
  const [data, setData] = useState<Structure | null>(null);
  const [teachers, setTeachers] = useState<StaffMember[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    const [s, st] = await Promise.all([api.get<Structure>('/setup/structure'), api.get<{ staff: StaffMember[] }>('/staff')]);
    setData(s);
    setTeachers(st.staff.filter((m) => m.status === 'active' && m.roles.includes('teacher')));
    return s;
  }, []);
  useEffect(() => {
    void load().then((s) => {
      // Arriving from the home screen notice ("Class 6 has 54 students for 50 seats")
      const want = new URLSearchParams(window.location.search).get('seats');
      const alert = want ? s.seatAlerts?.find((a) => a.classId === want) : undefined;
      if (alert && edit) setSheet({ kind: 'split', classId: alert.classId, fromId: alert.sectionId });
    });
  }, [load, edit]);

  if (!data) return <Loading />;
  const subjectName = new Map(data.subjects.map((s) => [s.id, s.name]));
  const cls = sheet ? data.classes.find((c) => c.id === sheet.classId) ?? null : null;
  const alerts = data.seatAlerts ?? [];
  const done = async (msg: string, next: Sheet | null = null) => { await load(); setSheet(next); toast.show(msg); };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Classes & sections</h1>
          <p>Academic year {data.year.name}. A class starts as one group. When it has more students than seats,
            make another section and choose who moves there.</p>
        </div>
      </div>

      {edit && alerts.length ? (
        <div className="seat-alerts">
          {alerts.map((a) => (
            <div key={a.sectionId} className="seat-alert">
              <p><strong>{a.label}</strong> has {a.students} students for {a.seats} seats.</p>
              <div className="row">
                <button className="btn btn-quiet" onClick={async () => {
                  try { await api.post(`/sections/${a.sectionId}/keep`); await done(`${a.label} kept as it is`); }
                  catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
                }}>Keep as it is</button>
                <button className="btn btn-primary" onClick={() => setSheet({ kind: 'split', classId: a.classId, fromId: a.sectionId })}>
                  Make another section</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <ErrorBox error={error} />

      <div className="sheet table-wrap">
        <table className="register">
          <thead><tr><th>Class</th><th>Sections and seats</th><th>Report card</th><th>Subjects</th><th></th></tr></thead>
          <tbody>
            {data.classes.map((c) => (
              <tr key={c.id}>
                <td><strong>{classLabel(c.name)}</strong></td>
                <td>
                  {c.sections.length === 0 ? <span className="muted small">Not started this year</span> : c.sections.map((s) => {
                    const over = s.seats != null && s.students > s.seats;
                    return (
                      <span key={s.id} className="chip-section" title={s.classTeacherName ? `Class teacher: ${s.classTeacherName}` : 'No class teacher yet'}>
                        {s.name ? <b>{s.name}</b> : null}
                        <span className={`small num ${over ? 'over' : 'muted'}`}>
                          {s.students}{s.seats != null ? ` of ${s.seats} seats` : s.students === 1 ? ' student' : ' students'}
                        </span>
                        {s.classTeacherName ? <span className="small">{s.classTeacherName}</span>
                          : <span className="tag tag-warn" style={{ margin: 0 }}>No class teacher</span>}
                      </span>
                    );
                  })}
                </td>
                <td className="small">{STYLE_LABEL[c.assessment_style]}</td>
                <td className="small">{c.subject_ids.length ? c.subject_ids.map((id) => subjectName.get(id)).join(', ') : <span className="muted">None chosen</span>}</td>
                <td className="actions">{edit ? <button className="btn btn-plain" onClick={() => setSheet({ kind: 'edit', classId: c.id })}>Edit</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Panel open={!!cls && sheet?.kind === 'edit'} title={cls ? classLabel(cls.name) : ''} onClose={() => setSheet((x) => (x?.kind === 'edit' ? null : x))}>
        {cls && sheet?.kind === 'edit' ? (
          <ClassEditor key={cls.id} cls={cls} data={data} teachers={teachers}
            onChanged={async (msg) => { await load(); toast.show(msg); }}
            onSplit={(fromId) => setSheet({ kind: 'split', classId: cls.id, fromId })}
            onMove={() => setSheet({ kind: 'move', classId: cls.id })} />
        ) : null}
      </Panel>
      <Panel open={!!cls && sheet?.kind === 'split'} title={cls ? `New section for ${classLabel(cls.name)}` : ''} onClose={() => setSheet((x) => (x?.kind === 'split' ? null : x))}>
        {cls && sheet?.kind === 'split' ? (
          <SplitClass key={`${cls.id}-split`} cls={cls} fromId={sheet.fromId}
            onDone={(msg) => done(msg, { kind: 'edit', classId: cls.id })} />
        ) : null}
      </Panel>
      <Panel open={!!cls && sheet?.kind === 'move'} title={cls ? `Move students in ${classLabel(cls.name)}` : ''} onClose={() => setSheet((x) => (x?.kind === 'move' ? null : x))}>
        {cls && sheet?.kind === 'move' ? (
          <MoveStudents key={`${cls.id}-move`} cls={cls} onDone={(msg) => done(msg, { kind: 'edit', classId: cls.id })} />
        ) : null}
      </Panel>
      {toast.node}
    </>
  );
}

function ClassEditor({ cls, data, teachers, onChanged, onSplit, onMove }: {
  cls: ClassRow; data: Structure; teachers: StaffMember[]; onChanged: (msg: string) => Promise<void>;
  onSplit: (fromId: string) => void; onMove: () => void;
}) {
  const [subjects, setSubjects] = useState<string[]>(cls.subject_ids);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true); setError(null);
    try { await fn(); await onChanged(msg); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };
  const name = classLabel(cls.name);
  const biggest = [...cls.sections].sort((a, b) => b.students - a.students)[0];

  return (
    <div className="stack" style={{ gap: 26 }}>
      <ErrorBox error={error} />

      <section className="stack">
        <h3>Sections and seats</h3>
        {cls.sections.length === 0 ? (
          <div className="stack">
            <p className="muted small">{name} has not started this year. Start it as one group; you can split it into sections later.</p>
            <div><button className="btn btn-primary" disabled={busy}
              onClick={() => run(() => api.post('/sections', { classId: cls.id }), `${name} started`)}>Start {name}</button></div>
          </div>
        ) : (
          <table className="register" style={{ border: '1px solid var(--rule)' }}>
            <thead><tr><th>Section</th><th>Seats</th><th>Class teacher</th><th></th></tr></thead>
            <tbody>
              {cls.sections.map((s) => {
                const over = s.seats != null && s.students > s.seats;
                return (
                  <tr key={s.id}>
                    <td>
                      <strong>{sectionWord(s.name)}</strong>
                      <div className={`small num ${over ? 'over' : 'muted'}`}>{s.students} {s.students === 1 ? 'student' : 'students'}{over ? `, ${s.students - s.seats!} over` : ''}</div>
                    </td>
                    <td>
                      <input className="input num" type="number" min={1} max={500} style={{ width: 90 }}
                        aria-label={`Seats in ${sectionLabel(cls.name, s.name)}`} placeholder="No limit"
                        defaultValue={s.seats ?? ''} disabled={busy}
                        onBlur={(e) => {
                          const v = e.target.value.trim() === '' ? null : Number(e.target.value);
                          if (v === (s.seats ?? null)) return;
                          void run(() => api.patch(`/sections/${s.id}`, { seats: v }), `Seats for ${sectionLabel(cls.name, s.name)} saved`);
                        }} />
                    </td>
                    <td>
                      <select className="input" aria-label={`Class teacher for ${sectionLabel(cls.name, s.name)}`} value={s.classTeacherId ?? ''} disabled={busy}
                        onChange={(e) => run(() => api.patch(`/sections/${s.id}`, { classTeacherId: e.target.value || null }),
                          `Class teacher for ${sectionLabel(cls.name, s.name)} saved`)}>
                        <option value="">Not chosen</option>
                        {teachers.map((t) => <option key={t.membershipId} value={t.membershipId}>{t.name}</option>)}
                      </select>
                    </td>
                    <td className="actions">
                      {s.students === 0 ? (
                        <button className="btn btn-quiet" disabled={busy}
                          onClick={() => confirm(cls.sections.length > 1 ? `Remove section ${s.name}?` : `Stop ${name} for this year?`)
                            && run(() => api.del(`/sections/${s.id}`), cls.sections.length > 1 ? `Section ${s.name} removed` : `${name} stopped`)}>
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {cls.sections.length ? (
          <p className="small muted">Seats is how many students one room takes. Admission is never stopped:
            when a section goes over, you are asked whether to keep it or make another section.</p>
        ) : null}
        {teachers.length === 0 ? <p className="small muted">To choose class teachers, first add teachers on the Staff & roles page.</p> : null}
        {cls.sections.length ? (
          <div className="row">
            {biggest && biggest.students > 0
              ? <button className="btn btn-plain" disabled={busy} onClick={() => onSplit(biggest.id)}>Make another section</button>
              : <button className="btn btn-plain" disabled={busy}
                  onClick={() => run(() => api.post('/sections', { classId: cls.id }), 'Section added')}>Add another section</button>}
            {cls.sections.length > 1 ? <button className="btn btn-plain" disabled={busy} onClick={onMove}>Move students between sections</button> : null}
          </div>
        ) : null}
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

const fullName = (s: StudentRow) => `${s.firstName}${s.lastName ? ` ${s.lastName}` : ''}`;
const byName = (a: StudentRow, b: StudentRow) => fullName(a).localeCompare(fullName(b));

/** Tick-list of a section's students, with quick choices. */
function PickStudents({ students, chosen, setChosen }: {
  students: StudentRow[]; chosen: Set<string>; setChosen: (s: Set<string>) => void;
}) {
  const sorted = [...students].sort(byName);
  const half = Math.floor(sorted.length / 2);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row small">
        <button type="button" className="btn btn-quiet" onClick={() => setChosen(new Set(sorted.slice(sorted.length - half).map((s) => s.id)))}>
          Choose second half by name ({half})</button>
        <button type="button" className="btn btn-quiet" onClick={() => setChosen(new Set())}>Clear</button>
      </div>
      <div className="pick-list" role="group" aria-label="Students">
        {sorted.map((s) => (
          <label key={s.id} className="check">
            <input type="checkbox" checked={chosen.has(s.id)} onChange={(e) => {
              const n = new Set(chosen); if (e.target.checked) n.add(s.id); else n.delete(s.id); setChosen(n);
            }} />
            <span>{fullName(s)}</span>
            <span className="small muted num">{s.admissionNo}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** Make a new section and choose who moves into it. */
function SplitClass({ cls, fromId, onDone }: { cls: ClassRow; fromId: string; onDone: (msg: string) => Promise<void> }) {
  const from = cls.sections.find((s) => s.id === fromId) ?? cls.sections[0]!;
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api.get<{ students: StudentRow[] }>(`/students?sectionId=${from.id}`).then((r) => setStudents(r.students));
  }, [from.id]);
  if (!students) return <Loading />;
  const { first, next } = lettersAfterAdding(cls);
  const name = classLabel(cls.name);
  const staysIn = first ? `${name} ${first}` : sectionLabel(cls.name, from.name);
  const goesTo = `${name} ${next}`;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <p>
        {first ? <>{name} becomes <strong>{staysIn}</strong>, and a new <strong>{goesTo}</strong> is made. </>
          : <>A new <strong>{goesTo}</strong> is made. </>}
        Tick the students who move to {goesTo}. Everyone else stays in {staysIn}.
        The new section starts with the same seats and subject teachers; choose its class teacher afterwards.
      </p>
      <ErrorBox error={error} />
      <PickStudents students={students} chosen={chosen} setChosen={setChosen} />
      <div className="split-sum num">
        <span>Staying in {staysIn}: <strong>{students.length - chosen.size}</strong>{from.seats ? ` of ${from.seats} seats` : ''}</span>
        <span>Moving to {goesTo}: <strong>{chosen.size}</strong></span>
      </div>
      <div><button className="btn btn-primary" disabled={busy || chosen.size === 0} onClick={async () => {
        setBusy(true); setError(null);
        try {
          await api.post(`/classes/${cls.id}/split`, { studentIds: [...chosen] });
          await onDone(`${goesTo} made with ${chosen.size} students. Choose its class teacher.`);
        } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); setBusy(false); }
      }}>Make {goesTo} and move {chosen.size} {chosen.size === 1 ? 'student' : 'students'}</button></div>
      <p className="small muted">Past attendance and marks stay as they are. Roll numbers of moved students are cleared, so give them new ones.</p>
    </div>
  );
}

/** Move students from one section of the class to another. */
function MoveStudents({ cls, onDone }: { cls: ClassRow; onDone: (msg: string) => Promise<void> }) {
  const [fromId, setFromId] = useState(cls.sections[0]!.id);
  const [toId, setToId] = useState(cls.sections[1]?.id ?? '');
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setStudents(null); setChosen(new Set());
    void api.get<{ students: StudentRow[] }>(`/students?sectionId=${fromId}`).then((r) => setStudents(r.students));
  }, [fromId]);
  const label = (id: string) => { const s = cls.sections.find((x) => x.id === id); return s ? sectionLabel(cls.name, s.name) : ''; };
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row">
        <Field label="From">
          <select className="input" value={fromId} onChange={(e) => { setFromId(e.target.value); if (e.target.value === toId) setToId(cls.sections.find((s) => s.id !== e.target.value)!.id); }}>
            {cls.sections.map((s) => <option key={s.id} value={s.id}>{sectionLabel(cls.name, s.name)} ({s.students})</option>)}
          </select>
        </Field>
        <Field label="To">
          <select className="input" value={toId} onChange={(e) => setToId(e.target.value)}>
            {cls.sections.filter((s) => s.id !== fromId).map((s) => <option key={s.id} value={s.id}>{sectionLabel(cls.name, s.name)} ({s.students})</option>)}
          </select>
        </Field>
      </div>
      <ErrorBox error={error} />
      {students ? <PickStudents students={students} chosen={chosen} setChosen={setChosen} /> : <Loading />}
      <div><button className="btn btn-primary" disabled={busy || chosen.size === 0} onClick={async () => {
        setBusy(true); setError(null);
        try {
          await api.post('/students/move', { studentIds: [...chosen], toSectionId: toId });
          await onDone(`${chosen.size} ${chosen.size === 1 ? 'student' : 'students'} moved to ${label(toId)}`);
        } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save'); setBusy(false); }
      }}>Move {chosen.size} to {label(toId)}</button></div>
    </div>
  );
}
