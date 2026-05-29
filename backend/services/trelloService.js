/**
 * Trello REST API client and board/card operations.
 */

import axios from 'axios';

export const JIRA_ISSUE_MARKER = (issueKey) => `jira-issue:${issueKey}`;

function trelloQuery(credentials, extra = {}) {
  return {
    key: credentials.trello_api_key,
    token: credentials.trello_token,
    ...extra,
  };
}

export async function trelloGet(credentials, path, params = {}) {
  const { data } = await axios.get(`https://api.trello.com/1${path}`, {
    params: trelloQuery(credentials, params),
  });
  return data;
}

export async function trelloPost(credentials, path, body = {}) {
  const { data } = await axios.post(`https://api.trello.com/1${path}`, body, {
    params: trelloQuery(credentials),
  });
  return data;
}

export async function trelloPut(credentials, path, body = {}) {
  const { data } = await axios.put(`https://api.trello.com/1${path}`, body, {
    params: trelloQuery(credentials),
  });
  return data;
}

export async function trelloDelete(credentials, path) {
  const { data } = await axios.delete(`https://api.trello.com/1${path}`, {
    params: trelloQuery(credentials),
  });
  return data;
}

export async function fetchTrelloBoardsWithLists(credentials) {
  const boards = await trelloGet(credentials, '/members/me/boards', {
    fields: 'id,name',
    filter: 'open',
  });

  const result = [];
  for (const board of boards) {
    const lists = await trelloGet(credentials, `/boards/${board.id}/lists`, {
      fields: 'id,name',
      filter: 'open',
    });
    result.push({
      id: board.id,
      name: board.name,
      lists: lists.map((list) => ({ id: list.id, name: list.name })),
    });
  }
  return result;
}

export async function fetchTrelloBoardCards(credentials, boardId) {
  return trelloGet(credentials, `/boards/${boardId}/cards`, {
    fields: 'id,name,desc,idList,url,shortUrl',
    filter: 'open',
  });
}

export async function fetchTrelloCard(credentials, cardId) {
  return trelloGet(credentials, `/cards/${cardId}`, {
    fields: 'id,name,desc,idList,idBoard,url,shortUrl',
  });
}

export async function deleteTrelloWebhook(credentials, webhookId) {
  return trelloDelete(credentials, `/webhooks/${webhookId}`);
}

export function trelloCardMatchesJiraIssue(card, issueKey, issueSummary) {
  const marker = JIRA_ISSUE_MARKER(issueKey);
  const desc = card.desc || '';
  const name = (card.name || '').trim();
  const key = String(issueKey).trim();

  if (desc.includes(marker)) return true;
  if (desc.includes(key) || name.includes(key)) return true;

  const summary = (issueSummary || '').trim();
  if (summary && name.toLowerCase() === summary.toLowerCase()) return true;

  return false;
}

export async function fetchTrelloListCards(credentials, listId) {
  return trelloGet(credentials, `/lists/${listId}/cards`, {
    fields: 'id,name,desc,idList,url,shortUrl',
    filter: 'open',
  });
}

export async function fetchTrelloListName(credentials, listId) {
  if (!listId) return null;
  const list = await trelloGet(credentials, `/lists/${listId}`, {
    fields: 'name',
  });
  return list?.name ?? null;
}

export async function findTrelloCardByJiraIssue(credentials, boardId, issueKey) {
  const cards = await fetchTrelloBoardCards(credentials, boardId);
  return (
    cards.find((card) => trelloCardMatchesJiraIssue(card, issueKey)) ?? null
  );
}

export async function findTrelloCardInListByJiraIssue(
  credentials,
  listId,
  issueKey,
  issueSummary
) {
  const cards = await fetchTrelloListCards(credentials, listId);
  return (
    cards.find((card) => trelloCardMatchesJiraIssue(card, issueKey, issueSummary)) ??
    null
  );
}

export async function createTrelloCardFromIssue(
  credentials,
  listId,
  issue,
  plainDescription
) {
  const marker = JIRA_ISSUE_MARKER(issue.key);
  const issueUrl = `${credentials.jira_domain}/browse/${issue.key}`;
  const desc = [
    plainDescription,
    '',
    `Synced from Jira: ${issueUrl}`,
    marker,
  ]
    .filter((line, index, arr) => !(line === '' && index === arr.length - 1))
    .join('\n')
    .trim();

  return trelloPost(credentials, '/cards', {
    idList: listId,
    name: issue.summary || issue.key,
    desc,
  });
}

export async function moveTrelloCardToList(credentials, cardId, listId) {
  return trelloPut(credentials, `/cards/${cardId}`, { idList: listId });
}
