export type ApiError = { error?: { code?: string; message?: string } };

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' });
  const txt = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(txt);
  } catch {
    // ignore
  }
  if (!res.ok) {
    const msg = (json as ApiError)?.error?.message || txt || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return (json ?? {}) as T;
}

export async function apiJson<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: any): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(txt);
  } catch {
    // ignore
  }
  if (!res.ok) {
    const msg = (json as ApiError)?.error?.message || txt || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return (json ?? {}) as T;
}

