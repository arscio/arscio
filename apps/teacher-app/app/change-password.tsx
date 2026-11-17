// Change password. Also shown straight after a first login with a password from
// the school (or a date of birth): the person must choose their own to go on.
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, changePassword } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Button, Card, ErrorText, Input, T } from '@/components/ui';

export default function ChangePassword() {
  const { state, afterLogin, logout } = useAuth();
  const forced = state.status === 'change';
  const name = state.status === 'change' || state.status === 'in' ? state.me.account.name : '';
  const [oldPw, setOldPw] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (pw1 !== pw2) { setError('The two new passwords are not the same.'); return; }
    setBusy(true); setError(null);
    try {
      await changePassword(oldPw, pw1, 'Teacher app');
      if (forced) await afterLogin(); else router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={forced ? ['top', 'bottom'] : ['bottom']}>
      <Stack.Screen options={{ headerShown: !forced }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
          {forced ? (
            <View style={{ paddingTop: 24, gap: 6 }}>
              <T display size={26}>Choose your own password</T>
              <T soft>{name ? `Welcome, ${name}. ` : ''}The password you used works only once. Choose one that only you know.</T>
            </View>
          ) : <T soft>You will be logged out on your other phones.</T>}
          <Card style={{ gap: 16 }}>
            {!forced ? (
              <Input label="Current password" secureTextEntry autoFocus value={oldPw} onChangeText={setOldPw}
                textContentType="password" autoComplete="current-password" />
            ) : null}
            <Input label="New password" secureTextEntry autoFocus={forced} value={pw1} onChangeText={setPw1}
              textContentType="newPassword" autoComplete="new-password"
              hint="At least 6 characters. Avoid easy ones like 123456 or a date of birth." />
            <Input label="Type it again" secureTextEntry value={pw2} onChangeText={setPw2} textContentType="newPassword" />
            <ErrorText error={error} />
            <Button label="Save new password" busy={busy} disabled={pw1.length < 6 || (!forced && !oldPw)} onPress={save} />
          </Card>
          {forced ? <Button kind="quiet" label="Log out" onPress={logout} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
