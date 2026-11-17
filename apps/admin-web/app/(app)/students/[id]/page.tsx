'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { showPhone } from '@/lib/types';
import { StudentForm, toPayload, type StudentValues } from '@/components/StudentForm';
import { useSchool } from '@/components/AppShell';
import { Loading, useToast } from '@/components/ui';
import { StudentTabs } from '@/components/StudentTabs';
import { photoSrc } from '@/lib/api';

interface Detail {
  id: string; admissionNo: string; firstName: string; lastName: string | null; dateOfBirth: string | null;
  gender: string | null; bloodGroup: string | null; admissionDate: string | null; status: string;
  sectionId: string | null; rollNo: number | null; photoUrl: string | null;
  family: { phone: string; fatherName: string | null; motherName: string | null; guardianName: string | null; altPhone: string | null; address: string | null };
  siblings: { id: string; name: string }[] | null;
}

export default function StudentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useSchool();
  const [d, setD] = useState<Detail | null>(null);
  const [version, setVersion] = useState(0);
  const toast = useToast();

  useEffect(() => { api.get<Detail>(`/students/${id}`).then(setD); }, [id, version]);
  if (!d) return <Loading />;

  const s = (x: string | null) => x ?? '';
  const initial: StudentValues = {
    admissionNo: d.admissionNo, firstName: d.firstName, lastName: s(d.lastName), dateOfBirth: s(d.dateOfBirth),
    gender: s(d.gender), bloodGroup: s(d.bloodGroup), admissionDate: s(d.admissionDate),
    sectionId: s(d.sectionId), rollNo: d.rollNo ? String(d.rollNo) : '', status: d.status,
    family: {
      phone: showPhone(d.family.phone), fatherName: s(d.family.fatherName), motherName: s(d.family.motherName),
      guardianName: s(d.family.guardianName), altPhone: s(d.family.altPhone), address: s(d.family.address),
    },
  };

  return (
    <>
      <div className="page-head">
        <div className="row" style={{ gap: 16 }}>
          <div className="photo-round photo-sm" aria-hidden>
            {d.photoUrl ? <img src={photoSrc(d.photoUrl)!} alt="" /> : <span>{`${d.firstName[0] ?? ''}${d.lastName?.[0] ?? ''}`.toUpperCase()}</span>}
          </div>
          <div>
          <Link href="/students" className="small">Students</Link>
          <h1 style={{ marginTop: 4 }}>{d.firstName} {d.lastName ?? ''}</h1>
          {d.siblings?.length ? (
            <p>Brothers and sisters: {d.siblings.map((x, i) => (
              <span key={x.id}>{i ? ', ' : ''}<Link href={`/students/${x.id}`}>{x.name.trim()}</Link></span>
            ))}</p>
          ) : null}
          </div>
        </div>
      </div>
      <StudentTabs id={id} />
      {can('students.manage') ? (
        <StudentForm key={version} initial={initial} editing submitLabel="Save changes"
          onSubmit={async (v) => {
            await api.patch(`/students/${id}`, toPayload(v, true));
            toast.show('Saved');
            setVersion((x) => x + 1);
            router.refresh();
          }} />
      ) : (
        <div className="sheet sheet-pad"><p>Admission no. {d.admissionNo}. Family phone {showPhone(d.family.phone)}.</p></div>
      )}
      {toast.node}
    </>
  );
}
