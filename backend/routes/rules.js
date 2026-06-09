/**
 * Sync rules CRUD routes.
 */

import { Router } from 'express';
import { dbGet, dbAll, dbRun } from '../db.js';
import { getEnvironmentIdFromRequest, resolveEnvironmentId } from '../utils/requestContext.js';
import {
  parseSyncDirection,
  formatSyncRule,
  defaultRuleName,
} from '../utils/ruleValidation.js';
import { scheduleWebhookRegistration } from '../services/webhookRegistrationService.js';
import { loadEnvironmentCredentials } from '../services/environmentService.js';
import { syncExistingItemsForRule } from '../services/syncEngine.js';
import { appendSyncResultActivity } from '../services/syncActivityLog.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const environmentId = getEnvironmentIdFromRequest(req);
    const rows = await dbAll(
      `SELECT id, name, trello_board_id, trello_source_column_id,
              jira_project_id, jira_board_id, jira_target_column_id,
              direction, environment_id, created_at
       FROM sync_rules
       WHERE environment_id = ?
       ORDER BY id`,
      [environmentId]
    );
    res.json(rows.map(formatSyncRule));
  } catch (err) {
    const status = err.message?.includes('Environment id') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const {
    name,
    direction,
    environmentId,
    environment_id,
    trello_board_id,
    trello_source_column_id,
    jira_project_id,
    jira_board_id,
    jira_target_column_id,
  } = req.body;

  let envId;
  try {
    envId = resolveEnvironmentId(req, req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const directionResult = parseSyncDirection(direction);
  if (directionResult.error) {
    return res.status(400).json({ error: directionResult.error });
  }

  if (
    !trello_board_id ||
    !trello_source_column_id ||
    !jira_project_id ||
    !jira_board_id ||
    !jira_target_column_id
  ) {
    return res.status(400).json({
      error:
        'Required: trello_board_id, trello_source_column_id, jira_project_id, jira_board_id, jira_target_column_id',
    });
  }

  try {
    const ruleName =
      name && String(name).trim()
        ? String(name).trim()
        : await defaultRuleName(envId);

    const result = await dbRun(
      `INSERT INTO sync_rules (
        name, trello_board_id, trello_source_column_id, jira_project_id, jira_board_id,
        jira_target_column_id, direction, environment_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ruleName,
        trello_board_id,
        trello_source_column_id,
        jira_project_id,
        jira_board_id,
        jira_target_column_id,
        directionResult.direction,
        envId,
      ]
    );

    const row = formatSyncRule(
      await dbGet('SELECT * FROM sync_rules WHERE id = ?', [result.lastID])
    );

    scheduleWebhookRegistration(envId);

    res.status(201).json({
      ok: true,
      id: result.lastID,
      name: ruleName,
      direction: directionResult.direction,
      rule: row,
      message: 'Sync rule saved.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Backfill existing tasks for one rule (manual / API trigger).
 * Does not run on webhooks — use when a new rule is added and old cards/issues need pairing.
 */
router.post('/:id/sync-existing', async (req, res) => {
  const ruleId = Number(req.params.id);
  if (!ruleId || Number.isNaN(ruleId)) {
    return res.status(400).json({ error: 'Rule id must be a number.' });
  }

  try {
    const rule = await dbGet('SELECT * FROM sync_rules WHERE id = ?', [ruleId]);
    if (!rule) {
      return res.status(404).json({ error: 'Sync rule not found.' });
    }

    const envFromReq =
      req.query.environmentId ||
      req.query.environment_id ||
      req.headers['x-environment-id'] ||
      req.body?.environmentId ||
      req.body?.environment_id;

    if (envFromReq && Number(rule.environment_id) !== Number(envFromReq)) {
      return res.status(403).json({
        error: 'Rule does not belong to the specified environment.',
      });
    }

    const credentials = await loadEnvironmentCredentials(rule.environment_id);
    const result = await syncExistingItemsForRule(credentials, rule);
    // Only user-visible outcomes (migrated items) appear in the dashboard activity log.
    appendSyncResultActivity(rule.environment_id, result, { source: 'sync-existing' });

    res.json({
      ok: true,
      ruleId,
      direction: result.direction,
      migrated: result.migrated,
      details: result.details,
      message: `Sync existing complete: ${result.migrated} item(s) migrated.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const ruleId = Number(req.params.id);
  if (!ruleId || Number.isNaN(ruleId)) {
    return res.status(400).json({ error: 'Rule id must be a number.' });
  }

  const {
    name,
    direction,
    environmentId,
    environment_id,
    trello_board_id,
    trello_source_column_id,
    jira_project_id,
    jira_board_id,
    jira_target_column_id,
  } = req.body;

  try {
    const existing = await dbGet('SELECT * FROM sync_rules WHERE id = ?', [ruleId]);
    if (!existing) {
      return res.status(404).json({ error: 'Sync rule not found.' });
    }

    const envId = environmentId ?? environment_id;
    if (envId && Number(existing.environment_id) !== Number(envId)) {
      return res.status(403).json({
        error: 'Rule does not belong to the specified environment.',
      });
    }

    let resolvedDirection = null;
    if (direction !== undefined) {
      const directionResult = parseSyncDirection(direction, { required: true });
      if (directionResult.error) {
        return res.status(400).json({ error: directionResult.error });
      }
      resolvedDirection = directionResult.direction;
    }

    await dbRun(
      `UPDATE sync_rules SET
        name = COALESCE(?, name),
        trello_board_id = COALESCE(?, trello_board_id),
        trello_source_column_id = COALESCE(?, trello_source_column_id),
        jira_project_id = COALESCE(?, jira_project_id),
        jira_board_id = COALESCE(?, jira_board_id),
        jira_target_column_id = COALESCE(?, jira_target_column_id),
        direction = COALESCE(?, direction)
      WHERE id = ?`,
      [
        name != null && String(name).trim() ? String(name).trim() : null,
        trello_board_id ?? null,
        trello_source_column_id ?? null,
        jira_project_id ?? null,
        jira_board_id ?? null,
        jira_target_column_id ?? null,
        resolvedDirection,
        ruleId,
      ]
    );

    const row = formatSyncRule(
      await dbGet('SELECT * FROM sync_rules WHERE id = ?', [ruleId])
    );
    scheduleWebhookRegistration(existing.environment_id);
    res.json({ ok: true, rule: row, message: 'Sync rule updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const ruleId = Number(req.params.id);
  if (!ruleId || Number.isNaN(ruleId)) {
    return res.status(400).json({ error: 'Rule id must be a number.' });
  }

  try {
    const existing = await dbGet('SELECT * FROM sync_rules WHERE id = ?', [ruleId]);
    if (!existing) {
      return res.status(404).json({ error: 'Sync rule not found.' });
    }

    const envFromReq =
      req.query.environmentId ||
      req.query.environment_id ||
      req.headers['x-environment-id'];
    if (envFromReq && Number(existing.environment_id) !== Number(envFromReq)) {
      return res.status(403).json({
        error: 'Rule does not belong to the specified environment.',
      });
    }

    await dbRun('DELETE FROM sync_rules WHERE id = ?', [ruleId]);
    res.json({ ok: true, message: 'Sync rule deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
