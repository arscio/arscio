// Ask permission and register this phone for notifications (absent alerts,
// homework, notices). Needs the published app (or a development build):
// it quietly does nothing in a web browser or before the app is set up with Expo's build service.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { call } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true,
  }),
});

export async function registerForPush(): Promise<void> {
  try {
    if (Platform.OS === 'web' || !Device.isDevice) return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'School messages', importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    if (!projectId) return; // set when the app is connected to Expo's build service
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await call('POST', '/me/push-devices', { app: 'parent', platform: Platform.OS, pushToken: token });
  } catch {
    // Notifications are a bonus: everything is also in the Messages screen.
  }
}
