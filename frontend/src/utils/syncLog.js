const SKIP_ACTIONS = new Set([
  'already_in_target',
  'skipped_not_in_source_list',
  'skipped_not_in_source_status',
  'skipped_list_sync_in_progress',
  'skipped_status_sync_in_progress',
  'skipped_duplicate_after_lock',
  'skipped_already_mapped',
  'skipped_already_in_trello',
  'skipped_already_in_jira',
  'bulk_issue_sync_failed',
  'bulk_fetch_failed',
  'bulk_fetch_failed_fallback',
  'bulk_and_fallback_failed',
]);

function looksLikeInternalId(value) {
  if (value == null || value === '') return true;
  const text = String(value).trim();
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (/^[a-f0-9]{8,}$/i.test(text)) return true;
  return false;
}

function formatLocationLabel(name) {
  if (looksLikeInternalId(name)) return '';
  return String(name).trim();
}

function taskSummary(detail) {
  if (detail.direction === 'jira-to-trello') {
    return (
      detail.jiraIssueSummary ||
      detail.trelloCardName ||
      detail.jiraIssueKey ||
      'Task'
    );
  }

  return (
    detail.trelloCardName ||
    detail.jiraIssueSummary ||
    detail.jiraIssueKey ||
    'Task'
  );
}

function formatUserActivityMessage(detail) {
  if (detail.error) {
    const name = taskSummary(detail);
    const destination = detail.direction === 'jira-to-trello' ? 'Trello' : 'Jira';
    return `Couldn't sync to ${destination}: ${name}`;
  }

  const summary = taskSummary(detail);
  const locationName = formatLocationLabel(
    detail.targetListName || detail.targetColumnName
  );
  const location = locationName ? ` (${locationName})` : '';

  if (detail.direction === 'jira-to-trello') {
    if (detail.action === 'created' || detail.action === 'migrated') {
      return `Created card in Trello${location}: ${summary}`;
    }
    if (detail.action === 'moved') {
      return `Moved card to Trello${location}: ${summary}`;
    }
    return `Updated card in Trello${location}: ${summary}`;
  }

  if (
    detail.action === 'created' ||
    detail.action === 'transitioned_after_create' ||
    detail.action === 'recreated_after_deleted' ||
    detail.action === 'migrated'
  ) {
    return `Synced task to Jira${location}: ${summary}`;
  }

  if (detail.action === 'transitioned' || detail.action === 'moved') {
    return `Moved issue to Jira${location}: ${summary}`;
  }

  return `Updated in Jira${location}: ${summary}`;
}

function isLoggableActivityEntry(entry) {
  if (!entry) return false;
  if (entry.status === 'skipped' || entry.status === 'info') return false;

  if (entry.message && !entry.detail) {
    const message = entry.message.trim();
    if (!message) return false;
    if (/^no (matching|sync rule|rule for)/i.test(message)) return false;
    if (/^ignored /i.test(message)) return false;
    if (/^duplicate trello/i.test(message)) return false;
    if (/^skipped /i.test(message)) return false;
    if (/already in target/i.test(message)) return false;
    if (/failed:/i.test(message) && /—/.test(message)) return false;
    if (/processed:/i.test(message)) return false;
    return entry.status === 'error' || !/^(no |ignored|duplicate|skipped)/i.test(message);
  }

  if (!entry.detail) return false;

  const detail = entry.detail;
  if (detail.error) {
    return Boolean(
      detail.trelloCardName ||
        detail.jiraIssueSummary ||
        detail.jiraIssueKey ||
        detail.trelloCardId
    );
  }

  const action = detail.action ?? '';
  if (SKIP_ACTIONS.has(action) || action.startsWith('skipped')) return false;

  return [
    'created',
    'moved',
    'transitioned',
    'transitioned_after_create',
    'recreated_after_deleted',
    'migrated',
  ].includes(action);
}

export function formatSyncDetail(d) {
  return formatUserActivityMessage(d);
}

export function buildSyncLogLines(result) {
  const lines = [];
  const details = result.details ?? [];

  for (const detail of details) {
    if (!isLoggableActivityEntry({ detail, status: detail.error ? 'error' : 'ok' })) {
      continue;
    }
    lines.push(formatUserActivityMessage(detail));
  }

  if (lines.length === 0 && (result.synced ?? 0) === 0) {
    return lines;
  }

  return lines;
}

export function formatActivityTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) {
    const minutes = Math.floor(diffMs / 60_000);
    return `${minutes}m ago`;
  }
  if (diffMs < 86_400_000) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatActivityEntry(entry) {
  if (!isLoggableActivityEntry(entry)) return null;

  const message = entry.detail
    ? formatUserActivityMessage(entry.detail)
    : entry.message?.trim();

  if (!message) return null;

  return {
    id: entry.id,
    timestamp: entry.timestamp,
    status: entry.status === 'error' ? 'error' : 'ok',
    message,
  };
}

export function getActivityStatusLabel(status) {
  return status === 'error' ? 'Failed' : 'Synced';
}
