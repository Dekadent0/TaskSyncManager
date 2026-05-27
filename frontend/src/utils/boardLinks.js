/** Strip trailing slashes from Jira Cloud base URL. */
export function normalizeJiraDomain(domain) {
  return String(domain || '').trim().replace(/\/+$/, '');
}

export function getTrelloBoardUrl(boardId) {
  if (!boardId) return null;
  return `https://trello.com/b/${boardId}`;
}

/** Open a Trello card in the browser (prefers API shortUrl/url). */
export function getTrelloCardUrl(card) {
  if (!card) return null;
  if (card.shortUrl) return card.shortUrl;
  if (card.url) return card.url;
  if (card.id) return `https://trello.com/c/${card.id}`;
  return null;
}

/** Open a Jira issue in the browser. */
export function getJiraIssueUrl(jiraDomain, issue) {
  const base = normalizeJiraDomain(jiraDomain);
  if (!base || !issue?.key) return null;
  return `${base}/browse/${issue.key}`;
}

/**
 * Open the active Jira board in the browser.
 * Prefers project-scoped URL when projectKey is known; otherwise uses Atlassian goto.
 */
export function getJiraBoardUrl(jiraDomain, board) {
  const base = normalizeJiraDomain(jiraDomain);
  if (!base || !board?.id) return null;

  if (board.projectKey) {
    return `${base}/jira/software/c/projects/${board.projectKey}/boards/${board.id}`;
  }
  return `${base}/goto/atlassian/jira/board/${board.id}`;
}
