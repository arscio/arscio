import { BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
import { Figtree_500Medium, Figtree_600SemiBold, useFonts } from '@expo-google-fonts/figtree';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/lib/auth-context';
import { C, F } from '@/lib/theme';
import { Backdrop, Loading } from '@/components/ui';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Figtree_500Medium, Figtree_600SemiBold, BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold });
  if (!fontsLoaded) return <Loading />;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <View style={{ flex: 1, backgroundColor: C.paper }}>
        <Backdrop />
        <StatusBar style="dark" />
        <ThemeProvider value={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: 'transparent', card: C.paper, primary: C.board, text: C.ink } }}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: 'transparent' },
            headerTintColor: C.board,
            headerTitleStyle: { fontFamily: F.display, color: C.ink },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: 'transparent' },
          }}>
          <Stack.Screen name="index" options={{ title: 'Today', headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="change-password" options={{ title: 'Change password' }} />
          <Stack.Screen name="choose-school" options={{ title: 'Choose school', headerBackVisible: false }} />
          <Stack.Screen name="other-class" options={{ title: 'Another class' }} />
          <Stack.Screen name="attendance/[sectionId]" options={{ title: 'Attendance' }} />
          <Stack.Screen name="account" options={{ title: 'My account' }} />
          <Stack.Screen name="homework/index" options={{ title: 'Homework' }} />
          <Stack.Screen name="homework/new" options={{ title: 'Give homework' }} />
          <Stack.Screen name="marks/index" options={{ title: 'Marks' }} />
          <Stack.Screen name="leave" options={{ title: 'Leave' }} />
          <Stack.Screen name="marks/enter" options={{ title: 'Enter marks' }} />
          <Stack.Screen name="class-tests/index" options={{ title: 'Class tests' }} />
          <Stack.Screen name="class-tests/new" options={{ title: 'New class test' }} />
          <Stack.Screen name="class-tests/[id]" options={{ title: 'Class test' }} />
          <Stack.Screen name="homework/[id]" options={{ title: 'Who handed it in' }} />
        </Stack>
        </ThemeProvider>
        </View>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
