/**
 * Jira REST / Agile API client and issue/board operations.
 */

import axios from 'axios';
import { normalizeJiraDomain } from '../utils/domains.js';

export const TRELLO_CARD_MARKER = (cardId) => `trello-card:${cardId}`;

export function jiraAuthConfig(credentials) {
  const token = Buffer.from(
    `${credentials.jira_email}:${credentials.jira_api_token}`
  ).toString('base64');
  return {
    baseURL: normalizeJiraDomain(credentials.jira_domain),
    headers: {
      Authorization: `Basic ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  };
}

function formatJiraColumnLabel(columnName, statusName) {
  const col = (columnName || 'Column').trim();
  const status = (statusName || '').trim();

  if (!status || col.toLowerCase() === status.toLowerCase()) {
    return col;
  }
  return `${col} — ${status}`;
}

async function fetchAllJiraProjectSummaries(client) {
  const pageSize = 50;
  const collected = [];
  let startAt = 0;

  for (;;) {
    const { data } = await client.get('/rest/api/3/project/search', {
      params: { startAt, maxResults: pageSize },
    });

    const batch = data.values ?? [];
    collected.push(...batch);

    if (data.isLast === true || batch.length === 0) {
      break;
    }
    startAt += batch.length;
  }

  if (collected.length > 0) {
    return collected;
  }

  const { data: listResponse } = await client.get('/rest/api/3/project', {
    params: { maxResults: pageSize, startAt: 0 },
  });

  if (Array.isArray(listResponse)) {
    return listResponse;
  }

  const fromList = listResponse?.values ?? [];
  if (fromList.length > 0) {
    return fromList;
  }

  return [];
}

async function fetchAllAgileBoards(client) {
  const pageSize = 50;
  const collected = [];
  let startAt = 0;

  for (;;) {
    const { data } = await client.get('/rest/agile/1.0/board', {
      params: { startAt, maxResults: pageSize },
    });

    const batch = data.values ?? [];
    collected.push(...batch);

    if (data.isLast === true || batch.length === 0) {
      break;
    }
    startAt += batch.length;
  }

  return collected;
}

async function fetchProjectStatusColumns(client, projectId) {
  const { data: statusesByType } = await client.get(
    `/rest/api/3/project/${projectId}/statuses`
  );
  const seen = new Map();
  for (const block of statusesByType) {
    for (const status of block.statuses ?? []) {
      if (!seen.has(status.id)) {
        seen.set(status.id, { id: status.id, name: status.name });
      }
    }
  }
  return [...seen.values()];
}

async function fetchJiraBoardColumns(client, boardId, projectId) {
  const { data } = await client.get(
    `/rest/agile/1.0/board/${boardId}/configuration`
  );

  const statusNameById = new Map();
  if (projectId) {
    try {
      const projectStatuses = await fetchProjectStatusColumns(client, projectId);
      for (const s of projectStatuses) {
        statusNameById.set(String(s.id), s.name);
      }
    } catch {
      // Fall back to column names only.
    }
  }

  const columns = [];
  const seen = new Set();

  for (const col of data.columnConfig?.columns ?? []) {
    for (const status of col.statuses ?? []) {
      const statusId = status.id;
      if (!statusId || seen.has(statusId)) continue;

      seen.add(statusId);
      const resolvedStatusName =
        status.name ||
        status.statusName ||
        statusNameById.get(String(statusId)) ||
        '';

      columns.push({
        id: statusId,
        name: formatJiraColumnLabel(col.name, resolvedStatusName),
        columnName: col.name,
        statusName: resolvedStatusName || col.name,
      });
    }
  }

  return columns;
}

export async function fetchJiraProjects(credentials) {
  const client = axios.create(jiraAuthConfig(credentials));
  const summaries = await fetchAllJiraProjectSummaries(client);
  return summaries.map((project) => ({
    id: project.id,
    key: project.key,
    name: project.name,
  }));
}

export async function fetchJiraBoardsWithColumns(credentials) {
  const client = axios.create(jiraAuthConfig(credentials));
  const agileBoards = await fetchAllAgileBoards(client);

  const boards = [];
  for (const board of agileBoards) {
    const projectId = board.location?.projectId;
    const projectKey = board.location?.projectKey;
    const projectName = board.location?.projectName ?? board.location?.name;

    let columns = [];
    try {
      columns = await fetchJiraBoardColumns(client, board.id, projectId);
    } catch {
      if (projectId) {
        try {
          columns = await fetchProjectStatusColumns(client, projectId);
        } catch {
          columns = [];
        }
      }
    }

    boards.push({
      id: board.id,
      name: board.name,
      type: board.type,
      projectId,
      projectKey,
      projectName,
      columns,
    });
  }

  return boards;
}

export async function fetchJiraBoardIssues(credentials, boardId) {
  const client = axios.create(jiraAuthConfig(credentials));
  const collected = [];
  let startAt = 0;
  const maxResults = 50;

  for (;;) {
    const { data } = await client.get(`/rest/agile/1.0/board/${boardId}/issue`, {
      params: {
        startAt,
        maxResults,
        fields: 'summary,status',
      },
    });

    const batch = data.issues ?? [];
    collected.push(...batch);

    if (data.isLast === true || batch.length === 0) {
      break;
    }
    startAt += batch.length;
  }

  return collected.map((issue) => ({
    id: issue.id,
    key: issue.key,
    summary: issue.fields?.summary ?? issue.key,
    statusId: issue.fields?.status?.id,
    statusName: issue.fields?.status?.name,
  }));
}

export async function findJiraIssueByTrelloCard(credentials, projectKey, cardId) {
  const client = axios.create(jiraAuthConfig(credentials));
  const marker = TRELLO_CARD_MARKER(cardId);
  const jql = `project = "${projectKey}" AND description ~ "${marker}"`;

  const { data } = await client.post('/rest/api/3/search/jql', {
    jql,
    maxResults: 1,
    fields: ['summary', 'status'],
  });

  return data.issues?.[0] ?? null;
}

async function getDefaultIssueType(credentials, projectId) {
  const client = axios.create(jiraAuthConfig(credentials));
  const { data } = await client.get('/rest/api/3/issue/createmeta', {
    params: {
      projectIds: projectId,
      expand: 'projects.issuetypes',
    },
  });

  const project = data.projects?.[0];
  const issueType = project?.issuetypes?.[0];
  if (!issueType) {
    throw new Error(`No issue types found for Jira project ${projectId}`);
  }
  return issueType;
}

export async function createJiraIssueFromCard(credentials, project, card) {
  const client = axios.create(jiraAuthConfig(credentials));
  const issueType = await getDefaultIssueType(credentials, project.id);
  const marker = TRELLO_CARD_MARKER(card.id);
  const description = [
    card.desc || '',
    '',
    `Synced from Trello: ${card.shortUrl || card.url || ''}`,
    marker,
  ]
    .join('\n')
    .trim();

  const { data } = await client.post('/rest/api/3/issue', {
    fields: {
      project: { key: project.key },
      summary: card.name,
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: description }],
          },
        ],
      },
      issuetype: { id: issueType.id },
    },
  });

  return data;
}

export async function transitionJiraIssueToStatus(
  credentials,
  issueKey,
  targetStatusId
) {
  const client = axios.create(jiraAuthConfig(credentials));

  const { data: transitions } = await client.get(
    `/rest/api/3/issue/${issueKey}/transitions`
  );

  const match = (transitions.transitions ?? []).find(
    (t) => String(t.to?.id) === String(targetStatusId)
  );

  if (!match) {
    throw new Error(
      `No transition to status ${targetStatusId} for issue ${issueKey}`
    );
  }

  await client.post(`/rest/api/3/issue/${issueKey}/transitions`, {
    transition: { id: match.id },
  });
}

export function jiraDescriptionToPlainText(description) {
  if (!description) return '';
  if (typeof description === 'string') return description.trim();

  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === 'text' && node.text) parts.push(node.text);
    for (const child of node.content ?? []) walk(child);
  };
  walk(description);
  return parts.join('').trim();
}

export async function fetchJiraIssueDetails(credentials, issueKey) {
  const client = axios.create(jiraAuthConfig(credentials));
  const { data } = await client.get(`/rest/api/3/issue/${issueKey}`, {
    params: { fields: 'summary,description,status' },
  });

  return {
    id: data.id,
    key: data.key,
    summary: data.fields?.summary ?? data.key,
    description: data.fields?.description,
    statusId: data.fields?.status?.id,
    statusName: data.fields?.status?.name,
  };
}
