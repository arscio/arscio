// What's still to pay, and every receipt.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { call } from '@/lib/api';
import { useParent } from '@/lib/auth';
import { C } from '@/lib/theme';
import { Card, Loading, Pill, T } from '@/components/ui';
import { SchoolBand } from '@/components/School';
import { rupees, shortDate, type Summary } from './index';

interface Due { feeDueId: string; feeHead: string; instalment: string; dueOn: string; amount: string; concession: string; paid: string; balance: string; suggestedFine: string }
interface Receipt { id: string; receiptNo: string; paidOn: string; total: string; mode: string; status: string }

export default function Fees() {
  const { child, accent } = useParent();
  const [d, setD] = useState<{ dues: Due[]; receipts: Receipt[] } | null>(null);
  const [school, setSchool] = useState<Summary['school'] | null>(null);
  useEffect(() => {
    if (!child) return;
    const o = { schoolId: child.schoolId };
    call<{ dues: Due[]; receipts: Receipt[] }>('GET', `/parent/children/${child.id}/fees`, undefined, o).then(setD);
    call<Summary>('GET', `/parent/children/${child.id}/summary`, undefined, o).then((s) => setSchool(s.school));
  }, [child]);
  if (!child || !d) return <Loading />;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const open = d.dues.filter((x) => Number(x.balance) > 0);
  const total = open.reduce((a, x) => a + Number(x.balance), 0);
  const instalments = [...new Set(open.map((x) => x.instalment))];

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <SchoolBand />
      <View style={{ padding: 16, gap: 12 }}>
        <Card style={{ gap: 4 }}>
          {d.dues.length === 0 ? <T soft>The school hasn&apos;t set this year&apos;s fees yet.</T>
            : total === 0 ? <Pill tone="done" text="All fees for this year are paid" /> : (
            <>
              <T display size={28}>{rupees(total)}</T>
              <T soft>still to pay this year</T>
            </>
          )}
        </Card>

        {instalments.map((inst) => {
          const lines = open.filter((x) => x.instalment === inst);
          const late = lines[0]!.dueOn < today;
          const fine = lines.reduce((a, x) => a + Number(x.suggestedFine), 0);
          return (
            <Card key={inst} style={{ gap: 8, borderLeftWidth: 4, borderLeftColor: late ? C.red : accent }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T bold size={16}>{inst}</T>
                <T bold size={14} style={{ color: late ? C.red : C.ink }}>{late ? 'Overdue since ' : 'Due '}{shortDate(lines[0]!.dueOn)}</T>
              </View>
              {lines.map((x) => (
                <View key={x.feeDueId} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <T size={15}>{x.feeHead}{Number(x.concession) ? <T soft size={13}>  (after {rupees(x.concession)} concession)</T> : null}</T>
                  <T size={15}>{rupees(x.balance)}</T>
                </View>
              ))}
              {fine > 0 ? <T size={14} style={{ color: C.red }}>Late fine so far: {rupees(fine)}</T> : null}
            </Card>
          );
        })}

        {open.length ? (
          <Card style={{ backgroundColor: C.boardWash, borderColor: C.boardWash }}>
            <T size={15}>
              {school?.onlinePayments
                ? 'Paying online in the app is coming soon. Until then, please pay at the school office.'
                : `Please pay at the school office${school?.phone ? ` (phone ${school.phone})` : ''}. You'll get a receipt, and it will appear here too.`}
            </T>
          </Card>
        ) : null}

        <T display size={18} style={{ marginTop: 10 }}>Receipts</T>
        {d.receipts.length === 0 ? <T soft>No receipts yet.</T> : d.receipts.map((r) => (
          <Card key={r.id} label={`Receipt ${r.receiptNo}`} onPress={() => router.push({ pathname: '/receipt/[id]', params: { id: r.id } })}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', opacity: r.status === 'cancelled' ? 0.6 : 1 }}>
            <View>
              <T bold size={15}>{rupees(r.total)}</T>
              <T soft size={13}>{shortDate(r.paidOn)}, No. {r.receiptNo}</T>
            </View>
            {r.status === 'cancelled' ? <Pill tone="todo" text="Cancelled" /> : <T bold style={{ color: accent }}>View</T>}
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}
