// My class tests: newest first. Parents see the marks once published; they never count in the result.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { ApiError, call } from '@/lib/api';
import { C, classLabel, sectionLabel } from '@/lib/theme';
import { Button, Card, ErrorText, Loading, Pill, T } from '@/components/ui';
import { shortDate } from '../homework/index';

interface ClassTest {
  id: string; title: string; heldOn: string; maxMarks: string; publishedAt: string | null;
  className: string; sectionName: string; subjectName: string; entered: number; total: number;
}

export default function ClassTests() {
  const [items, setItems] = useState<ClassTest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setItems((await call<{ tests: ClassTest[] }>('GET', '/class-tests')).tests); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load'); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (!items) return error ? <View style={{ padding: 16 }}><ErrorText error={error} /></View> : <Loading />;

  return (
    <FlatList
      data={items}
      keyExtractor={(t) => t.id}
      contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 6 }}>
          <Button label="New class test" onPress={() => router.push('/class-tests/new')} />
          <ErrorText error={error} />
          <T soft size={14}>Your own tests. Parents see the marks after you publish them. They don&apos;t count in the final result.</T>
        </View>
      }
      ListEmptyComponent={<Card><T soft>No class tests yet.</T></Card>}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/class-tests/[id]', params: { id: item.id } })}>
          <Card style={{ gap: 6 }}>
            <T soft size={14}>{sectionLabel(item.className, item.sectionName)}  |  {item.subjectName}</T>
            <T bold size={17}>{item.title}</T>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <T size={14} style={{ color: C.inkSoft }}>{shortDate(item.heldOn)} · out of {Number(item.maxMarks)}</T>
              {item.publishedAt ? <Pill tone="done" text="Sent to parents" /> : <Pill tone="todo" text={`${item.entered} of ${item.total}`} />}
            </View>
          </Card>
        </Pressable>
      )}
    />
  );
}
