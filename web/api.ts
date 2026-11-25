import { useQuery, useQueryClient } from '@tanstack/react-query';

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (res.status === 401) { window.location.href = '/login'; throw new Error('Login required'); }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function useApi<T>(path: string | null, opts: { refetchMs?: number } = {}) {
  return useQuery<T>({ queryKey: [path], queryFn: () => getJson<T>(path!), enabled: !!path, refetchInterval: opts.refetchMs });
}

export async function postApi<T = unknown>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? res.statusText), { data, status: res.status });
  return data as T;
}

export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}
