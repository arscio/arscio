// Every message from school (notices, homework, absent alerts), newest first.
// Tapping one opens it in full and marks it as read.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { call } from '@/lib/api';
import { useParent } from '@/lib/auth';
import { C } from '@/lib/theme';
import { Loading, T } from '@/components/ui';

interface Msg { id: string; title: string; body: string; data: { kind: string }; createdAt: string; readAt: string | null; schoolName: string }
const KIND: Record<string, string> = { notice: 'Notice', homework: 'Homework', absent: 'Attendance' };
const when = (t: string) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function Messages() {
  const { state, accent } = useParent();
  const [list, setList] = useState<Msg[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => setList((await call<{ messages: Msg[] }>('GET', '/me/messages')).messages), []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (!list) return <Loading />;
  const manySchools = state.status === 'in' && new Set(state.children.map((c) => c.schoolId)).size > 1;

  return (
    <FlatList
      data={list}
      keyExtractor={(m) => m.id}
      contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40 }}
      ListEmptyComponent={<T soft style={{ padding: 16 }}>No messages yet. Notices, homework and attendance alerts from school will appear here.</T>}
      renderItem={({ item }) => {
        const expanded = open === item.id;
        return (
          <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
            onPress={async () => {
              setOpen(expanded ? null : item.id);
              if (!item.readAt) {
                await call('POST', `/me/messages/${item.id}/read`).catch(() => undefined);
                setList((l) => l?.map((m) => (m.id === item.id ? { ...m, readAt: new Date().toISOString() } : m)) ?? null);
              }
            }}
            style={{ backgroundColor: item.readAt ? C.sheet : '#FFFBEB', borderBottomWidth: 1, borderColor: C.rule, padding: 16, flexDirection: 'row', gap: 12 }}>
            <View style={{ width: 8, paddingTop: 7 }}>
              {!item.readAt ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent }} accessibilityLabel="Unread" /> : null}
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <T soft size={12}>{KIND[item.data.kind] ?? 'Message'}  |  {when(item.createdAt)}{manySchools ? `  |  ${item.schoolName}` : ''}</T>
              <T bold size={16}>{item.title}</T>
              <T size={15} numberOfLines={expanded ? undefined : 2}>{item.body}</T>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
