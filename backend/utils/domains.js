export function normalizeJiraDomain(domain) {
  return String(domain).trim().replace(/\/+$/, '');
}
