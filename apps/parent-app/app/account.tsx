import { router } from 'expo-router';
import { View } from 'react-native';
import { API_URL } from '@/lib/api';
import { useParent } from '@/lib/auth';
import { classLabel } from '@/lib/theme';
import { Button, Card, Loading, Logo, T } from '@/components/ui';

export default function Account() {
  const { state, logout } = useParent();
  if (state.status !== 'in') return <Loading />;
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Card style={{ gap: 4 }}>
        <T display size={20}>{state.me.account.name}</T>
        <T soft>{state.me.account.phone.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2')}</T>
      </Card>
      <Card style={{ gap: 8 }}>
        <T bold>Children linked to this number</T>
        {state.children.map((c) => (
          <T key={c.id} size={15}>{c.first_name} {c.last_name ?? ''}, {c.class_name ? `${classLabel(c.class_name)} ${c.section_name}, ` : ''}{c.schoolName}</T>
        ))}
        <T soft size={13}>Missing a child? Ask their school office to use this mobile number as the family number.</T>
      </Card>
      <Button kind="plain" label="Change password" onPress={() => router.push('/change-password')} />
      <Button kind="plain" label="Log out" onPress={logout} />
      <View style={{ alignItems: 'center', marginTop: 20, gap: 4 }}>
        <Logo size={20} />
        <T soft size={12}>Arscio Parent</T>
        {__DEV__ ? <T soft size={11}>Server: {API_URL}</T> : null}
      </View>
    </View>
  );
}
