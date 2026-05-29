/**
 * Parse webhook request bodies (raw Buffer or already-parsed JSON).
 */

export function parseWebhookJsonBody(body) {
  if (Buffer.isBuffer(body)) {
    return JSON.parse(body.toString('utf8'));
  }
  if (typeof body === 'string') {
    return JSON.parse(body);
  }
  if (body && typeof body === 'object') {
    return body;
  }
  throw new Error('Unsupported webhook body type');
}

export function rawBodyBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body && typeof body === 'object') {
    return Buffer.from(JSON.stringify(body), 'utf8');
  }
  return Buffer.from('', 'utf8');
}
