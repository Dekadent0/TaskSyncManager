/**
 * Trello/Jira proxy routes for the dashboard viewers.
 */

import { Router } from 'express';
import { getEnvironmentIdFromRequest } from '../utils/requestContext.js';
import { loadEnvironmentCredentials } from '../services/environmentService.js';
import { fetchTrelloBoardCards } from '../services/trelloService.js';
import { fetchJiraBoardIssues } from '../services/jiraService.js';

const router = Router();

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

export default router;
