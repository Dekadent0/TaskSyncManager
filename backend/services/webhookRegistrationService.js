/**
 * Registers Trello / Jira webhooks pointing at process.env.WEBHOOK_PUBLIC_URL.
 */

import crypto from 'node:crypto';
import axios from 'axios';
import { dbAll, dbGet, dbRun } from '../db.js';
import { jiraAuthConfig } from './jiraService.js';
import { trelloPost, trelloGet, deleteTrelloWebhook } from './trelloService.js';
import { loadEnvironmentCredentials } from './environmentService.js';
import {
  isWebhookRegistrationEnabled,
  trelloWebhookCallbackUrl,
  jiraWebhookCallbackUrl,
} from '../utils/webhookUrls.js';

function trelloWebhookSecret() {
  return process.env.TRELLO_WEBHOOK_SECRET?.trim() || null;
}

function generateJiraWebhookSecret() {
  return crypto.randomBytes(32).toString('hex');
}

export async function getJiraWebhookSecretForEnvironment(environmentId) {
  const row = await dbGet(
    `SELECT secret FROM webhook_registrations
     WHERE environment_id = ? AND provider = 'jira'
     LIMIT 1`,
    [environmentId]
  );
  return row?.secret || null;
}

async function upsertWebhookRegistration({
  environmentId,
  provider,
  resourceId,
  externalWebhookId,
  callbackUrl,
  secret,
}) {
  await dbRun(
    `INSERT INTO webhook_registrations (
      environment_id, provider, resource_id, external_webhook_id, callback_url, secret
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(environment_id, provider, resource_id) DO UPDATE SET
      external_webhook_id = excluded.external_webhook_id,
      callback_url = excluded.callback_url,
      secret = excluded.secret`,
    [
      environmentId,
      provider,
      resourceId,
      externalWebhookId ?? null,
      callbackUrl,
      secret ?? null,
    ]
  );
}

async function deleteWebhookRegistration(environmentId, provider, resourceId) {
  await dbRun(
    `DELETE FROM webhook_registrations
     WHERE environment_id = ? AND provider = ? AND resource_id = ?`,
    [environmentId, provider, resourceId]
  );
}

async function registerTrelloBoardWebhook(credentials, environmentId, boardId) {
  const callbackUrl = trelloWebhookCallbackUrl(environmentId);
  if (!callbackUrl) return { skipped: true, reason: 'WEBHOOK_PUBLIC_URL not set' };

  const existing = await dbGet(
    `SELECT * FROM webhook_registrations
     WHERE environment_id = ? AND provider = 'trello' AND resource_id = ?`,
    [environmentId, boardId]
  );

  if (existing?.callback_url === callbackUrl && existing?.external_webhook_id) {
    return { ok: true, reused: true, boardId };
  }

  if (existing?.external_webhook_id) {
    try {
      await trelloGet(credentials, `/webhooks/${existing.external_webhook_id}`);
    } catch {
      // Stale registration — recreate below.
    }
  }

  const webhook = await trelloPost(credentials, '/webhooks', {
    callbackURL: callbackUrl,
    idModel: boardId,
    description: `TaskSync env ${environmentId} board ${boardId}`,
  });

  await upsertWebhookRegistration({
    environmentId,
    provider: 'trello',
    resourceId: boardId,
    externalWebhookId: webhook.id,
    callbackUrl,
    secret: trelloWebhookSecret(),
  });

  return { ok: true, boardId, webhookId: webhook.id };
}

async function registerJiraProjectWebhook(
  credentials,
  environmentId,
  projectKey,
  secret
) {
  const callbackUrl = jiraWebhookCallbackUrl(environmentId);
  if (!callbackUrl) return { skipped: true, reason: 'WEBHOOK_PUBLIC_URL not set' };

  const client = axios.create(jiraAuthConfig(credentials));
  const jqlFilter = `project = "${projectKey}"`;

  const existing = await dbGet(
    `SELECT * FROM webhook_registrations
     WHERE environment_id = ? AND provider = 'jira' AND resource_id = ?`,
    [environmentId, projectKey]
  );

  if (existing?.callback_url === callbackUrl && existing?.external_webhook_id) {
    return { ok: true, reused: true, projectKey };
  }

  if (existing?.external_webhook_id) {
    try {
      await client.delete(`/rest/webhooks/1.0/webhook/${existing.external_webhook_id}`);
    } catch {
      // Ignore delete failures (webhook may already be gone).
    }
  }

  const { data } = await client.post('/rest/webhooks/1.0/webhook', {
    name: `TaskSync env ${environmentId} ${projectKey}`,
    url: callbackUrl,
    events: ['jira:issue_created', 'jira:issue_updated'],
    filters: {
      'issue-related-events-section': jqlFilter,
    },
    excludeIssueDetails: false,
    secret,
  });

  await upsertWebhookRegistration({
    environmentId,
    provider: 'jira',
    resourceId: projectKey,
    externalWebhookId: String(data.id ?? data.self?.split('/').pop()),
    callbackUrl,
    secret,
  });

  return { ok: true, projectKey, webhookId: data.id };
}

/**
 * Register webhooks for all boards/projects referenced by sync rules in an environment.
 */
export async function registerWebhooksForEnvironment(environmentId) {
  if (!isWebhookRegistrationEnabled()) {
    return {
      ok: false,
      skipped: true,
      message: 'Set WEBHOOK_PUBLIC_URL (e.g. https://your-subdomain.ngrok-free.dev) to enable webhooks.',
    };
  }

  const credentials = await loadEnvironmentCredentials(environmentId);
  const rules = await dbAll(
    'SELECT * FROM sync_rules WHERE environment_id = ?',
    [environmentId]
  );

  if (rules.length === 0) {
    return { ok: true, message: 'No sync rules; nothing to register.' };
  }

  const trelloBoardIds = [...new Set(rules.map((r) => r.trello_board_id).filter(Boolean))];
  const jiraProjectKeys = [...new Set(rules.map((r) => r.jira_project_id).filter(Boolean))];

  let jiraSecret = await getJiraWebhookSecretForEnvironment(environmentId);
  if (!jiraSecret) {
    jiraSecret = generateJiraWebhookSecret();
  }

  const results = { trello: [], jira: [], errors: [] };

  for (const boardId of trelloBoardIds) {
    try {
      results.trello.push(
        await registerTrelloBoardWebhook(credentials, environmentId, boardId)
      );
    } catch (err) {
      results.errors.push({
        provider: 'trello',
        resourceId: boardId,
        error: err.response?.data?.message || err.message,
      });
    }
  }

  for (const projectKey of jiraProjectKeys) {
    try {
      results.jira.push(
        await registerJiraProjectWebhook(
          credentials,
          environmentId,
          projectKey,
          jiraSecret
        )
      );
    } catch (err) {
      const msg =
        err.response?.data?.errorMessages?.join('; ') ||
        err.response?.data?.message ||
        err.message;
      results.errors.push({ provider: 'jira', resourceId: projectKey, error: msg });
    }
  }

  return { ok: results.errors.length === 0, ...results };
}

/**
 * Fire-and-forget webhook registration (logs errors, never throws to caller).
 */
export function scheduleWebhookRegistration(environmentId) {
  if (!isWebhookRegistrationEnabled()) return;

  setImmediate(() => {
    registerWebhooksForEnvironment(environmentId).catch((err) => {
      console.error(
        `[webhooks] Registration failed for environment ${environmentId}:`,
        err.message
      );
    });
  });
}

export async function deleteWebhooksForEnvironment(environmentId) {
  const rows = await dbAll(
    'SELECT * FROM webhook_registrations WHERE environment_id = ?',
    [environmentId]
  );
  if (rows.length === 0) return;

  let credentials;
  try {
    credentials = await loadEnvironmentCredentials(environmentId);
  } catch {
    await dbRun('DELETE FROM webhook_registrations WHERE environment_id = ?', [
      environmentId,
    ]);
    return;
  }

  const client = axios.create(jiraAuthConfig(credentials));

  for (const row of rows) {
    try {
      if (row.provider === 'trello' && row.external_webhook_id) {
        await deleteTrelloWebhook(credentials, row.external_webhook_id);
      } else if (row.provider === 'jira' && row.external_webhook_id) {
        await client.delete(`/rest/webhooks/1.0/webhook/${row.external_webhook_id}`);
      }
    } catch {
      // Best-effort cleanup.
    }
    await deleteWebhookRegistration(environmentId, row.provider, row.resource_id);
  }
}
