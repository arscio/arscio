import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { call } from '@/lib/api';
import { useParent } from '@/lib/auth';
import { C } from '@/lib/theme';
import { Card, Loading, T } from '@/components/ui';
import { SchoolBand } from '@/components/School';
import { shortDate } from './index';

interface Hw { id: string; title: string; details: string | null; dueOn: string | null; createdAt: string; subjectName: string | null; givenBy: string;
  submission?: 'submitted' | 'late' | 'not_submitted' | null }
const SUBMITTED = { submitted: ['Handed in', C.lagoonDeep], late: ['Handed in late', C.marigold], not_submitted: ['Not handed in', C.red] } as const;

export default function Homework() {
  const { child, accent } = useParent();
  const [list, setList] = useState<Hw[] | null>(null);
  useEffect(() => {
    if (child) call<{ homework: Hw[] }>('GET', `/parent/children/${child.id}/homework`, undefined, { schoolId: child.schoolId }).then((r) => setList(r.homework));
  }, [child]);
  if (!list) return <Loading />;
  return (
    <FlatList
      data={list}
      keyExtractor={(h) => h.id}
      ListHeaderComponent={<View style={{ marginBottom: 12 }}><SchoolBand /><T soft size={14} style={{ padding: 16, paddingBottom: 0 }}>Homework from the last 30 days.</T></View>}
      contentContainerStyle={{ paddingBottom: 40, gap: 10 }}
      ListEmptyComponent={<View style={{ paddingHorizontal: 16 }}><Card><T soft>No homework in the last 30 days.</T></Card></View>}
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: 16 }}>
          <Card style={{ gap: 6 }}>
            <T soft size={13}>{[item.subjectName, `given ${shortDate(item.createdAt)} by ${item.givenBy}`].filter(Boolean).join('  |  ')}</T>
            <T bold size={16}>{item.title}</T>
            {item.details ? <T size={15}>{item.details}</T> : null}
            {item.dueOn ? <T bold size={14}>Due {shortDate(item.dueOn)}</T> : null}
            {item.submission ? <T bold size={14} style={{ color: SUBMITTED[item.submission][1] }}>{SUBMITTED[item.submission][0]}</T> : null}
          </Card>
        </View>
      )}
    />
  );
}
