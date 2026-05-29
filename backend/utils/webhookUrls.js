/**
 * Public webhook callback URLs from process.env.WEBHOOK_PUBLIC_URL (ngrok, etc.).
 */

export function getWebhookPublicBase() {
  const base = process.env.WEBHOOK_PUBLIC_URL?.trim();
  if (!base) return null;
  return base.replace(/\/+$/, '');
}

export function trelloWebhookCallbackUrl(environmentId) {
  const base = getWebhookPublicBase();
  if (!base) return null;
  return `${base}/api/webhooks/trello?environmentId=${environmentId}`;
}

export function jiraWebhookCallbackUrl(environmentId) {
  const base = getWebhookPublicBase();
  if (!base) return null;
  return `${base}/api/webhooks/jira?environmentId=${environmentId}`;
}

export function isWebhookRegistrationEnabled() {
  return Boolean(getWebhookPublicBase());
}
