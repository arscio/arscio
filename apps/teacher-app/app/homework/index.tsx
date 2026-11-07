// Homework I gave in the last two weeks.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { ApiError, call } from '@/lib/api';
import { C, classLabel } from '@/lib/theme';
import { Button, Card, ErrorText, Loading, T } from '@/components/ui';

export interface Homework {
  id: string; className: string; sectionName: string; subjectName: string | null;
  title: string; details: string | null; dueOn: string | null; createdAt: string;
}

export const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function HomeworkList() {
  const [items, setItems] = useState<Homework[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems((await call<{ homework: Homework[] }>('GET', '/homework?mine=true')).homework); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load'); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const remove = async (id: string) => {
    setError(null);
    try { await call('DELETE', `/homework/${id}`); setConfirming(null); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not remove'); }
  };

  if (!items) return error ? <View style={{ padding: 16 }}><ErrorText error={error} /></View> : <Loading />;
  return (
    <FlatList
      data={items}
      keyExtractor={(h) => h.id}
      contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 6 }}>
          <Button label="Give homework" onPress={() => router.push('/homework/new')} />
          <ErrorText error={error} />
          <T soft size={14}>Homework you gave in the last two weeks.</T>
        </View>
      }
      ListEmptyComponent={<Card><T soft>You haven&apos;t given any homework in the last two weeks.</T></Card>}
      renderItem={({ item }) => (
        <Card style={{ gap: 6 }}>
          <T soft size={14}>{classLabel(item.className)} {item.sectionName}{item.subjectName ? `  |  ${item.subjectName}` : ''}</T>
          <T bold size={17}>{item.title}</T>
          {item.details ? <T size={15}>{item.details}</T> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <T size={14} style={{ color: item.dueOn ? C.ink : C.inkSoft }}>
              {item.dueOn ? `Due ${shortDate(item.dueOn)}` : 'No due date'}{'   '}
              <T soft size={13}>Given {shortDate(item.createdAt.slice(0, 10))}</T>
            </T>
            <Button kind="quiet" label={confirming === item.id ? 'Tap again to remove' : 'Remove'}
              onPress={() => (confirming === item.id ? remove(item.id) : setConfirming(item.id))} />
          </View>
        </Card>
      )}
    />
  );
}
