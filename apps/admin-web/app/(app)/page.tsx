'use client';
// Home: the principal's dashboard for owners and principals; the setup checklist for office staff.
import { useSchool } from '@/components/AppShell';
import { Dashboard } from '@/components/Dashboard';
import { SetupChecklist } from '@/components/SetupChecklist';

export default function Home() {
  const { can } = useSchool();
  return can('dashboard.view') ? <Dashboard /> : <SetupChecklist />;
}
