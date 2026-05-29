/**
 * HMAC verification for Trello and Jira webhook deliveries.
 */

import crypto from 'node:crypto';

function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Trello signs: base64(HMAC-SHA1(body + callbackURL, app secret)).
 * Header is typically `X-Trello-Webhook` (also accepts x-trello-webhook-signature).
 */
export function verifyTrelloWebhookSignature(
  rawBody,
  callbackUrl,
  signatureHeader,
  secret
) {
  if (!secret) {
    return { ok: false, reason: 'TRELLO_WEBHOOK_SECRET is not configured' };
  }
  if (!signatureHeader) {
    return { ok: false, reason: 'Missing Trello webhook signature header' };
  }
  if (!callbackUrl) {
    return { ok: false, reason: 'Missing callback URL for signature verification' };
  }

  const bodyStr = Buffer.isBuffer(rawBody)
    ? rawBody.toString('utf8')
    : String(rawBody ?? '');

  const expected = crypto
    .createHmac('sha1', secret)
    .update(bodyStr + callbackUrl)
    .digest('base64');

  const received = String(signatureHeader).trim();

  if (!timingSafeEqualStrings(expected, received)) {
    return { ok: false, reason: 'Invalid Trello webhook signature' };
  }

  return { ok: true };
}

/**
 * Jira Cloud: `X-Hub-Signature: sha256=<hex>` over the raw body.
 */
export function verifyJiraWebhookSignature(rawBody, signatureHeader, secret) {
  if (!secret) {
    return { ok: false, reason: 'Jira webhook secret is not configured' };
  }
  if (!signatureHeader) {
    return { ok: false, reason: 'Missing X-Hub-Signature header' };
  }

  const match = String(signatureHeader).trim().match(/^sha256=(.+)$/i);
  if (!match) {
    return { ok: false, reason: 'Invalid X-Hub-Signature format' };
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''));

  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  if (!timingSafeEqualStrings(expected, match[1].trim())) {
    return { ok: false, reason: 'Invalid Jira webhook signature' };
  }

  return { ok: true };
}

/**
 * Optional shared token (query or Authorization bearer) when HMAC secret is unavailable.
 */
export function verifyJiraWebhookToken(req, expectedToken) {
  if (!expectedToken) return { ok: true };

  const queryToken = req.query?.token;
  if (queryToken && queryToken === expectedToken) {
    return { ok: true };
  }

  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${expectedToken}`) {
    return { ok: true };
  }

  return { ok: false, reason: 'Invalid Jira webhook token' };
}

export function getTrelloSignatureHeader(req) {
  return (
    req.headers['x-trello-webhook-signature'] ||
    req.headers['x-trello-webhook'] ||
    req.headers['X-Trello-Webhook']
  );
}

export function getJiraSignatureHeader(req) {
  return req.headers['x-hub-signature'] || req.headers['X-Hub-Signature'];
}
