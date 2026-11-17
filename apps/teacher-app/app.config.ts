// Adds build-service details to app.json: the Expo account and the project this app is built under.
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const idFile = path.join(__dirname, 'eas-project-id.txt');
const projectId = existsSync(idFile) ? readFileSync(idFile, 'utf8').trim() : undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  owner: 'arscios-team',
  extra: { ...config.extra, ...(projectId ? { eas: { projectId } } : {}) },
});
