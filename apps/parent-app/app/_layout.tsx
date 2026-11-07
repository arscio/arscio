import { Manrope_500Medium, Manrope_700Bold, useFonts } from '@expo-google-fonts/manrope';
import { Sora_700Bold, Sora_800ExtraBold } from '@expo-google-fonts/sora';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ParentProvider, useParent } from '@/lib/auth';
import { C, F } from '@/lib/theme';
import { Loading } from '@/components/ui';

function Screens() {
  // The top bar takes the colour of the selected child's school.
  const { accent } = useParent();
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: accent },
        headerTintColor: '#fff',
        headerTitleStyle: { fontFamily: F.display },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: C.paper },
      }}>
        <Stack.Screen name="index" options={{ title: 'Home' }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="attendance" options={{ title: 'Attendance' }} />
        <Stack.Screen name="fees" options={{ title: 'Fees' }} />
        <Stack.Screen name="receipt/[id]" options={{ title: 'Receipt' }} />
        <Stack.Screen name="homework" options={{ title: 'Homework' }} />
        <Stack.Screen name="messages" options={{ title: 'Messages' }} />
        <Stack.Screen name="account" options={{ title: 'My account' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Manrope_500Medium, Manrope_700Bold, Sora_700Bold, Sora_800ExtraBold });
  if (!fontsLoaded) return <Loading />;
  return (
    <SafeAreaProvider>
      <ParentProvider>
        <Screens />
      </ParentProvider>
    </SafeAreaProvider>
  );
}
