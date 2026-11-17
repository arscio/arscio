import { ScrollView, View } from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { Button, Card, Loading, T } from '@/components/ui';

export default function ChooseSchool() {
  const { state, chooseSchool, logout } = useAuth();
  if (state.status !== 'in') return <Loading />;
  const schools = state.me.schools.filter((s) => s.roles.includes('teacher'));

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {schools.length === 0 ? (
        <Card style={{ gap: 10 }}>
          <T bold size={18}>This app is for teachers</T>
          <T soft>Your number is not on any school&apos;s staff list. Parents use the Arscio parent app. If you are a teacher, ask the school office to add you.</T>
          <Button kind="plain" label="Log out" onPress={logout} />
        </Card>
      ) : (
        <>
          <T soft>Choose the school you are working in.</T>
          {schools.map((s) => (
            <Card key={s.id} onPress={() => chooseSchool(s.id)} label={`Open ${s.name}`}>
              <View style={{ gap: 2 }}><T bold size={18}>{s.name}</T></View>
            </Card>
          ))}
        </>
      )}
    </ScrollView>
  );
}
