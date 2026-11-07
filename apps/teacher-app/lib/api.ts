// How the app talks to the AIEdu server.
//
// Login tickets: the long-lived "stay logged in" ticket is kept in the phone's
// secure storage (Keychain on iPhone, Keystore on Android). The short-lived
// ticket lives only in memory and is renewed automatically.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

const REFRESH_KEY = 'aiedu_refresh';
const SCHOOL_KEY = 'aiedu_school';

// On the web (used only for trying the app during development) there is no
// secure storage, so the browser's storage is used instead.
const store = {
  get: (k: string) =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(k) ?? null) : SecureStore.getItemAsync(k),
  set: (k: string, v: string) =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.setItem(k, v)) : SecureStore.setItemAsync(k, v),
  del: (k: string) =>
    Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.removeItem(k)) : SecureStore.deleteItemAsync(k),
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let accessToken: string | null = null;
let schoolId: string | null = null;
let onLoggedOut: (() => void) | null = null;

export const session = {
  async load() {
    schoolId = await store.get(SCHOOL_KEY);
    return Boolean(await store.get(REFRESH_KEY));
  },
  async save(t: { accessToken: string; refreshToken: string }) {
    accessToken = t.accessToken;
    await store.set(REFRESH_KEY, t.refreshToken);
  },
  async setSchool(id: string | null) {
    schoolId = id;
    if (id) await store.set(SCHOOL_KEY, id);
    else await store.del(SCHOOL_KEY);
  },
  get schoolId() { return schoolId; },
  async clear() {
    accessToken = null;
    schoolId = null;
    await store.del(REFRESH_KEY);
    await store.del(SCHOOL_KEY);
  },
  onLoggedOut(fn: () => void) { onLoggedOut = fn; },
};

async function raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', 'No internet connection. Check your mobile data or Wi-Fi and try again.');
  }
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function refresh(): Promise<boolean> {
  const rt = await store.get(REFRESH_KEY);
  if (!rt) return false;
  const { res, data } = await raw('POST', '/auth/refresh', { refreshToken: rt });
  if (!res.ok) {
    if (res.status === 401) await session.clear();
    return false;
  }
  await session.save(data);
  return true;
}

/** Login steps (no ticket needed). */
export async function authStep<T>(action: string, body: unknown): Promise<T> {
  const { res, data } = await raw('POST', `/auth/${action}`, body);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? 'Something went wrong');
  if (data.accessToken) await session.save(data);
  return data as T;
}

/** Calls made as the logged-in teacher, for the chosen school. */
export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!accessToken && !(await refresh())) {
    onLoggedOut?.();
    throw new ApiError(401, 'unauthorized', 'Please log in again');
  }
  const send = () => raw(method, path, body, {
    authorization: `Bearer ${accessToken}`,
    ...(schoolId ? { 'x-school-id': schoolId } : {}),
  });
  let { res, data } = await send();
  if (res.status === 401 && (await refresh())) ({ res, data } = await send());
  if (res.status === 401) {
    onLoggedOut?.();
    throw new ApiError(401, 'unauthorized', 'Please log in again');
  }
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? 'Something went wrong');
  return data as T;
}

export async function logout() {
  const rt = await store.get(REFRESH_KEY);
  if (rt) await raw('POST', '/auth/logout', { refreshToken: rt }).catch(() => {});
  await session.clear();
}
