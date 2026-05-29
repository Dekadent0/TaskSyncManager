/**
 * SQLite-backed idempotency for webhooks and Trello ↔ Jira item mappings.
 */

import { dbGet, dbRun } from '../db.js';

/**
 * @returns {boolean} true if this action was newly recorded (process it); false if duplicate.
 */
export async function tryMarkTrelloActionProcessed(actionId, environmentId) {
  if (!actionId) return true;

  try {
    await dbRun(
      `INSERT INTO processed_trello_actions (action_id, environment_id)
       VALUES (?, ?)`,
      [String(actionId), environmentId]
    );
    return true;
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed')) {
      return false;
    }
    throw err;
  }
}

export async function getMappingByTrelloCard(environmentId, trelloCardId) {
  return dbGet(
    `SELECT * FROM sync_item_mappings
     WHERE environment_id = ? AND trello_card_id = ?`,
    [environmentId, String(trelloCardId)]
  );
}

export async function getMappingByJiraIssue(environmentId, jiraIssueKey) {
  return dbGet(
    `SELECT * FROM sync_item_mappings
     WHERE environment_id = ? AND jira_issue_key = ?`,
    [environmentId, String(jiraIssueKey)]
  );
}

export async function deleteMappingByTrelloCard(environmentId, trelloCardId) {
  await dbRun(
    `DELETE FROM sync_item_mappings
     WHERE environment_id = ? AND trello_card_id = ?`,
    [environmentId, String(trelloCardId)]
  );
}

export async function upsertItemMapping({
  environmentId,
  syncRuleId,
  trelloCardId,
  jiraIssueKey,
}) {
  await dbRun(
    `INSERT INTO sync_item_mappings (
      environment_id, sync_rule_id, trello_card_id, jira_issue_key
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(environment_id, trello_card_id) DO UPDATE SET
      jira_issue_key = excluded.jira_issue_key,
      sync_rule_id = COALESCE(excluded.sync_rule_id, sync_rule_id),
      updated_at = datetime('now')`,
    [
      environmentId,
      syncRuleId ?? null,
      String(trelloCardId),
      String(jiraIssueKey),
    ]
  );
}
