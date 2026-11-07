// Builds the parent app for a "brand": AIEdu Parent by default, or a school's own app.
// Choose with APP_BRAND=<folder in ./brands>, e.g. APP_BRAND=gvps.
import type { ExpoConfig } from 'expo/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const id = process.env.APP_BRAND ?? 'aiedu';
const dir = `./brands/${id}`;
const brand = JSON.parse(readFileSync(path.join(__dirname, dir, 'brand.json'), 'utf8'));

const config: ExpoConfig = {
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
    brand: { id: brand.id, name: brand.name, lockToSchoolId: brand.lockToSchoolId || '' },
  },
};

export default config;
