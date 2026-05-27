/**
 * Trello REST API client and board/card operations.
 */

import axios from 'axios';

export const JIRA_ISSUE_MARKER = (issueKey) => `jira-issue:${issueKey}`;

function trelloQuery(credentials, extra = {}) {
  return {
    key: credentials.trello_key,
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

export async function findTrelloCardByJiraIssue(credentials, boardId, issueKey) {
  const cards = await fetchTrelloBoardCards(credentials, boardId);
  const marker = JIRA_ISSUE_MARKER(issueKey);
  return cards.find((card) => (card.desc || '').includes(marker)) ?? null;
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
