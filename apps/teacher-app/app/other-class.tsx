// For covering another teacher's class.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { call } from '@/lib/api';
import { classLabel, sectionLabel } from '@/lib/theme';
import { Card, Loading, T } from '@/components/ui';

interface Row { sectionId: string; className: string; sectionName: string }

export default function OtherClass() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { call<{ sections: Row[] }>('GET', '/attendance/sections').then((r) => setRows(r.sections)); }, []);
  if (!rows) return <Loading />;
  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.sectionId}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      ListHeaderComponent={<T soft style={{ marginBottom: 6 }}>Covering a class? Choose it here. Your name is saved with the attendance.</T>}
      ListEmptyComponent={<T soft>The school has not added any sections yet.</T>}
      renderItem={({ item }) => (
        <Card label={`${sectionLabel(item.className, item.sectionName)}`}
          onPress={() => router.replace({ pathname: '/attendance/[sectionId]', params: { sectionId: item.sectionId } })}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T bold size={18}>{sectionLabel(item.className, item.sectionName)}</T>
          </View>
        </Card>
      )}
    />
  );
}
