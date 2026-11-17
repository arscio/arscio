'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { StudentFile } from '@/components/StudentFile';
import { StudentTabs } from '@/components/StudentTabs';

export default function StudentFilePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <div className="page-head">
        <div><Link href="/students" className="small">Students</Link><h1 style={{ marginTop: 4 }}>Student file</h1></div>
      </div>
      <StudentTabs id={id} />
      <StudentFile studentId={id} />
    </>
  );
}
