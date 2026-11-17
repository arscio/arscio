// Builds the parent app for a "brand": Arscio Parent by default, or a school's own app.
// Choose with APP_BRAND=<folder in ./brands>, e.g. APP_BRAND=gvps.
import type { ExpoConfig } from 'expo/config';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const id = process.env.APP_BRAND ?? 'arscio';
const dir = `./brands/${id}`;
const brand = JSON.parse(readFileSync(path.join(__dirname, dir, 'brand.json'), 'utf8'));
// The Expo project this app is built under (saved by scripts/android-build.sh the first time).
const idFile = path.join(__dirname, 'eas-project-id.txt');
const projectId = existsSync(idFile) ? readFileSync(idFile, 'utf8').trim() : undefined;

const config: ExpoConfig = {
  owner: 'arscios-team',
  name: brand.name,
  slug: brand.slug,
  scheme: brand.scheme,
  version: '1.0.0',
  orientation: 'portrait',
  icon: `${dir}/icon.png`,
  userInterfaceStyle: 'light',
  ios: { supportsTablet: true, bundleIdentifier: brand.iosBundleId },
  android: {
    package: brand.androidPackage,
    adaptiveIcon: {
      backgroundColor: brand.androidIconBackground,
      foregroundImage: `${dir}/android-foreground.png`,
      backgroundImage: `${dir}/android-background.png`,
      monochromeImage: `${dir}/android-monochrome.png`,
    },
  },
  web: { favicon: `${dir}/favicon.png`, output: 'single' },
  plugins: [
    'expo-router', 'expo-secure-store', 'expo-font', 'expo-notifications',
    ['expo-splash-screen', { image: `${dir}/splash.png`, imageWidth: 160, backgroundColor: brand.splashBackground }],
  ],
  extra: {
    ...(projectId ? { eas: { projectId } } : {}),
    brand: { id: brand.id, name: brand.name, lockToSchoolId: brand.lockToSchoolId || '' },
  },
};

export default config;
