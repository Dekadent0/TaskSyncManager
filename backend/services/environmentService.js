/**
 * Environment credentials loading and aggregated data fetch.
 */

import { dbGet } from '../db.js';
import { normalizeJiraDomain } from '../utils/domains.js';
import { fetchTrelloBoardsWithLists } from './trelloService.js';
import { fetchJiraProjects, fetchJiraBoardsWithColumns } from './jiraService.js';

export { normalizeJiraDomain };

export async function loadEnvironmentCredentials(environmentId) {
  const env = await dbGet('SELECT * FROM environments WHERE id = ?', [
    environmentId,
  ]);
  if (!env) {
    throw new Error(`Environment ${environmentId} not found.`);
  }
  if (!env.trello_api_key || !env.trello_token) {
    throw new Error(
      `Trello credentials are missing for environment ${environmentId}.`
    );
  }
  if (!env.jira_domain || !env.jira_email || !env.jira_api_token) {
    throw new Error(
      `Jira credentials are missing for environment ${environmentId}.`
    );
  }

  return {
    trello_api_key: env.trello_api_key,
    trello_token: env.trello_token,
    jira_domain: normalizeJiraDomain(env.jira_domain),
    jira_email: env.jira_email,
    jira_api_token: env.jira_api_token,
  };
}

export async function fetchAllEnvironmentData(environmentId) {
  const credentials = await loadEnvironmentCredentials(environmentId);
  const [trelloBoards, jiraProjects, jiraBoards] = await Promise.all([
    fetchTrelloBoardsWithLists(credentials),
    fetchJiraProjects(credentials),
    fetchJiraBoardsWithColumns(credentials),
  ]);
  return { trelloBoards, jiraProjects, jiraBoards };
}
