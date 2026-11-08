/** Fetch wrapper: cookies, CSRF header, automatic token refresh, friendly errors. */
export class ApiError extends Error {
  constructor(public status: number, message: string, public fieldErrors: Record<string, string> = {}) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'x-cc': '1' } })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => { setTimeout(() => { refreshing = null; }, 0); });
  }
  return refreshing;
}

type Opts = { method?: string; body?: unknown; form?: FormData; query?: Record<string, unknown>; raw?: boolean };

function qs(q?: Record<string, unknown>) {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function api<T = unknown>(path: string, opts: Opts = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { 'x-cc': '1' };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const res = await fetch(`/api${path}${qs(opts.query)}`, { method: opts.method ?? (body ? 'POST' : 'GET'), credentials: 'include', headers, body });
  if (res.status === 401 && !retried && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    if (await refresh()) return api<T>(path, opts, true);
    window.dispatchEvent(new CustomEvent('cc:logged-out'));
  }
  if (!res.ok) {
    let data: { message?: string; fieldErrors?: Record<string, string> } = {};
    try { data = await res.json(); } catch { /* not json */ }
    throw new ApiError(res.status, data.message || (res.status >= 500 ? 'Something went wrong. Please try again.' : 'That did not work'), data.fieldErrors);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('json') ? res.json() : res.text()) as Promise<T>;
}

export const get = <T>(path: string, query?: Record<string, unknown>) => api<T>(path, { query });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body: body ?? {} });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: body ?? {} });
export const del = <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });
export const upload = <T>(path: string, form: FormData) => api<T>(path, { method: 'POST', form });

/** Download a file the API generates (PDF/Excel) without leaving the page. */
export async function download(path: string, query?: Record<string, unknown>) {
  const res = await api<Response>(path, { query, raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? 'download';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = decodeURIComponent(name);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
