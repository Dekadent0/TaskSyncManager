/**
 * Core sync engine: executes rules by direction (Trello ↔ Jira).
 */

import { dbAll } from '../db.js';
import { DEFAULT_SYNC_DIRECTION } from '../utils/ruleValidation.js';
import { fetchJiraBoardsWithColumns } from './jiraService.js';
import { loadEnvironmentCredentials } from './environmentService.js';
import {
  fetchTrelloBoardCards,
  fetchTrelloCard,
  fetchTrelloListCards,
  fetchTrelloListName,
  findTrelloCardByJiraIssue,
  findTrelloCardInListByJiraIssue,
  createTrelloCardFromIssue,
  moveTrelloCardToList,
} from './trelloService.js';
import {
  findJiraIssueByTrelloCard,
  createJiraIssueFromCard,
  transitionJiraIssueToStatus,
  fetchJiraBoardIssues,
  fetchJiraIssuesByProjectAndStatus,
  fetchJiraIssueDetails,
  jiraDescriptionToPlainText,
} from './jiraService.js';
import {
  tryMarkTrelloActionProcessed,
  getMappingByTrelloCard,
  getMappingByJiraIssue,
  upsertItemMapping,
  deleteMappingByTrelloCard,
} from './syncIdempotencyService.js';
import { isTrelloPositionOnlyAction } from '../utils/trelloWebhookFilters.js';
import {
  normalizeJiraCompareValue,
  ruleMatchesJiraProject,
  ruleMatchesIncomingJiraStatus,
} from '../utils/jiraRuleMatching.js';
import { formatLocationLabel } from '../utils/syncActivityFormat.js';

function resolveJiraBoardForRule(rule, jiraBoards) {
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

function resolveJiraStatusLabelForRule(rule, jiraBoards) {
  const board = resolveJiraBoardForRule(rule, jiraBoards);
  const column = board?.columns?.find(
    (col) => String(col.id) === String(rule.jira_target_column_id)
  );
  return column?.name ?? rule.jira_target_column_id;
}

function jiraTargetColumnName(rule, jiraBoards) {
  return formatLocationLabel(resolveJiraStatusLabelForRule(rule, jiraBoards));
}

function isJiraIssueMissingError(err) {
  if (err?.response?.status === 404) return true;

  const parts = [
    err?.message,
    ...(err?.response?.data?.errorMessages ?? []),
    err?.response?.data?.message,
  ].filter(Boolean);

  const text = parts.join(' ');
  return /does not exist/i.test(text) || /you do not have permission to see it/i.test(text);
}

/**
 * Remove stale mapping and create a fresh Jira issue for the Trello card.
 */
async function recreateJiraIssueAfterDeletedMapping(
  credentials,
  rule,
  card,
  project,
  environmentId,
  deadIssueKey
) {
  console.warn(
    `[Sync Engine] Mapped issue ${deadIssueKey} was deleted from Jira. Cleaning up mapping and creating a new issue instead.`
  );
  await deleteMappingByTrelloCard(environmentId, card.id);

  const created = await createJiraIssueFromCard(
    credentials,
    project,
    card,
    rule.jira_target_column_id
  );
  await upsertItemMapping({
    environmentId,
    syncRuleId: rule.id,
    trelloCardId: card.id,
    jiraIssueKey: created.key,
  });

  return { key: created.key, fields: { status: null } };
}

/**
 * Resolve linked Jira issue via marker search, live API lookup, or null if gone.
 */
async function resolveJiraIssueForTrelloCard(
  credentials,
  project,
  environmentId,
  card,
  existingMapping
) {
  let issue = await findJiraIssueByTrelloCard(credentials, project.key, card.id);

  if (issue) {
    return issue;
  }

  const mappedKey = existingMapping?.jira_issue_key;
  if (!mappedKey) {
    return null;
  }

  try {
    const live = await fetchJiraIssueDetails(credentials, mappedKey);
    return {
      key: live.key,
      fields: { status: live.statusId ? { id: live.statusId } : null },
    };
  } catch (err) {
    if (isJiraIssueMissingError(err)) {
      console.warn(
        `[Sync Engine] Mapped issue ${mappedKey} was deleted from Jira. Cleaning up mapping and creating a new issue instead.`
      );
      await deleteMappingByTrelloCard(environmentId, card.id);
      return null;
    }
    throw err;
  }
}

/** Prevents concurrent bulk status syncs for the same Jira project column. */
const activeJiraStatusSyncs = new Set();
const JIRA_STATUS_SYNC_LOCK_MS = 5000;

function releaseJiraStatusSyncLock(syncKey) {
  if (!syncKey) return;
  setTimeout(
    () => activeJiraStatusSyncs.delete(String(syncKey)),
    JIRA_STATUS_SYNC_LOCK_MS
  );
}

/** Prevents concurrent bulk list syncs for the same Trello list (webhook bursts). */
const activeTrelloListSyncs = new Set();
const TRELLO_LIST_SYNC_LOCK_MS = 5000;

function releaseTrelloListSyncLock(listId) {
  if (!listId) return;
  setTimeout(
    () => activeTrelloListSyncs.delete(String(listId)),
    TRELLO_LIST_SYNC_LOCK_MS
  );
}

/** Prevents concurrent Trello card creation for the same Jira issue (rapid webhooks). */
const activeJiraIssueCreates = new Set();
const JIRA_ISSUE_CREATE_LOCK_MS = 3000;

function releaseJiraIssueCreateLock(issueKey) {
  if (!issueKey) return;
  setTimeout(() => activeJiraIssueCreates.delete(issueKey), JIRA_ISSUE_CREATE_LOCK_MS);
}

/**
 * Resolve an existing Trello card linked to a Jira issue (DB mapping, board, target list).
 */
async function resolveExistingTrelloCardForJiraIssue(
  credentials,
  environmentId,
  issue,
  trelloBoardId,
  trelloTargetListId
) {
  const issueKey = issue.key;
  const summary = issue.summary ?? issue.fields?.summary;

  const mapping = await getMappingByJiraIssue(environmentId, issueKey);
  if (mapping?.trello_card_id) {
    try {
      return await fetchTrelloCard(credentials, mapping.trello_card_id);
    } catch {
      // Stale mapping — fall through to Trello search.
    }
  }

  let card = await findTrelloCardByJiraIssue(credentials, trelloBoardId, issueKey);
  if (card) return card;

  card = await findTrelloCardInListByJiraIssue(
    credentials,
    trelloTargetListId,
    issueKey,
    summary
  );
  return card ?? null;
}

const TRELLO_CARD_ACTION_TYPES = new Set([
  'createCard',
  'updateCard',
  'copyCard',
  'moveCardFromBoard',
  'moveCardToBoard',
  'addCardToBoard',
]);

/**
 * Sync a single Trello card for one trello-to-jira rule when the card is in the source list.
 */
export async function syncSingleTrelloCardToJira(
  credentials,
  rule,
  card,
  jiraBoards
) {
  const details = [];
  let synced = 0;
  const direction = 'trello-to-jira';

  if (String(card.idList) !== String(rule.trello_source_column_id)) {
    console.log(
      `[Sync Engine] Rule ${rule.id}: card not in source list (card=${card.idList}, rule=${rule.trello_source_column_id})`
    );
    return {
      synced: 0,
      details: [
        {
          ruleId: rule.id,
          direction,
          trelloCardId: card.id,
          action: 'skipped_not_in_source_list',
        },
      ],
    };
  }

  const board = resolveJiraBoardForRule(rule, jiraBoards);
  if (!board) {
    return {
      synced: 0,
      details: [
        {
          ruleId: rule.id,
          direction,
          error: `Jira board ${rule.jira_board_id || '(none)'} not found`,
        },
      ],
    };
  }

  const project = {
    id: board.projectId,
    key: board.projectKey,
    name: board.projectName,
  };

  if (!project.key) {
    return {
      synced: 0,
      details: [
        {
          ruleId: rule.id,
          direction,
          error: `Jira board "${board.name}" has no linked project`,
        },
      ],
    };
  }

  const jiraTargetStatusId = rule.jira_target_column_id;
  const environmentId = rule.environment_id;
  const targetColumnName = jiraTargetColumnName(rule, jiraBoards);

  try {
    const existingMapping = await getMappingByTrelloCard(environmentId, card.id);
    let issue = await resolveJiraIssueForTrelloCard(
      credentials,
      project,
      environmentId,
      card,
      existingMapping
    );
    let recreatedFromDeleted = false;

    if (!issue) {
      console.log(
        `[Sync Engine] Rule ${rule.id}: creating Jira issue for Trello card ${card.id}`
      );
      const created = await createJiraIssueFromCard(
        credentials,
        project,
        card,
        jiraTargetStatusId
      );
      issue = { key: created.key, fields: { status: null } };
      await upsertItemMapping({
        environmentId,
        syncRuleId: rule.id,
        trelloCardId: card.id,
        jiraIssueKey: created.key,
      });
      details.push({
        ruleId: rule.id,
        direction,
        trelloCardId: card.id,
        trelloCardName: card.name,
        action: 'created',
        jiraIssueKey: created.key,
        targetColumnName,
        trigger: 'webhook',
      });
    } else {
      console.log(
        `[Sync Engine] Rule ${rule.id}: Jira issue already exists (${issue.key})`
      );
      await upsertItemMapping({
        environmentId,
        syncRuleId: rule.id,
        trelloCardId: card.id,
        jiraIssueKey: issue.key,
      });
    }

    const currentStatusId = issue.fields?.status?.id;
    if (String(currentStatusId) !== String(jiraTargetStatusId)) {
      console.log(
        `[Sync Engine] Rule ${rule.id}: transitioning ${issue.key} to status ${jiraTargetStatusId}`
      );
      try {
        await transitionJiraIssueToStatus(
          credentials,
          issue.key,
          jiraTargetStatusId
        );
      } catch (transitionErr) {
        if (!isJiraIssueMissingError(transitionErr)) {
          throw transitionErr;
        }

        const deadKey = issue.key;
        issue = await recreateJiraIssueAfterDeletedMapping(
          credentials,
          rule,
          card,
          project,
          environmentId,
          deadKey
        );
        recreatedFromDeleted = true;
        await transitionJiraIssueToStatus(
          credentials,
          issue.key,
          jiraTargetStatusId
        );
      }

      details.push({
        ruleId: rule.id,
        direction,
        trelloCardId: card.id,
        trelloCardName: card.name,
        action: recreatedFromDeleted
          ? 'recreated_after_deleted'
          : issue.fields?.status
            ? 'transitioned'
            : 'transitioned_after_create',
        jiraIssueKey: issue.key,
        targetStatusId: jiraTargetStatusId,
        targetColumnName,
        trigger: 'webhook',
      });
    } else {
      details.push({
        ruleId: rule.id,
        direction,
        trelloCardId: card.id,
        trelloCardName: card.name,
        action: 'already_in_target',
        jiraIssueKey: issue.key,
        trigger: 'webhook',
      });
    }

    synced = 1;
  } catch (err) {
    console.error(
      `[Sync Engine ERROR] Rule ${rule.id} failed for card ${card.id}:`,
      err.response?.data?.errorMessages?.[0] || err.message
    );
    details.push({
      ruleId: rule.id,
      direction,
      trelloCardId: card.id,
      trelloCardName: card.name,
      error: err.response?.data?.errorMessages?.[0] || err.message,
      targetColumnName,
      trigger: 'webhook',
    });
  }

  return { synced, details };
}

/**
 * Bulk list sync: align every card in the rule's Trello source list with Jira.
 */
export async function syncTrelloListToJiraForRule(credentials, rule, jiraBoards) {
  const listId = rule.trello_source_column_id;
  const details = [];
  let synced = 0;

  const cards = await fetchTrelloListCards(credentials, listId);
  console.log(
    `[Sync Engine] Bulk list sync for rule ${rule.id}: ${cards.length} card(s) in list ${listId}`
  );

  for (const card of cards) {
    const result = await syncSingleTrelloCardToJira(
      credentials,
      rule,
      card,
      jiraBoards
    );
    synced += result.synced;
    details.push(...result.details);
  }

  return { synced, details, listId, cardCount: cards.length };
}

/**
 * Run bulk list sync under a list-level lock (idempotent across rapid webhooks).
 */
async function runTrelloListBulkSync(credentials, rule, jiraBoards) {
  const listId = String(rule.trello_source_column_id);

  if (activeTrelloListSyncs.has(listId)) {
    console.log(
      `[Sync Engine] Bulk sync for list ${listId} already in progress. Skipping duplicate cascade.`
    );
    return {
      synced: 0,
      details: [
        {
          ruleId: rule.id,
          direction: 'trello-to-jira',
          action: 'skipped_list_sync_in_progress',
          listId,
        },
      ],
      listId,
      cardCount: 0,
      skipped: true,
    };
  }

  activeTrelloListSyncs.add(listId);
  try {
    return await syncTrelloListToJiraForRule(credentials, rule, jiraBoards);
  } finally {
    releaseTrelloListSyncLock(listId);
  }
}

/**
 * Sync a single Jira issue for one jira-to-trello rule when the issue is in the source status.
 */
export async function syncSingleJiraIssueToTrello(
  credentials,
  rule,
  issue,
  jiraBoards,
  options = {}
) {
  const details = [];
  let synced = 0;
  const direction = 'jira-to-trello';

  const statusId = issue.statusId ?? issue.fields?.status?.id;
  const statusName = issue.statusName ?? issue.fields?.status?.name;
  if (
    !options.skipStatusCheck &&
    !ruleMatchesIncomingJiraStatus(rule, statusId, statusName, jiraBoards)
  ) {
    console.log(
      `[Jira Sync] Rule ${rule.id}: issue not in source status (actual id=${statusId}, name=${statusName}, rule=${rule.jira_target_column_id})`
    );
    return {
      synced: 0,
      details: [
        {
          ruleId: rule.id,
          direction,
          jiraIssueKey: issue.key,
          action: 'skipped_not_in_source_status',
        },
      ],
    };
  }

  const board = resolveJiraBoardForRule(rule, jiraBoards);
  if (!board) {
    return {
      synced: 0,
      details: [
        {
          ruleId: rule.id,
          direction,
          error: `Jira board ${rule.jira_board_id || '(none)'} not found`,
        },
      ],
    };
  }

  const trelloTargetListId = rule.trello_source_column_id;
  const trelloBoardId = rule.trello_board_id;
  const environmentId = rule.environment_id;
  const targetListName = formatLocationLabel(
    await fetchTrelloListName(credentials, trelloTargetListId).catch(() => null)
  );

  try {
    let card = await resolveExistingTrelloCardForJiraIssue(
      credentials,
      environmentId,
      issue,
      trelloBoardId,
      trelloTargetListId
    );

    if (!card) {
      if (activeJiraIssueCreates.has(issue.key)) {
        console.log(
          `[Jira Sync] Creation for ${issue.key} already in progress; re-checking Trello…`
        );
        await new Promise((resolve) => setTimeout(resolve, 400));
        card = await resolveExistingTrelloCardForJiraIssue(
          credentials,
          environmentId,
          issue,
          trelloBoardId,
          trelloTargetListId
        );
      }

      if (!card) {
        activeJiraIssueCreates.add(issue.key);
        try {
          card = await resolveExistingTrelloCardForJiraIssue(
            credentials,
            environmentId,
            issue,
            trelloBoardId,
            trelloTargetListId
          );

          if (!card) {
            console.log(
              `[Jira Sync] Rule ${rule.id}: creating Trello card for Jira issue ${issue.key}`
            );
            const fullIssue = await fetchJiraIssueDetails(credentials, issue.key);
            const plainDesc = jiraDescriptionToPlainText(fullIssue.description);
            card = await createTrelloCardFromIssue(
              credentials,
              trelloTargetListId,
              fullIssue,
              plainDesc
            );
            details.push({
              ruleId: rule.id,
              direction,
              jiraIssueKey: issue.key,
              jiraIssueSummary: issue.summary ?? issue.fields?.summary,
              trelloCardId: card.id,
              trelloCardName: card.name,
              action: 'created',
              targetListName,
              trigger: 'webhook',
            });
          } else {
            console.log(
              `[Jira Sync] Card for ${issue.key} already exists in Trello. Skipping creation to prevent duplication.`
            );
            details.push({
              ruleId: rule.id,
              direction,
              jiraIssueKey: issue.key,
              action: 'skipped_duplicate_after_lock',
              trelloCardId: card.id,
              trigger: 'webhook',
            });
          }
        } finally {
          releaseJiraIssueCreateLock(issue.key);
        }
      }
    } else {
      console.log(
        `[Jira Sync] Card for ${issue.key} already exists in Trello. Skipping creation to prevent duplication.`
      );
    }

    if (card) {
      await upsertItemMapping({
        environmentId,
        syncRuleId: rule.id,
        trelloCardId: card.id,
        jiraIssueKey: issue.key,
      });
    }

    if (card && String(card.idList) !== String(trelloTargetListId)) {
      await moveTrelloCardToList(credentials, card.id, trelloTargetListId);
      details.push({
        ruleId: rule.id,
        direction,
        jiraIssueKey: issue.key,
        jiraIssueSummary: issue.summary ?? issue.fields?.summary,
        trelloCardId: card.id,
        trelloCardName: card.name,
        action: 'moved',
        targetListId: trelloTargetListId,
        targetListName,
        trigger: 'webhook',
      });
    } else if (card) {
      details.push({
        ruleId: rule.id,
        direction,
        jiraIssueKey: issue.key,
        jiraIssueSummary: issue.summary ?? issue.fields?.summary,
        trelloCardId: card.id,
        trelloCardName: card.name,
        action: 'already_in_target',
        trigger: 'webhook',
      });
    }

    synced = card ? 1 : 0;
  } catch (err) {
    console.error(
      `[Jira Sync ERROR] Rule ${rule.id} failed for issue ${issue.key}:`,
      err.response?.data?.errorMessages?.[0] || err.message
    );
    details.push({
      ruleId: rule.id,
      direction,
      jiraIssueKey: issue.key,
      jiraIssueSummary: issue.summary ?? issue.fields?.summary,
      error:
        err.response?.data?.errorMessages?.[0] ||
        err.response?.data?.message ||
        err.message,
      targetListName,
      trigger: 'webhook',
    });
  }

  return { synced, details };
}

/**
 * Bulk status sync: align every issue in the rule's Jira source status with Trello.
 */
export async function syncJiraStatusToTrelloForRule(credentials, rule, jiraBoards) {
  const projectKey = resolveProjectKeyForRule(rule, jiraBoards);
  const { statusId, statusName } = resolveJiraStatusQueryForRule(rule, jiraBoards);

  let issues;
  try {
    issues = await fetchJiraIssuesByProjectAndStatus(
      credentials,
      projectKey,
      statusName,
      statusId
    );
  } catch (err) {
    const status = err.response?.status;
    const msg =
      err.response?.data?.errorMessages?.join('; ') ||
      err.response?.data?.message ||
      err.message;
    console.error(
      `[Jira Sync ERROR] Bulk fetch failed for project ${projectKey}, status ${statusName ?? statusId}:`,
      status ? `HTTP ${status}` : '',
      msg
    );
    throw err;
  }

  console.log(
    `[Jira Sync] Bulk status sync for rule ${rule.id}: ${issues.length} issue(s) in project ${projectKey}, status ${statusName ?? statusId}`
  );

  let synced = 0;
  const details = [];

  for (const issue of issues) {
    try {
      const result = await syncSingleJiraIssueToTrello(
        credentials,
        rule,
        issue,
        jiraBoards,
        { skipStatusCheck: true }
      );
      synced += result.synced;
      details.push(...result.details);
    } catch (err) {
      console.error(
        `[Jira Sync ERROR] Bulk loop failed for issue ${issue.key}:`,
        err.response?.data?.errorMessages?.[0] || err.message
      );
      details.push({
        ruleId: rule.id,
        direction: 'jira-to-trello',
        jiraIssueKey: issue.key,
        action: 'bulk_issue_sync_failed',
        error: err.response?.data?.errorMessages?.[0] || err.message,
      });
    }
  }

  return {
    synced,
    details,
    projectKey,
    statusName: statusName ?? statusId,
    issueCount: issues.length,
  };
}

/**
 * Run bulk Jira status sync under a project+status lock (idempotent across rapid webhooks).
 * Falls back to syncing triggerIssue alone if the bulk JQL fetch fails.
 */
async function runJiraStatusBulkSync(
  credentials,
  rule,
  jiraBoards,
  triggerIssue = null
) {
  const syncKey = jiraStatusBulkSyncKey(rule, jiraBoards);

  if (activeJiraStatusSyncs.has(syncKey)) {
    console.log(
      `[Jira Sync] Bulk sync for ${syncKey} already in progress. Skipping duplicate cascade.`
    );
    return {
      synced: 0,
      details: [
        {
          ruleId: rule.id,
          direction: 'jira-to-trello',
          action: 'skipped_status_sync_in_progress',
          syncKey,
        },
      ],
      projectKey: resolveProjectKeyForRule(rule, jiraBoards),
      issueCount: 0,
      skipped: true,
    };
  }

  activeJiraStatusSyncs.add(syncKey);
  try {
    return await syncJiraStatusToTrelloForRule(credentials, rule, jiraBoards);
  } catch (bulkErr) {
    const bulkMsg =
      bulkErr.response?.data?.errorMessages?.join('; ') ||
      bulkErr.response?.data?.message ||
      bulkErr.message;

    if (!triggerIssue?.key) {
      console.error(
        '[Jira Sync ERROR] Bulk status sync failed with no trigger issue to fall back on:',
        bulkMsg
      );
      return {
        synced: 0,
        details: [
          {
            ruleId: rule.id,
            direction: 'jira-to-trello',
            action: 'bulk_fetch_failed',
            error: bulkMsg,
          },
        ],
        projectKey: resolveProjectKeyForRule(rule, jiraBoards),
        issueCount: 0,
        bulkFailed: true,
      };
    }

    console.warn(
      `[Jira Sync] Bulk fetch failed; falling back to trigger issue sync for ${triggerIssue.key}`
    );

    try {
      const fallback = await syncSingleJiraIssueToTrello(
        credentials,
        rule,
        triggerIssue,
        jiraBoards
      );
      return {
        synced: fallback.synced,
        details: [
          ...fallback.details,
          {
            ruleId: rule.id,
            direction: 'jira-to-trello',
            jiraIssueKey: triggerIssue.key,
            action: 'bulk_fetch_failed_fallback',
            error: bulkMsg,
          },
        ],
        projectKey: resolveProjectKeyForRule(rule, jiraBoards),
        issueCount: 1,
        bulkFailed: true,
        fallback: true,
      };
    } catch (fallbackErr) {
      console.error(
        `[Jira Sync ERROR] Trigger issue fallback also failed for ${triggerIssue.key}:`,
        fallbackErr.response?.data?.errorMessages?.[0] || fallbackErr.message
      );
      return {
        synced: 0,
        details: [
          {
            ruleId: rule.id,
            direction: 'jira-to-trello',
            jiraIssueKey: triggerIssue.key,
            action: 'bulk_and_fallback_failed',
            error: fallbackErr.response?.data?.errorMessages?.[0] || fallbackErr.message,
            bulkError: bulkMsg,
          },
        ],
        projectKey: resolveProjectKeyForRule(rule, jiraBoards),
        issueCount: 0,
        bulkFailed: true,
        fallbackFailed: true,
      };
    }
  } finally {
    releaseJiraStatusSyncLock(syncKey);
  }
}

function extractTrelloWebhookContext(payload) {
  if (isTrelloPositionOnlyAction(payload)) {
    return null;
  }

  const action = payload?.action;
  if (!action?.type || !TRELLO_CARD_ACTION_TYPES.has(action.type)) {
    return null;
  }

  const card = action.data?.card;
  const board =
    action.data?.board ||
    (card?.idBoard ? { id: card.idBoard } : null);

  if (!card?.id || !board?.id) return null;

  const listId =
    action.data?.listAfter?.id ||
    action.data?.list?.id ||
    card.idList;

  return {
    cardId: card.id,
    boardId: board.id,
    listId,
    listAfterName: action.data?.listAfter?.name ?? action.data?.list?.name ?? null,
    actionType: action.type,
    translationKey: action.display?.translationKey ?? null,
  };
}

function extractJiraWebhookIssue(payload) {
  const event = payload?.webhookEvent || payload?.issue_event_type_name;
  if (!event || !String(event).includes('issue')) {
    return null;
  }

  const issue = payload.issue;
  if (!issue?.key) return null;

  return {
    key: issue.key,
    id: issue.id,
    summary: issue.fields?.summary,
    statusId: issue.fields?.status?.id,
    statusName: issue.fields?.status?.name,
    projectKey: issue.fields?.project?.key,
  };
}

/**
 * Process an incoming Trello webhook payload for an environment.
 */
export async function handleTrelloWebhook(payload, environmentId) {
  const action = payload?.action;

  try {
    if (isTrelloPositionOnlyAction(payload)) {
      const translationKey =
        payload?.action?.display?.translationKey ?? payload?.action?.type;
      console.log(
        '[Sync Engine] Skipped position-only action inside handler:',
        translationKey
      );
      return {
        synced: 0,
        details: [],
        message: `Skipped position-only Trello action (${translationKey}).`,
      };
    }

    const actionId = action?.id;
    if (actionId) {
      const isNew = await tryMarkTrelloActionProcessed(actionId, environmentId);
      if (!isNew) {
        console.log('[Sync Engine] Skipped duplicate Trello action id:', actionId);
        return {
          synced: 0,
          details: [],
          message: `Duplicate Trello action ${actionId} (already processed).`,
        };
      }
    }

    const context = extractTrelloWebhookContext(payload);
    if (!context) {
      console.log('[Sync Engine] Skipped. Unhandled Trello action:', {
        type: action?.type,
        translationKey: action?.display?.translationKey,
        cardId: action?.data?.card?.id,
      });
      return { synced: 0, details: [], message: 'Ignored Trello action (no card change).' };
    }

    console.log('[Sync Engine] Starting background sync for Trello card:', context.cardId);
    console.log('[Sync Engine] Checking rules for list:', context.listId, context.listAfterName);

    const credentials = await loadEnvironmentCredentials(environmentId);
    const rules = await dbAll(
      `SELECT * FROM sync_rules
       WHERE environment_id = ?
         AND trello_board_id = ?
         AND direction = 'trello-to-jira'`,
      [environmentId, context.boardId]
    );

    console.log(
      `[Sync Engine] Found ${rules.length} trello-to-jira rule(s) for board ${context.boardId}`
    );

    if (rules.length === 0) {
      console.log(
        '[Sync Engine] Skipped. No sync rules configured for Trello board:',
        context.boardId
      );
      return { synced: 0, details: [], message: 'No matching trello-to-jira rules.' };
    }

    const card = await fetchTrelloCard(credentials, context.cardId);
    console.log('[Sync Engine] Fetched card from Trello:', {
      cardId: card.id,
      name: card.name,
      idList: card.idList,
    });

    const listAfterName = context.listAfterName ?? card.idList;
    const matchingRules = rules.filter(
      (rule) => String(rule.trello_source_column_id) === String(card.idList)
    );

    for (const rule of rules) {
      const matches =
        String(rule.trello_source_column_id) === String(card.idList);
      console.log(
        `[Sync Engine] Rule ${rule.id} "${rule.name}": source list ${rule.trello_source_column_id} vs card list ${card.idList} → ${matches ? 'MATCH' : 'no match'}`
      );
    }

    if (matchingRules.length === 0) {
      console.log(
        '[Sync Engine] Skipped. No sync rule found for Trello list:',
        listAfterName
      );
      return {
        synced: 0,
        details: [],
        cardId: context.cardId,
        boardId: context.boardId,
        message: `No sync rule for list ${listAfterName} (${card.idList}).`,
      };
    }

    const jiraBoards = await fetchJiraBoardsWithColumns(credentials);

    let synced = 0;
    const details = [];

    for (const rule of matchingRules) {
      console.log(
        `[Sync Engine] Running bulk list sync for rule ${rule.id} (${rule.name}), list ${rule.trello_source_column_id}`
      );
      const result = await runTrelloListBulkSync(credentials, rule, jiraBoards);
      synced += result.synced;
      details.push(...result.details);
      console.log(`[Sync Engine] Rule ${rule.id} bulk result:`, {
        listId: result.listId,
        cardCount: result.cardCount,
        synced: result.synced,
        skipped: result.skipped ?? false,
      });
    }

    return {
      synced,
      details,
      cardId: context.cardId,
      boardId: context.boardId,
      bulkListSync: true,
    };
  } catch (error) {
    console.error('[Sync Engine ERROR] Background synchronization failed:', error);
    if (error?.stack) {
      console.error(error.stack);
    }
    throw error;
  }
}

function resolveProjectKeyForRule(rule, jiraBoards) {
  const board = resolveJiraBoardForRule(rule, jiraBoards);
  if (board?.projectKey) return board.projectKey;

  const raw = String(rule.jira_project_id ?? '').trim();
  if (raw && !/^\d+$/.test(raw)) return raw;

  return board?.projectKey ?? raw;
}

function resolveJiraStatusQueryForRule(rule, jiraBoards) {
  const board = resolveJiraBoardForRule(rule, jiraBoards);
  const ruleStored = normalizeJiraCompareValue(rule.jira_target_column_id);

  const column = board?.columns?.find((col) => {
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

  if (column) {
    return {
      statusId: column.id,
      statusName: column.statusName || column.columnName || null,
    };
  }

  const asId = String(rule.jira_target_column_id ?? '');
  if (/^\d+$/.test(asId)) {
    return { statusId: asId, statusName: null };
  }

  return { statusId: null, statusName: asId };
}

function jiraStatusBulkSyncKey(rule, jiraBoards) {
  const projectKey = resolveProjectKeyForRule(rule, jiraBoards);
  const { statusId, statusName } = resolveJiraStatusQueryForRule(rule, jiraBoards);
  return `${projectKey}:${statusId ?? statusName}`;
}

/**
 * Process an incoming Jira webhook payload for an environment.
 */
export async function handleJiraWebhook(payload, environmentId) {
  let matchingRules = [];
  let issueForSync = null;
  let credentials = null;
  let jiraBoards = [];
  let triggerIssueKey = null;

  try {
    const rawIssue = payload?.issue;
    console.log(
      '[Jira Sync] Processing issue:',
      rawIssue?.key,
      'Status:',
      rawIssue?.fields?.status?.name,
      'Status ID:',
      rawIssue?.fields?.status?.id
    );

    const issue = extractJiraWebhookIssue(payload);
    if (!issue) {
      console.log('[Jira Sync] Skipped. Could not extract issue from payload:', {
        webhookEvent: payload?.webhookEvent,
        hasIssue: Boolean(rawIssue),
        issueKey: rawIssue?.key,
      });
      return { synced: 0, details: [], message: 'Ignored Jira event (no issue).' };
    }

    credentials = await loadEnvironmentCredentials(environmentId);
    jiraBoards = await fetchJiraBoardsWithColumns(credentials);

    const allRules = await dbAll(
      `SELECT * FROM sync_rules
       WHERE environment_id = ?
         AND direction = 'jira-to-trello'`,
      [environmentId]
    );

    const projectKey = issue.projectKey ?? rawIssue?.fields?.project?.key;
    const rules = allRules.filter((rule) =>
      ruleMatchesJiraProject(rule, projectKey, jiraBoards)
    );

    console.log(
      `[Jira Sync] Loaded ${allRules.length} jira-to-trello rule(s); ${rules.length} for project ${projectKey}`
    );

    if (rules.length === 0) {
      console.log(
        '[Jira Sync] Skipped. No active rule matches project',
        projectKey
      );
      return { synced: 0, details: [], message: 'No matching jira-to-trello rules.' };
    }

    const fullIssue = await fetchJiraIssueDetails(credentials, issue.key);
    const incomingStatusId = fullIssue.statusId ?? issue.statusId;
    const incomingStatusName =
      fullIssue.statusName ??
      issue.statusName ??
      rawIssue?.fields?.status?.name;

    issueForSync = {
      key: fullIssue.key,
      summary: fullIssue.summary,
      statusId: incomingStatusId,
      statusName: incomingStatusName,
    };
    triggerIssueKey = issueForSync.key;

    console.log('[Jira Sync] Live issue from Jira API:', {
      key: issueForSync.key,
      statusId: issueForSync.statusId,
      statusName: issueForSync.statusName,
      summary: issueForSync.summary,
    });

    matchingRules = rules.filter((rule) =>
      ruleMatchesIncomingJiraStatus(
        rule,
        incomingStatusId,
        incomingStatusName,
        jiraBoards
      )
    );

    for (const rule of rules) {
      const expectedStatus = resolveJiraStatusLabelForRule(rule, jiraBoards);
      const matches = ruleMatchesIncomingJiraStatus(
        rule,
        incomingStatusId,
        incomingStatusName,
        jiraBoards
      );
      console.log(
        '[Jira Sync] Checking rule:',
        rule.id,
        'Expected Jira status:',
        expectedStatus,
        `(stored: ${rule.jira_target_column_id}, normalized: ${normalizeJiraCompareValue(rule.jira_target_column_id)})`,
        'vs Actual:',
        incomingStatusName,
        `(id: ${incomingStatusId}, normalized name: ${normalizeJiraCompareValue(incomingStatusName)}, normalized id: ${normalizeJiraCompareValue(incomingStatusId)})`,
        '→',
        matches ? 'MATCH' : 'no match'
      );
    }

    if (matchingRules.length === 0) {
      console.log(
        '[Jira Sync] Skipped. No active rule matches project',
        projectKey,
        'or status',
        incomingStatusName ?? incomingStatusId
      );
      return {
        synced: 0,
        details: [],
        issueKey: issue.key,
        message: `No rule for status ${issueForSync.statusId}.`,
      };
    }

    let synced = 0;
    const details = [];

    for (const rule of matchingRules) {
      const statusQuery = resolveJiraStatusQueryForRule(rule, jiraBoards);
      console.log(
        `[Jira Sync] Running bulk status sync for rule ${rule.id} (${rule.name}), project ${resolveProjectKeyForRule(rule, jiraBoards)}, status ${statusQuery.statusName ?? statusQuery.statusId}`
      );
      const result = await runJiraStatusBulkSync(
        credentials,
        rule,
        jiraBoards,
        issueForSync
      );
      synced += result.synced;
      details.push(...result.details);
      console.log(`[Jira Sync] Rule ${rule.id} bulk result:`, {
        projectKey: result.projectKey,
        statusName: result.statusName,
        issueCount: result.issueCount,
        synced: result.synced,
        skipped: result.skipped ?? false,
        bulkFailed: result.bulkFailed ?? false,
        fallback: result.fallback ?? false,
      });
    }

    return { synced, details, issueKey: issue.key, bulkStatusSync: true };
  } catch (error) {
    console.error('[Jira Sync ERROR] Background process crashed:', error);
    if (error?.stack) {
      console.error(error.stack);
    }

    if (matchingRules.length && issueForSync?.key && credentials && jiraBoards.length) {
      console.warn(
        `[Jira Sync] Attempting last-resort sync for trigger issue ${issueForSync.key}`
      );
      let recoveredSynced = 0;
      const recoveredDetails = [];
      for (const rule of matchingRules) {
        try {
          const fallback = await syncSingleJiraIssueToTrello(
            credentials,
            rule,
            issueForSync,
            jiraBoards
          );
          recoveredSynced += fallback.synced;
          recoveredDetails.push(...fallback.details);
        } catch (fallbackErr) {
          console.error(
            `[Jira Sync ERROR] Last-resort sync failed for ${issueForSync.key}:`,
            fallbackErr.message
          );
        }
      }
      if (recoveredSynced > 0 || recoveredDetails.length > 0) {
        return {
          synced: recoveredSynced,
          details: recoveredDetails,
          issueKey: triggerIssueKey ?? issueForSync.key,
          bulkStatusSync: false,
          recoveredFromError: true,
        };
      }
    }

    throw error;
  }
}

/**
 * One-time backfill for items that already sat on the rule's SOURCE side before webhooks applied.
 *
 * Unlike webhook sync (syncSingle*), this function:
 * - Only looks at items already in the source list (Trello) or source status (Jira).
 * - Never moves cards/issues that are already paired on both tools.
 * - Creates missing destination items only when no link exists yet.
 *
 * Per-item decision tree (same for both directions):
 *   1. Already in sync_item_mappings? → skip
 *   2. Matching item found on destination (search/marker) but not mapped? → link only, skip
 *   3. Nothing on destination? → create item + save mapping (counts as migrated)
 *
 * Triggered by POST /api/rules/:id/sync-existing (not the live webhook path).
 */
export async function syncExistingItemsForRule(credentials, rule) {
  const jiraBoards = await fetchJiraBoardsWithColumns(credentials);
  const direction = rule.direction || DEFAULT_SYNC_DIRECTION;
  const details = [];
  let migrated = 0;

  // --- Jira → Trello: source = Jira status, destination = Trello list ---
  if (direction === 'jira-to-trello') {
    const board = resolveJiraBoardForRule(rule, jiraBoards);
    if (!board) {
      return {
        migrated: 0,
        details: [
          {
            ruleId: rule.id,
            error: `Jira board ${rule.jira_board_id || '(none)'} not found`,
          },
        ],
      };
    }

    const targetListName = formatLocationLabel(
      await fetchTrelloListName(credentials, rule.trello_source_column_id).catch(() => null)
    );

    // All issues on the rule's Jira board, then keep only those in the rule's source status.
    const issues = await fetchJiraBoardIssues(credentials, rule.jira_board_id);
    const inSourceStatus = issues.filter((issue) =>
      ruleMatchesIncomingJiraStatus(
        rule,
        issue.statusId,
        issue.statusName,
        jiraBoards
      )
    );

    for (const issue of inSourceStatus) {
      try {
        // Step 1: skip if we already recorded this Jira issue ↔ Trello card pair.
        const mapping = await getMappingByJiraIssue(rule.environment_id, issue.key);
        if (mapping?.trello_card_id) {
          details.push({
            ruleId: rule.id,
            jiraIssueKey: issue.key,
            action: 'skipped_already_mapped',
          });
          continue;
        }

        // Step 2: card may exist on the Trello board (title/desc marker) without a DB mapping — link only.
        let card = await findTrelloCardByJiraIssue(
          credentials,
          rule.trello_board_id,
          issue.key
        );

        if (card) {
          await upsertItemMapping({
            environmentId: rule.environment_id,
            syncRuleId: rule.id,
            trelloCardId: card.id,
            jiraIssueKey: issue.key,
          });
          details.push({
            ruleId: rule.id,
            jiraIssueKey: issue.key,
            trelloCardId: card.id,
            action: 'skipped_already_in_trello',
          });
          continue;
        }

        // Step 3: no Trello card yet — create in the rule's target list and persist mapping.
        const fullIssue = await fetchJiraIssueDetails(credentials, issue.key);
        const plainDesc = jiraDescriptionToPlainText(fullIssue.description);
        card = await createTrelloCardFromIssue(
          credentials,
          rule.trello_source_column_id,
          fullIssue,
          plainDesc
        );
        await upsertItemMapping({
          environmentId: rule.environment_id,
          syncRuleId: rule.id,
          trelloCardId: card.id,
          jiraIssueKey: issue.key,
        });
        migrated += 1;
        details.push({
          ruleId: rule.id,
          direction: 'jira-to-trello',
          jiraIssueKey: issue.key,
          jiraIssueSummary: issue.summary,
          trelloCardId: card.id,
          trelloCardName: card.name,
          action: 'migrated',
          targetListName,
        });
      } catch (err) {
        details.push({
          ruleId: rule.id,
          jiraIssueKey: issue.key,
          error:
            err.response?.data?.errorMessages?.[0] ||
            err.response?.data?.message ||
            err.message,
        });
      }
    }

    return { migrated, details, direction };
  }

  // --- Trello → Jira: source = Trello list, destination = Jira status/column ---
  const board = resolveJiraBoardForRule(rule, jiraBoards);
  if (!board?.projectKey) {
    return {
      migrated: 0,
      details: [
        {
          ruleId: rule.id,
          error: 'Jira project not found for rule',
        },
      ],
    };
  }

  const project = {
    id: board.projectId,
    key: board.projectKey,
    name: board.projectName,
  };

  const targetColumnName = jiraTargetColumnName(rule, jiraBoards);

  // All open cards on the board, then keep only cards in the rule's source Trello list.
  const cards = await fetchTrelloBoardCards(credentials, rule.trello_board_id);
  const inSourceList = cards.filter(
    (card) => String(card.idList) === String(rule.trello_source_column_id)
  );

  for (const card of inSourceList) {
    try {
      // Step 1: skip if this Trello card already has a stored Jira issue key.
      const mapping = await getMappingByTrelloCard(rule.environment_id, card.id);
      if (mapping?.jira_issue_key) {
        details.push({
          ruleId: rule.id,
          trelloCardId: card.id,
          trelloCardName: card.name,
          action: 'skipped_already_mapped',
        });
        continue;
      }

      // Step 2: Jira issue may already exist (search by card) — link only, do not transition/move.
      let issue = await findJiraIssueByTrelloCard(credentials, project.key, card.id);
      if (issue) {
        await upsertItemMapping({
          environmentId: rule.environment_id,
          syncRuleId: rule.id,
          trelloCardId: card.id,
          jiraIssueKey: issue.key,
        });
        details.push({
          ruleId: rule.id,
          trelloCardId: card.id,
          trelloCardName: card.name,
          jiraIssueKey: issue.key,
          action: 'skipped_already_in_jira',
        });
        continue;
      }

      // Step 3: no Jira issue — create from card (incl. board transition), then map.
      const created = await createJiraIssueFromCard(
        credentials,
        project,
        card,
        rule.jira_target_column_id
      );
      await upsertItemMapping({
        environmentId: rule.environment_id,
        syncRuleId: rule.id,
        trelloCardId: card.id,
        jiraIssueKey: created.key,
      });
      migrated += 1;
      details.push({
        ruleId: rule.id,
        direction: 'trello-to-jira',
        trelloCardId: card.id,
        trelloCardName: card.name,
        jiraIssueKey: created.key,
        action: 'migrated',
        targetColumnName,
      });
    } catch (err) {
      details.push({
        ruleId: rule.id,
        trelloCardId: card.id,
        trelloCardName: card.name,
        error: err.response?.data?.errorMessages?.[0] || err.message,
      });
    }
  }

  return { migrated, details, direction: 'trello-to-jira' };
}
