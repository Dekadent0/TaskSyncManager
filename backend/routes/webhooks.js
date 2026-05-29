/**
 * Webhook listeners for real-time Trello / Jira sync (WEBHOOK_PUBLIC_URL).
 */

import { Router } from 'express';
import express from 'express';
import {
  verifyTrelloWebhookSignature,
  verifyJiraWebhookSignature,
  verifyJiraWebhookToken,
  getTrelloSignatureHeader,
  getJiraSignatureHeader,
} from '../utils/webhookVerification.js';
import { parseWebhookJsonBody, rawBodyBuffer } from '../utils/parseWebhookBody.js';
import {
  isTrelloPositionOnlyAction,
  extractTrelloCardIdFromPayload,
} from '../utils/trelloWebhookFilters.js';
import { trelloWebhookCallbackUrl } from '../utils/webhookUrls.js';
import { getJiraWebhookSecretForEnvironment } from '../services/webhookRegistrationService.js';
import {
  evaluateJiraWebhookActor,
  logJiraIssueContext,
} from '../utils/jiraWebhookDiagnostics.js';
import {
  handleTrelloWebhook,
  handleJiraWebhook,
} from '../services/syncEngine.js';

const router = Router();

/** In-memory debounce: one sync per Trello card within the lock window. */
const activeSyncs = new Set();

const CARD_SYNC_LOCK_MS = 3000;

function parseEnvironmentId(req) {
  const raw = req.query.environmentId ?? req.query.environment_id;
  const id = Number(raw);
  if (!id || Number.isNaN(id)) return null;
  return id;
}

/** Temporary: bypass failed HMAC checks so network vs crypto issues can be isolated. */
function warnAndBypassSignatureValidation(reason) {
  console.log('=== WEBHOOK VALIDATION FAILED ===', reason);
  console.warn('Signature validation failed but bypassing for testing');
}

function parsePayloadSafe(body) {
  try {
    return parseWebhookJsonBody(body);
  } catch {
    return null;
  }
}

const rawBodyParser = express.raw({ type: 'application/json', limit: '2mb' });

function runTrelloBackgroundSync(payload, environmentId, cardId) {
  setImmediate(async () => {
    const listAfterId = payload?.action?.data?.listAfter?.id ?? null;
    const listAfterName =
      payload?.action?.data?.listAfter?.name ?? listAfterId ?? '(unknown)';

    try {
      console.log('[Sync Engine] Starting background sync for Trello card:', cardId);
      console.log('[Sync Engine] Checking rules for list:', listAfterId, `(${listAfterName})`);

      const result = await handleTrelloWebhook(payload, environmentId);

      console.log('[Sync Engine] Background sync completed:', {
        cardId: result.cardId ?? cardId,
        synced: result.synced,
        message: result.message,
        detailCount: result.details?.length ?? 0,
      });
    } catch (error) {
      console.error('[Sync Engine ERROR] Background synchronization failed:', error);
      if (error?.stack) {
        console.error(error.stack);
      }
    } finally {
      if (cardId) {
        setTimeout(() => {
          activeSyncs.delete(cardId);
          console.log('[Sync Engine] Released card lock:', cardId);
        }, CARD_SYNC_LOCK_MS);
      }
    }
  });
}

function runJiraBackgroundSync(payload, environmentId) {
  setImmediate(async () => {
    try {
      logJiraIssueContext(payload);

      const actor = evaluateJiraWebhookActor(payload);
      console.log(
        '[Jira Sync] Triggered by user:',
        actor.triggeredByUser,
        'Is bot bypass triggered?',
        actor.botBypassTriggered
      );
      console.log('[Jira Sync] Actor details:', {
        accountType: actor.accountType,
        isAppActor: actor.isAppActor,
        isStatusChange: actor.isStatusChange,
        webhookEvent: actor.webhookEvent,
        botBypassEnabled: actor.botBypassEnabled,
      });

      if (actor.skipReason) {
        console.log('[Jira Sync] Loop/bot check:', actor.skipReason);
      }

      if (actor.skip) {
        console.log('[Jira Sync] Skipped.', actor.skipReason);
        return;
      }

      const result = await handleJiraWebhook(payload, environmentId);

      console.log('[Jira Sync] Background sync completed:', {
        issueKey: result.issueKey,
        synced: result.synced,
        message: result.message,
        detailCount: result.details?.length ?? 0,
      });
    } catch (error) {
      console.error('[Jira Sync ERROR] Background process crashed:', error);
      if (error?.stack) {
        console.error(error.stack);
      }
    }
  });
}

router.head('/trello', (_req, res) => {
  res.sendStatus(200);
});

router.post('/trello', rawBodyParser, async (req, res) => {
  const payload = parsePayloadSafe(req.body);
  console.log('=== TRELLO WEBHOOK INCOMING ===', payload ?? req.body);

  const environmentId = parseEnvironmentId(req);
  if (!environmentId) {
    return res.status(400).json({ error: 'environmentId query parameter is required.' });
  }

  const callbackUrl = trelloWebhookCallbackUrl(environmentId);
  if (!callbackUrl) {
    return res.status(503).json({ error: 'WEBHOOK_PUBLIC_URL is not configured.' });
  }

  const secret = process.env.TRELLO_WEBHOOK_SECRET?.trim();
  const signature = getTrelloSignatureHeader(req);
  const verification = verifyTrelloWebhookSignature(
    rawBodyBuffer(req.body),
    callbackUrl,
    signature,
    secret
  );

  if (!verification.ok) {
    warnAndBypassSignatureValidation(verification.reason);
  }

  if (!payload) {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }

  if (isTrelloPositionOnlyAction(payload)) {
    const translationKey = payload?.action?.display?.translationKey ?? payload?.action?.type;
    console.log(
      `[Trello Webhook Skipped] Position-only action (${translationKey}); not a list change.`
    );
    return res.sendStatus(200);
  }

  const cardId = extractTrelloCardIdFromPayload(payload);
  if (cardId && activeSyncs.has(cardId)) {
    console.log(
      `[Duplicate Avoided] Webhook for card ${cardId} is already being processed.`
    );
    return res.sendStatus(200);
  }

  if (cardId) {
    activeSyncs.add(cardId);
  }

  res.sendStatus(200);

  runTrelloBackgroundSync(payload, environmentId, cardId);
});

router.post('/jira', rawBodyParser, async (req, res) => {
  let payload;
  try {
    payload = Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString('utf8'))
      : parseWebhookJsonBody(req.body);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }

  console.log('=== JIRA WEBHOOK INCOMING ===', payload);

  const environmentId = parseEnvironmentId(req);
  if (!environmentId) {
    return res.status(400).json({ error: 'environmentId query parameter is required.' });
  }

  const storedSecret = await getJiraWebhookSecretForEnvironment(environmentId);
  const envSecret = process.env.JIRA_WEBHOOK_SECRET?.trim();
  const secret = storedSecret || envSecret || null;
  const webhookToken = process.env.JIRA_WEBHOOK_TOKEN?.trim();

  const signature = getJiraSignatureHeader(req);
  let authorized = false;

  if (signature && secret) {
    authorized = verifyJiraWebhookSignature(rawBodyBuffer(req.body), signature, secret).ok;
  }

  if (!authorized && webhookToken) {
    authorized = verifyJiraWebhookToken(req, webhookToken).ok;
  }

  if (!authorized) {
    const reason = signature
      ? 'Invalid Jira webhook signature'
      : webhookToken
        ? 'Invalid Jira webhook token'
        : 'Jira webhook secret or token not configured';
    warnAndBypassSignatureValidation(reason);
  }

  res.sendStatus(200);

  runJiraBackgroundSync(payload, environmentId);
});

export default router;
