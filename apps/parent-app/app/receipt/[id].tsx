// A receipt, as the school issued it (school's own name and logo).
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { rupeesInWords } from '@arscio/shared';
import { call } from '@/lib/api';
import { useParent } from '@/lib/auth';
import { C, classLabel } from '@/lib/theme';
import { Card, Loading, T } from '@/components/ui';
import { SchoolLogo } from '@/components/School';
import { rupees, shortDate } from '../index';

interface Receipt {
  receiptNo: string; paidOn: string; total: string; mode: string; reference: string | null; status: string;
  cancelReason: string | null; collectedBy: string; yearName: string;
  student: { name: string; admissionNo: string; className: string | null; sectionName: string | null };
  school: { name: string; address: string | null; affiliationNo: string | null; board: string; brandColor: string | null };
  lines: { description: string; amount: string; fine: string }[];
}
const MODES: Record<string, string> = { cash: 'Cash', upi: 'UPI', cheque: 'Cheque', bank_transfer: 'Bank transfer', card: 'Card', online: 'Online' };

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { child, accent } = useParent();
  const [r, setR] = useState<Receipt | null>(null);
  useEffect(() => {
    if (child) call<Receipt>('GET', `/fees/receipts/${id}`, undefined, { schoolId: child.schoolId }).then(setR);
  }, [id, child]);
  if (!r || !child) return <Loading />;
  const fines = r.lines.reduce((a, l) => a + Number(l.fine), 0);
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Card style={{ gap: 12, borderTopWidth: 4, borderTopColor: accent }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <SchoolLogo child={child} size={48} />
          <View style={{ flex: 1 }}>
            <T display size={17}>{r.school.name}</T>
            {r.school.address ? <T soft size={12}>{r.school.address}</T> : null}
            {r.school.affiliationNo ? <T soft size={12}>{r.school.board} Affiliation No. {r.school.affiliationNo}</T> : null}
          </View>
        </View>
        {r.status === 'cancelled' ? (
          <View style={{ backgroundColor: C.redWash, padding: 10, borderRadius: 6 }}>
            <T bold style={{ color: C.red }}>This receipt was cancelled by the school.</T>
            {r.cancelReason ? <T size={14} style={{ color: C.red }}>Reason: {r.cancelReason}</T> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T bold>Fee receipt</T><T soft size={14}>{shortDate(r.paidOn)}</T>
        </View>
        <T size={14}>No. {r.receiptNo}{'\n'}{r.student.name}, {r.student.className ? `${classLabel(r.student.className)} ${r.student.sectionName}` : ''}{'\n'}Admission no. {r.student.admissionNo}, session {r.yearName}</T>
        <View style={{ borderTopWidth: 1, borderColor: C.rule, paddingTop: 8, gap: 6 }}>
          {r.lines.map((l, i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
              <T size={14} style={{ flexShrink: 1 }}>{l.description}</T><T size={14}>{rupees(l.amount)}</T>
            </View>
          ))}
          {fines > 0 ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T size={14}>Late fine</T><T size={14}>{rupees(fines)}</T></View> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderColor: C.rule, paddingTop: 8 }}>
            <T bold>Total</T><T bold>{rupees(r.total)}</T>
          </View>
        </View>
        <T soft size={13}>{rupeesInWords(r.total)}. Paid by {MODES[r.mode]}{r.reference ? ` (${r.reference})` : ''}. Collected by {r.collectedBy}.</T>
        <T soft size={11} style={{ textAlign: 'center' }}>Powered by Arscio</T>
      </Card>
    </ScrollView>
  );
}
