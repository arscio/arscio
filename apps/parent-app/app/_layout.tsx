import { BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
import { Figtree_500Medium, Figtree_600SemiBold, useFonts } from '@expo-google-fonts/figtree';
import { View } from 'react-native';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ParentProvider, useParent } from '@/lib/auth';
import { C, F } from '@/lib/theme';
import { Backdrop, Loading } from '@/components/ui';

function Screens() {
  // Light, airy top bars; the school's colour shows inside the screens.
  const { accent } = useParent();
  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <Backdrop />
      <StatusBar style="dark" />
      <ThemeProvider value={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: 'transparent', card: C.paper, primary: accent, text: C.ink } }}>
      <Stack screenOptions={{
        headerStyle: { backgroundColor: 'transparent' },
        headerTintColor: accent,
        headerTitleStyle: { fontFamily: F.display, color: C.ink },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: 'transparent' },
      }}>
        <Stack.Screen name="index" options={{ title: 'Home', headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="change-password" options={{ title: 'Change password' }} />
        <Stack.Screen name="attendance" options={{ title: 'Attendance' }} />
        <Stack.Screen name="fees" options={{ title: 'Fees' }} />
        <Stack.Screen name="receipt/[id]" options={{ title: 'Receipt' }} />
        <Stack.Screen name="homework" options={{ title: 'Homework' }} />
        <Stack.Screen name="messages" options={{ title: 'Messages' }} />
        <Stack.Screen name="account" options={{ title: 'My account' }} />
        <Stack.Screen name="report" options={{ title: 'Report card' }} />
        <Stack.Screen name="marks" options={{ title: 'Marks' }} />
      </Stack>
      </ThemeProvider>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Figtree_500Medium, Figtree_600SemiBold, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold });
  if (!fontsLoaded) return <Loading />;
  return (
    <SafeAreaProvider>
      <ParentProvider>
        <Screens />
      </ParentProvider>
    </SafeAreaProvider>
  );
}
