'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSchool } from './AppShell';

export function FeesTabs() {
  const { can } = useSchool();
  const path = usePathname();
  const tabs = [
    { href: '/fees', label: 'Collect fees', show: can('fees.collect') },
    { href: '/fees/daybook', label: 'Day book', show: can('fees.collect') || can('fees.view_reports') },
    { href: '/fees/defaulters', label: 'Defaulters', show: can('fees.collect') || can('fees.view_reports') },
    { href: '/fees/setup', label: 'Fee setup', show: can('fees.manage_structure') },
  ].filter((t) => t.show);
  return (
    <nav className="tabs no-print" aria-label="Fees">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? 'page' : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}

export const inr = (v: string | number) => {
  const [r = '0', p = '00'] = Number(v).toFixed(2).split('.');
  const last3 = r.slice(-3), rest = r.slice(0, -3);
  const whole = `${rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : ''}${last3}`;
  return `₹${whole}${p === '00' ? '' : `.${p}`}`;
};
export const niceDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const MODES: Record<string, string> = { cash: 'Cash', upi: 'UPI', cheque: 'Cheque', bank_transfer: 'Bank transfer', card: 'Card', online: 'Online' };
