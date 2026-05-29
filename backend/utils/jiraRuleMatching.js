/**
 * Flexible Jira status / project matching for sync rules (ID or name, normalized).
 */

export function normalizeJiraCompareValue(value) {
  if (value == null || value === '') return '';
  return String(value).toLowerCase().trim();
}

function resolveBoardForRule(rule, jiraBoards) {
  let board = rule.jira_board_id
    ? jiraBoards.find((b) => String(b.id) === String(rule.jira_board_id))
    : null;

  if (!board && rule.jira_project_id) {
    board = jiraBoards.find(
      (b) =>
        String(b.projectId) === String(rule.jira_project_id) ||
        String(b.projectKey) === String(rule.jira_project_id)
    );
  }

  return board;
}

/**
 * Rule's jira_project_id may be project id, key, or related board reference.
 */
export function ruleMatchesJiraProject(rule, projectKey, jiraBoards = []) {
  if (!projectKey) return false;

  const ruleProj = normalizeJiraCompareValue(rule.jira_project_id);
  const incoming = normalizeJiraCompareValue(projectKey);

  if (ruleProj && (ruleProj === incoming)) return true;

  const board = resolveBoardForRule(rule, jiraBoards);
  if (!board) return false;

  return (
    normalizeJiraCompareValue(board.projectKey) === incoming ||
    normalizeJiraCompareValue(board.projectId) === ruleProj
  );
}

/**
 * Match rule source status against webhook/API status by ID and/or name.
 */
export function ruleMatchesIncomingJiraStatus(
  rule,
  incomingStatusId,
  incomingStatusName,
  jiraBoards = []
) {
  const ruleStored = normalizeJiraCompareValue(rule.jira_target_column_id);
  const incomingId = normalizeJiraCompareValue(incomingStatusId);
  const incomingName = normalizeJiraCompareValue(incomingStatusName);

  if (!ruleStored) return false;

  if (ruleStored === incomingId || ruleStored === incomingName) {
    return true;
  }

  const board = resolveBoardForRule(rule, jiraBoards);
  if (!board?.columns?.length) {
    return false;
  }

  const columnForRule = board.columns.find((col) => {
    const colId = normalizeJiraCompareValue(col.id);
    const colName = normalizeJiraCompareValue(col.name);
    const statusName = normalizeJiraCompareValue(col.statusName);
    const columnName = normalizeJiraCompareValue(col.columnName);

    return (
      ruleStored === colId ||
      ruleStored === colName ||
      ruleStored === statusName ||
      ruleStored === columnName
    );
  });

  if (!columnForRule) {
    return false;
  }

  const resolvedId = normalizeJiraCompareValue(columnForRule.id);
  const resolvedStatusName = normalizeJiraCompareValue(columnForRule.statusName);
  const resolvedLabel = normalizeJiraCompareValue(columnForRule.name);

  return (
    resolvedId === incomingId ||
    resolvedStatusName === incomingName ||
    resolvedLabel === incomingName ||
    (incomingName && resolvedLabel.includes(incomingName))
  );
}
