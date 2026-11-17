import { router } from 'expo-router';
import { View } from 'react-native';
import { API_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Button, Card, Loading, T } from '@/components/ui';

export default function Account() {
  const { state, logout } = useAuth();
  if (state.status !== 'in') return <Loading />;
  const school = state.me.schools.find((s) => s.id === state.schoolId);
  const several = state.me.schools.filter((s) => s.roles.includes('teacher')).length > 1;
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Card style={{ gap: 4 }}>
        <T display size={20}>{state.me.account.name}</T>
        <T soft>{state.me.account.phone.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2')}</T>
        <T soft>{school?.name}</T>
      </Card>
      {several ? <Button kind="plain" label="Switch school" onPress={() => router.push('/choose-school')} /> : null}
      <Button kind="plain" label="Change password" onPress={() => router.push('/change-password')} />
      <Button kind="plain" label="Log out" onPress={logout} />
      {__DEV__ ? <T soft size={12}>Server: {API_URL}</T> : null}
    </View>
  );
}
