import { Manrope_500Medium, Manrope_700Bold, useFonts } from '@expo-google-fonts/manrope';
import { Sora_700Bold, Sora_800ExtraBold } from '@expo-google-fonts/sora';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/lib/auth-context';
import { C, F } from '@/lib/theme';
import { Loading } from '@/components/ui';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Manrope_500Medium, Manrope_700Bold, Sora_700Bold, Sora_800ExtraBold });
  if (!fontsLoaded) return <Loading />;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: C.ink },
            headerTintColor: '#fff',
            headerTitleStyle: { fontFamily: F.display },
            contentStyle: { backgroundColor: C.paper },
          }}>
          <Stack.Screen name="index" options={{ title: 'Today' }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="choose-school" options={{ title: 'Choose school', headerBackVisible: false }} />
          <Stack.Screen name="other-class" options={{ title: 'Another class' }} />
          <Stack.Screen name="attendance/[sectionId]" options={{ title: 'Attendance' }} />
          <Stack.Screen name="account" options={{ title: 'My account' }} />
          <Stack.Screen name="homework/index" options={{ title: 'Homework' }} />
          <Stack.Screen name="homework/new" options={{ title: 'Give homework' }} />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
