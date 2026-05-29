/**
 * Environment CRUD and aggregated data fetch routes.
 */

import { Router } from 'express';
import { dbGet, dbAll, dbRun } from '../db.js';
import { normalizeJiraDomain } from '../utils/domains.js';
import {
  parseEnvironmentCredentialsBody,
  ENV_SELECT_COLUMNS,
} from '../utils/envCredentials.js';
import { fetchAllEnvironmentData } from '../services/environmentService.js';
import {
  scheduleWebhookRegistration,
  deleteWebhooksForEnvironment,
} from '../services/webhookRegistrationService.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const rows = await dbAll(
      `SELECT ${ENV_SELECT_COLUMNS} FROM environments ORDER BY id`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  const creds = parseEnvironmentCredentialsBody(req.body);

  if (!name) {
    return res.status(400).json({ error: 'Environment name is required.' });
  }

  try {
    const result = await dbRun(
      `INSERT INTO environments (
        name, trello_api_key, trello_token, jira_domain, jira_email, jira_api_token
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name,
        creds.trello_api_key,
        creds.trello_token,
        normalizeJiraDomain(creds.jira_domain),
        creds.jira_email,
        creds.jira_api_token,
      ]
    );

    const row = await dbGet(
      `SELECT ${ENV_SELECT_COLUMNS} FROM environments WHERE id = ?`,
      [result.lastID]
    );
    scheduleWebhookRegistration(result.lastID);

    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/fetch-all', async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ error: 'Environment id must be a number.' });
  }

  try {
    const data = await fetchAllEnvironmentData(id);
    scheduleWebhookRegistration(id);
    res.json(data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      error: err.response?.data || err.message,
    });
  }
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ error: 'Environment id must be a number.' });
  }

  const { name } = req.body;
  const creds = parseEnvironmentCredentialsBody(req.body);

  try {
    const existing = await dbGet('SELECT * FROM environments WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Environment not found.' });
    }

    await dbRun(
      `UPDATE environments SET
        name = COALESCE(NULLIF(?, ''), name),
        trello_api_key = COALESCE(NULLIF(?, ''), trello_api_key),
        trello_token = COALESCE(NULLIF(?, ''), trello_token),
        jira_domain = COALESCE(NULLIF(?, ''), jira_domain),
        jira_email = COALESCE(NULLIF(?, ''), jira_email),
        jira_api_token = COALESCE(NULLIF(?, ''), jira_api_token),
        updated_at = datetime('now')
      WHERE id = ?`,
      [
        name ?? existing.name,
        creds.trello_api_key,
        creds.trello_token,
        creds.jira_domain ? normalizeJiraDomain(creds.jira_domain) : '',
        creds.jira_email,
        creds.jira_api_token,
        id,
      ]
    );

    const row = await dbGet(
      `SELECT ${ENV_SELECT_COLUMNS} FROM environments WHERE id = ?`,
      [id]
    );
    scheduleWebhookRegistration(id);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ error: 'Environment id must be a number.' });
  }

  try {
    const row = await dbGet(
      `SELECT ${ENV_SELECT_COLUMNS} FROM environments WHERE id = ?`,
      [id]
    );
    if (!row) {
      return res.status(404).json({ error: 'Environment not found.' });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    return res.status(400).json({ error: 'Environment id must be a number.' });
  }

  try {
    const existing = await dbGet('SELECT id FROM environments WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Environment not found.' });
    }

    await deleteWebhooksForEnvironment(id);
    await dbRun('DELETE FROM sync_rules WHERE environment_id = ?', [id]);
    await dbRun(
      'DELETE FROM webhook_registrations WHERE environment_id = ?',
      [id]
    );
    await dbRun('DELETE FROM environments WHERE id = ?', [id]);

    res.json({ ok: true, message: 'Environment deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
