/**
 * Sync rule direction validation and API response formatting.
 */

import { dbGet } from '../db.js';

export const SYNC_DIRECTIONS = ['trello-to-jira', 'jira-to-trello'];
export const DEFAULT_SYNC_DIRECTION = 'trello-to-jira';

export function parseSyncDirection(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      return { error: 'direction is required.' };
    }
    return { direction: DEFAULT_SYNC_DIRECTION };
  }

  const direction = String(value).trim().toLowerCase();
  if (!SYNC_DIRECTIONS.includes(direction)) {
    return {
      error: `direction must be one of: ${SYNC_DIRECTIONS.join(', ')}`,
    };
  }
  return { direction };
}

export function formatSyncRule(row) {
  if (!row) return row;
  return {
    ...row,
    direction: row.direction || DEFAULT_SYNC_DIRECTION,
  };
}

export async function defaultRuleName(environmentId) {
  const row = await dbGet(
    'SELECT COUNT(*) AS count FROM sync_rules WHERE environment_id = ?',
    [environmentId]
  );
  const next = (row?.count ?? 0) + 1;
  return `Rule ${next}`;
}
