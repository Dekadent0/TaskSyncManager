/**
 * User-facing sync activity log filtering and message formatting.
 */

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

const INTERNAL_MESSAGE_PATTERNS = [
  /^no matching/i,
  /^no sync rule/i,
  /^no rule for status/i,
  /^ignored trello/i,
  /^ignored jira/i,
  /^duplicate trello/i,
  /^skipped position-only/i,
  /^no sync rules defined/i,
];

export function looksLikeInternalId(value) {
  if (value == null || value === '') return true;
  const text = String(value).trim();
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (/^[a-f0-9]{8,}$/i.test(text)) return true;
  return false;
}

export function formatLocationLabel(name) {
  if (looksLikeInternalId(name)) return '';
  return String(name).trim();
}

export function isLoggableSyncDetail(detail) {
  if (!detail || typeof detail !== 'object') return false;
  if (detail.error) {
    return Boolean(
      detail.trelloCardName ||
        detail.jiraIssueSummary ||
        detail.jiraIssueKey ||
        detail.trelloCardId
    );
  }

  const action = detail.action ?? '';
  if (SKIP_ACTIONS.has(action)) return false;
  if (action.startsWith('skipped')) return false;

  return ['created', 'moved', 'transitioned', 'transitioned_after_create', 'recreated_after_deleted', 'migrated'].includes(
    action
  );
}

export function isLoggableSyncMessage(message) {
  if (!message || typeof message !== 'string') return false;
  return !INTERNAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

function detailDedupeKey(detail) {
  return [
    detail.direction ?? '',
    detail.trelloCardId ?? '',
    detail.jiraIssueKey ?? '',
    detail.trelloCardName ?? '',
    detail.jiraIssueSummary ?? '',
  ].join('|');
}

export function pickLoggableSyncDetails(details = []) {
  const chosen = new Map();

  for (const detail of details) {
    if (!isLoggableSyncDetail(detail)) continue;
    chosen.set(detailDedupeKey(detail), detail);
  }

  return [...chosen.values()];
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

export function formatUserActivityMessage(detail) {
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
    detail.action === 'recreated_after_deleted'
  ) {
    return `Synced task to Jira${location}: ${summary}`;
  }

  if (detail.action === 'transitioned' || detail.action === 'moved') {
    return `Moved issue to Jira${location}: ${summary}`;
  }

  return `Updated in Jira${location}: ${summary}`;
}
