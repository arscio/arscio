// Login - the same steps as the admin website:
// phone -> (first time) SMS code -> create password; afterwards phone + password.
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { normalizeIndianPhone } from '@aiedu/shared';
import { ApiError, authStep } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { C } from '@/lib/theme';
import { Button, ErrorText, Input, Logo, T } from '@/components/ui';

type Step = 'phone' | 'password' | 'otp' | 'new-password';

export default function Login() {
  const { afterLogin } = useAuth();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  };
  const back = () => { setStep('phone'); setError(null); setPassword(''); setCode(''); };

  const start = () => run(async () => {
    const r = await authStep<{ next: 'otp' | 'password' }>('start', { phone });
    if (r.next === 'password') setStep('password');
    else { setReset(false); setInfo(`We sent a 6-digit code by SMS to +91 ${phone}.`); setStep('otp'); }
  });
  const forgot = () => run(async () => {
    await authStep('forgot', { phone });
    setReset(true); setCode(''); setInfo(`We sent a 6-digit code by SMS to +91 ${phone}.`); setStep('otp');
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.art}>
          <Logo size={34} onDark />
          <T display size={20} style={{ color: '#fff', marginTop: 18 }}>Teacher</T>
          <T size={15} style={{ color: '#B5CCC1', marginTop: 2 }}>Attendance, homework and marks.</T>
        </View>
        <ScrollView style={s.sheet} contentContainerStyle={{ padding: 24, gap: 18 }} keyboardShouldPersistTaps="handled">
          {step === 'phone' && (<>
            <View><T display size={22}>Log in</T><T soft>Use the mobile number the school has for you.</T></View>
            <Input label="Mobile number" prefix="+91" keyboardType="number-pad" maxLength={10} autoFocus
              placeholder="10-digit number" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, ''))}
              textContentType="telephoneNumber" autoComplete="tel" />
            <ErrorText error={error} />
            <Button label="Continue" onPress={start} busy={busy} disabled={!normalizeIndianPhone(phone)} />
          </>)}

          {step === 'password' && (<>
            <View><T display size={22}>Enter your password</T><T soft>For +91 {phone}</T></View>
            <Input label="Password" secureTextEntry autoFocus value={password} onChangeText={setPassword}
              textContentType="password" autoComplete="current-password" onSubmitEditing={() => password && run(async () => {
                await authStep('login', { phone, password, device: 'Teacher app' }); await afterLogin();
              })} />
            <ErrorText error={error} />
            <Button label="Log in" busy={busy} disabled={!password}
              onPress={() => run(async () => { await authStep('login', { phone, password, device: 'Teacher app' }); await afterLogin(); })} />
            <View style={s.row}>
              <Button kind="quiet" label="Use another number" onPress={back} />
              <Button kind="quiet" label="Forgot password?" onPress={forgot} disabled={busy} />
            </View>
          </>)}

          {step === 'otp' && (<>
            <View><T display size={22}>Enter the code</T><T soft>{info}</T></View>
            <Input label="6-digit code" keyboardType="number-pad" maxLength={6} autoFocus value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, ''))} textContentType="oneTimeCode" autoComplete="sms-otp"
              style={{ fontSize: 26, letterSpacing: 10, textAlign: 'center' }} hint="The code works for 5 minutes." />
            <ErrorText error={error} />
            <Button label="Check code" busy={busy} disabled={code.length !== 6}
              onPress={() => run(async () => {
                const r = await authStep<{ setupToken: string }>('verify-otp', { phone, code });
                setSetupToken(r.setupToken); setStep('new-password');
              })} />
            <View style={s.row}>
              <Button kind="quiet" label="Use another number" onPress={back} />
              <Button kind="quiet" label="Send a new code" disabled={busy}
                onPress={() => (reset ? forgot() : run(async () => {
                  await authStep('start', { phone }); setInfo(`We sent a new code to +91 ${phone}.`);
                }))} />
            </View>
          </>)}

          {step === 'new-password' && (<>
            <View>
              <T display size={22}>{reset ? 'Choose a new password' : 'Create your password'}</T>
              <T soft>Use it with your mobile number from now on, here and on the school website.</T>
            </View>
            <Input label="New password" secureTextEntry autoFocus value={pw1} onChangeText={setPw1}
              textContentType="newPassword" autoComplete="new-password" hint="At least 6 characters. Avoid easy ones like 123456." />
            <Input label="Type it again" secureTextEntry value={pw2} onChangeText={setPw2} textContentType="newPassword" />
            <ErrorText error={error} />
            <Button label="Save password and log in" busy={busy} disabled={pw1.length < 6}
              onPress={() => {
                if (pw1 !== pw2) { setError('The two passwords are not the same.'); return; }
                void run(async () => {
                  await authStep('set-password', { setupToken, password: pw1, device: 'Teacher app' }); await afterLogin();
                });
              }} />
          </>)}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  art: { paddingHorizontal: 24, paddingTop: 36, paddingBottom: 28, backgroundColor: C.ink },
  sheet: { flex: 1, backgroundColor: C.sheet, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' },
});
