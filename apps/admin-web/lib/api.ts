'use client';
// How screens talk to the server. Errors come back as plain sentences.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !url.startsWith('/api/auth')) {
      window.location.href = '/login';
    }
    // First login with a password from the school: nothing works until a new one is chosen.
    if (data?.error?.code === 'must_change_password' && typeof window !== 'undefined' && !url.startsWith('/api/auth')) {
      window.location.href = '/change-password';
    }
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? 'Something went wrong. Please try again.');
  }
  return data as T;
}

/** Calls to the arscio server (through the website's secure door). */
export const api = {
  get: <T>(path: string) => request<T>('GET', `/api/x${path}`),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', `/api/x${path}`, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', `/api/x${path}`, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', `/api/x${path}`, body),
  del: <T>(path: string) => request<T>('DELETE', `/api/x${path}`),
};

export const auth = {
  step: <T>(action: string, body: unknown) => request<T>('POST', `/api/auth/${action}`, body),
  mode: () => request<{ mode: 'otp' | 'password' }>('GET', '/api/auth/mode'),
  logout: () => request('POST', '/api/auth/logout', {}),
  chooseSchool: (schoolId: string) => request('POST', '/api/session', { schoolId }),
};

/** Address for a file from the server (document, ZIP). */
export const fileUrl = (path: string) => `/api/x${path}`;
/** Student photos are stored on the server; their links start with "/photos/". */
export const photoSrc = (url: string | null | undefined) => (url ? (url.startsWith('/') ? `/api/x${url}` : url) : null);

/** Read a chosen file as a data URL. Big phone photos are shrunk first (keeps the file small and fast). */
export async function readUpload(file: File, opts: { maxSide: number; quality?: number; alwaysShrink?: boolean }) {
  const asDataUrl = (b: Blob) => new Promise<string>((ok, fail) => {
    const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => fail(r.error); r.readAsDataURL(b);
  });
  if (!file.type.startsWith('image/') || (!opts.alwaysShrink && file.size < 1.5 * 1024 * 1024)) return asDataUrl(file);
  const img = await createImageBitmap(file);
  const k = Math.min(1, opts.maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // JPG has no see-through parts: use white, not black
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', opts.quality ?? 0.85);
}

/** A first password that is easy to read out or copy from a slip (no 0/O or 1/l look-alikes). */
export function makeTempPassword(length = 8) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
