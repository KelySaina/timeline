/**
 * The single door to the API. Auth (cookie), CSRF (double submit) and error shaping live here,
 * so no component or store ever touches fetch directly.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }

  /** Field-level messages, keyed by field, for inline form errors. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.details ?? []).map((d) => [d.path, d.message]));
  }
}

const readCookie = (name: string): string | null => {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

/**
 * This tab's identity for the change stream. Mutations carry it in X-Client-Id and the stream
 * announces it as ?client=..., so a tab can recognise its own write coming back and skip it —
 * while the same person's other devices still receive it. Per page load on purpose: two tabs are
 * two clients, and each should react to what the other does.
 */
export const clientId: string = (globalThis.crypto?.randomUUID?.() ?? `c${Date.now()}${Math.random()}`)
  .replace(/[^A-Za-z0-9_-]/g, '')
  .slice(0, 64);

type RequestOptions = { method?: string; body?: unknown; signal?: AbortSignal };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  const isForm = options.body instanceof FormData;

  if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = readCookie('tl_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
    headers['X-Client-Id'] = clientId;
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    signal: options.signal,
    body: isForm ? (options.body as FormData) : options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string; details?: never } })?.error;
    throw new ApiError(
      response.status,
      error?.message ?? 'Something went wrong',
      error?.code ?? 'unknown',
      error?.details,
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  // A body is unusual on DELETE but correct here: unsubscribing names the push endpoint being
  // dropped, which is a 400-character URL that has no business in a query string.
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};

/** Photos are private: they are fetched with the session cookie, never from a public URL. */
export const photoUrl = (id: string, size: 'thumb' | 'full' = 'full') => `/api/photos/${id}?size=${size}`;
export const avatarUrl = (userId: string) => `/api/users/${userId}/avatar`;

export const query = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};
