export const API = '/api';

export async function apiRequest(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data.error === 'string'
        ? data.error
        : data.error?.message || data.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

export function withEnvironmentId(path, environmentId) {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}environmentId=${environmentId}`;
}
