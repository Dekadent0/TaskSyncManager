export function formatSyncDetail(d) {
  if (d.error) {
    const title =
      d.jiraIssueSummary ||
      d.jiraIssueKey ||
      d.trelloCardName ||
      d.trelloCardId ||
      'Task';
    return `Failed: ${title} — ${d.error}`;
  }

  if (d.direction === 'jira-to-trello') {
    const title = d.jiraIssueSummary || d.jiraIssueKey || 'Issue';
    const card = d.trelloCardName ? ` → '${d.trelloCardName}'` : '';
    if (d.action === 'created') {
      return `Created in Trello: ${title}${card}`;
    }
    if (d.action === 'moved') {
      return `Moved to Trello list: ${title}${card}`;
    }
    if (d.action === 'already_in_target') {
      return `Already in target list: ${title}${card}`;
    }
    return `Processed in Trello: ${title}${card}`;
  }

  const title = d.trelloCardName ? `'${d.trelloCardName}'` : 'Task';
  const key = d.jiraIssueKey ? ` (${d.jiraIssueKey})` : '';
  if (d.action === 'created') {
    return `Created in Jira: ${title}${key}`;
  }
  if (d.action === 'transitioned' || d.action === 'transitioned_after_create') {
    return `Moved to Jira: ${title}${key}`;
  }
  if (d.action === 'already_in_target') {
    return `Already in target column: ${title}${key}`;
  }
  return `Processed: ${title}${key}`;
}

export function buildSyncLogLines(result) {
  const lines = [];
  const details = result.details ?? [];

  if (result.message) {
    lines.push(result.message);
  }

  if (details.length === 0 && (result.synced ?? 0) === 0) {
    lines.push('No matching tasks in mapped source columns.');
    return lines;
  }

  const count = result.synced ?? details.filter((d) => !d.error).length;
  lines.push(`Processed ${count} task(s).`);

  for (const d of details) {
    lines.push(formatSyncDetail(d));
  }

  return lines;
}
