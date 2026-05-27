/**
 * Environment CRUD and aggregated data fetch routes.
 */

import { Router } from 'express';
import { dbGet, dbAll, dbRun } from '../db.js';
import { normalizeJiraDomain } from '../utils/domains.js';
import { fetchAllEnvironmentData } from '../services/environmentService.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const rows = await dbAll(
      `SELECT id, name, trello_key, trello_token, jira_domain, jira_email, jira_token,
              created_at, updated_at
       FROM environments
       ORDER BY id`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const {
    name,
    trello_key,
    trello_token,
    jira_domain,
    jira_email,
    jira_token,
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Environment name is required.' });
  }

  try {
    const result = await dbRun(
      `INSERT INTO environments (
        name, trello_key, trello_token, jira_domain, jira_email, jira_token
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name,
        trello_key ?? '',
        trello_token ?? '',
        normalizeJiraDomain(jira_domain ?? ''),
        jira_email ?? '',
        jira_token ?? '',
      ]
    );

    const row = await dbGet(
      `SELECT id, name, trello_key, trello_token, jira_domain, jira_email, jira_token,
              created_at, updated_at
       FROM environments WHERE id = ?`,
      [result.lastID]
    );
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

  const {
    name,
    trello_key,
    trello_token,
    jira_domain,
    jira_email,
    jira_token,
  } = req.body;

  try {
    const existing = await dbGet('SELECT * FROM environments WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Environment not found.' });
    }

    await dbRun(
      `UPDATE environments SET
        name = COALESCE(NULLIF(?, ''), name),
        trello_key = COALESCE(NULLIF(?, ''), trello_key),
        trello_token = COALESCE(NULLIF(?, ''), trello_token),
        jira_domain = COALESCE(NULLIF(?, ''), jira_domain),
        jira_email = COALESCE(NULLIF(?, ''), jira_email),
        jira_token = COALESCE(NULLIF(?, ''), jira_token),
        updated_at = datetime('now')
      WHERE id = ?`,
      [
        name ?? existing.name,
        trello_key ?? '',
        trello_token ?? '',
        jira_domain ? normalizeJiraDomain(jira_domain) : '',
        jira_email ?? '',
        jira_token ?? '',
        id,
      ]
    );

    const row = await dbGet(
      `SELECT id, name, trello_key, trello_token, jira_domain, jira_email, jira_token,
              created_at, updated_at
       FROM environments WHERE id = ?`,
      [id]
    );
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
      `SELECT id, name, trello_key, trello_token, jira_domain, jira_email, jira_token,
              created_at, updated_at
       FROM environments WHERE id = ?`,
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

    await dbRun('DELETE FROM sync_rules WHERE environment_id = ?', [id]);
    await dbRun('DELETE FROM environments WHERE id = ?', [id]);

    res.json({ ok: true, message: 'Environment deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
