/**
 * Trello/Jira proxy routes, legacy settings, health check, and manual sync.
 */

import { Router } from 'express';
import { dbGet, dbRun } from '../db.js';
import { normalizeJiraDomain } from '../utils/domains.js';
import { getEnvironmentIdFromRequest } from '../utils/requestContext.js';
import { loadEnvironmentCredentials } from '../services/environmentService.js';
import {
  fetchTrelloBoardsWithLists,
  fetchTrelloBoardCards,
} from '../services/trelloService.js';
import {
  fetchJiraProjects,
  fetchJiraBoardsWithColumns,
  fetchJiraBoardIssues,
} from '../services/jiraService.js';
import { runManualSync } from '../services/syncEngine.js';
import { appendSyncResultActivity } from '../services/syncActivityLog.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

router.post('/settings', async (req, res) => {
  const {
    trello_api_key,
    trello_token,
    jira_domain,
    jira_email,
    jira_api_token,
  } = req.body;

  try {
    const existing = await dbGet('SELECT * FROM credentials WHERE id = 1');

    if (existing) {
      await dbRun(
        `UPDATE credentials SET
          trello_api_key = ?,
          trello_token = COALESCE(NULLIF(?, ''), trello_token),
          jira_domain = ?,
          jira_email = ?,
          jira_api_token = COALESCE(NULLIF(?, ''), jira_api_token),
          updated_at = datetime('now')
        WHERE id = 1`,
        [
          trello_api_key ?? existing.trello_api_key,
          trello_token ?? '',
          normalizeJiraDomain(jira_domain ?? existing.jira_domain),
          jira_email ?? existing.jira_email,
          jira_api_token ?? '',
        ]
      );
    } else {
      await dbRun(
        `INSERT INTO credentials (
          id, trello_api_key, trello_token, jira_domain, jira_email, jira_api_token
        ) VALUES (1, ?, ?, ?, ?, ?)`,
        [
          trello_api_key ?? '',
          trello_token ?? '',
          normalizeJiraDomain(jira_domain ?? ''),
          jira_email ?? '',
          jira_api_token ?? '',
        ]
      );
    }

    res.json({ ok: true, message: 'Credentials saved.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/trello/boards/:boardId/cards', async (req, res) => {
  try {
    const environmentId = getEnvironmentIdFromRequest(req);
    const credentials = await loadEnvironmentCredentials(environmentId);
    const cards = await fetchTrelloBoardCards(credentials, req.params.boardId);
    res.json(cards);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      error: err.response?.data || err.message,
    });
  }
});

router.get('/trello/boards', async (req, res) => {
  try {
    const environmentId = getEnvironmentIdFromRequest(req);
    const credentials = await loadEnvironmentCredentials(environmentId);
    const boards = await fetchTrelloBoardsWithLists(credentials);
    res.json(boards);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      error: err.response?.data || err.message,
    });
  }
});

router.get('/jira/boards/:boardId/issues', async (req, res) => {
  try {
    const environmentId = getEnvironmentIdFromRequest(req);
    const credentials = await loadEnvironmentCredentials(environmentId);
    const issues = await fetchJiraBoardIssues(credentials, req.params.boardId);
    res.json(issues);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      error: err.response?.data || err.message,
    });
  }
});

router.get('/jira/projects', async (req, res) => {
  try {
    const environmentId = getEnvironmentIdFromRequest(req);
    const credentials = await loadEnvironmentCredentials(environmentId);
    const projects = await fetchJiraProjects(credentials);
    res.json(projects);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      error: err.response?.data || err.message,
    });
  }
});

router.get('/jira/boards', async (req, res) => {
  try {
    const environmentId = getEnvironmentIdFromRequest(req);
    const credentials = await loadEnvironmentCredentials(environmentId);
    const boards = await fetchJiraBoardsWithColumns(credentials);
    res.json(boards);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      error: err.response?.data || err.message,
    });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const envFromBody = req.body?.environmentId ?? req.body?.environment_id;
    let environmentId = envFromBody;
    if (!environmentId) {
      environmentId = getEnvironmentIdFromRequest(req);
    }

    const credentials = await loadEnvironmentCredentials(environmentId);
    const result = await runManualSync(credentials, environmentId);
    appendSyncResultActivity(environmentId, result, { source: 'manual' });
    res.json(result);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      error: err.response?.data || err.message,
    });
  }
});

export default router;
