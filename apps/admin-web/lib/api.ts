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
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? 'Something went wrong. Please try again.');
  }
  return data as T;
}

/** Calls to the aiedu server (through the website's secure door). */
export const api = {
  get: <T>(path: string) => request<T>('GET', `/api/x${path}`),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', `/api/x${path}`, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', `/api/x${path}`, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', `/api/x${path}`, body),
  del: <T>(path: string) => request<T>('DELETE', `/api/x${path}`),
};

export const auth = {
  step: <T>(action: string, body: unknown) => request<T>('POST', `/api/auth/${action}`, body),
  logout: () => request('POST', '/api/auth/logout', {}),
  chooseSchool: (schoolId: string) => request('POST', '/api/session', { schoolId }),
};
