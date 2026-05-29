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

/**
 * Trello → Jira: source list = trello_source_column_id, target status = jira_target_column_id.
 */
export async function syncRuleTrelloToJira(credentials, rule, jiraBoards) {
  const details = [];
  let synced = 0;
  const direction = 'trello-to-jira';

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

  const trelloSourceListId = rule.trello_source_column_id;

  const cards = await fetchTrelloBoardCards(credentials, rule.trello_board_id);
  const inSourceList = cards.filter(
    (card) => String(card.idList) === String(trelloSourceListId)
  );

  for (const card of inSourceList) {
    const result = await syncSingleTrelloCardToJira(
      credentials,
      rule,
      card,
      jiraBoards
    );
    synced += result.synced;
    details.push(...result.details);
  }

  return { synced, details };
}

/**
 * Jira → Trello: source status = jira_target_column_id, target list = trello_source_column_id.
 */
export async function syncRuleJiraToTrello(credentials, rule, jiraBoards) {
  const details = [];
  let synced = 0;
  const direction = 'jira-to-trello';

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
      let card = await findTrelloCardByJiraIssue(
        credentials,
        trelloBoardId,
        issue.key
      );

      if (!card) {
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
          jiraIssueSummary: issue.summary,
          trelloCardId: card.id,
          trelloCardName: card.name,
          action: 'created',
        });
      } else if (String(card.idList) !== String(trelloTargetListId)) {
        await moveTrelloCardToList(credentials, card.id, trelloTargetListId);
        details.push({
          ruleId: rule.id,
          direction,
          jiraIssueKey: issue.key,
          jiraIssueSummary: issue.summary,
          trelloCardId: card.id,
          trelloCardName: card.name,
          action: 'moved',
          targetListId: trelloTargetListId,
        });
      } else {
        details.push({
          ruleId: rule.id,
          direction,
          jiraIssueKey: issue.key,
          jiraIssueSummary: issue.summary,
          trelloCardId: card.id,
          trelloCardName: card.name,
          action: 'already_in_target',
        });
      }

      synced += 1;
    } catch (err) {
      details.push({
        ruleId: rule.id,
        direction,
        jiraIssueKey: issue.key,
        jiraIssueSummary: issue.summary,
        error:
          err.response?.data?.errorMessages?.[0] ||
          err.response?.data?.message ||
          err.message,
      });
    }
  }

  return { synced, details };
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

  const created = await createJiraIssueFromCard(credentials, project, card);
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
      const created = await createJiraIssueFromCard(credentials, project, card);
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
      trigger: 'webhook',
    });
  }

  return { synced, details };
}

/**
 * Sync a single Jira issue for one jira-to-trello rule when the issue is in the source status.
 */
export async function syncSingleJiraIssueToTrello(
  credentials,
  rule,
  issue,
  jiraBoards
) {
  const details = [];
  let synced = 0;
  const direction = 'jira-to-trello';

  const statusId = issue.statusId ?? issue.fields?.status?.id;
  const statusName = issue.statusName ?? issue.fields?.status?.name;
  if (!ruleMatchesIncomingJiraStatus(rule, statusId, statusName, jiraBoards)) {
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
      trigger: 'webhook',
    });
  }

  return { synced, details };
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
      console.log(`[Sync Engine] Running sync for rule ${rule.id} (${rule.name})`);
      const result = await syncSingleTrelloCardToJira(
        credentials,
        rule,
        card,
        jiraBoards
      );
      synced += result.synced;
      details.push(...result.details);
      console.log(`[Sync Engine] Rule ${rule.id} result:`, result.details);
    }

    return { synced, details, cardId: context.cardId, boardId: context.boardId };
  } catch (error) {
    console.error('[Sync Engine ERROR] Background synchronization failed:', error);
    if (error?.stack) {
      console.error(error.stack);
    }
    throw error;
  }
}

function resolveJiraStatusLabelForRule(rule, jiraBoards) {
  const board = resolveJiraBoardForRule(rule, jiraBoards);
  const column = board?.columns?.find(
    (col) => String(col.id) === String(rule.jira_target_column_id)
  );
  return column?.name ?? rule.jira_target_column_id;
}

/**
 * Process an incoming Jira webhook payload for an environment.
 */
export async function handleJiraWebhook(payload, environmentId) {
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

    const credentials = await loadEnvironmentCredentials(environmentId);
    const jiraBoards = await fetchJiraBoardsWithColumns(credentials);

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

    const issueForSync = {
      key: fullIssue.key,
      summary: fullIssue.summary,
      statusId: incomingStatusId,
      statusName: incomingStatusName,
    };

    console.log('[Jira Sync] Live issue from Jira API:', {
      key: issueForSync.key,
      statusId: issueForSync.statusId,
      statusName: issueForSync.statusName,
      summary: issueForSync.summary,
    });

    const matchingRules = rules.filter((rule) =>
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
      console.log(`[Jira Sync] Running sync for rule ${rule.id} (${rule.name})`);
      const result = await syncSingleJiraIssueToTrello(
        credentials,
        rule,
        issueForSync,
        jiraBoards
      );
      synced += result.synced;
      details.push(...result.details);
      console.log(`[Jira Sync] Rule ${rule.id} result:`, result.details);
    }

    return { synced, details, issueKey: issue.key };
  } catch (error) {
    console.error('[Jira Sync ERROR] Background process crashed:', error);
    if (error?.stack) {
      console.error(error.stack);
    }
    throw error;
  }
}

/**
 * Backfill: create destination items only for source items not yet linked (by ID/marker/mapping).
 * Does not move or transition items that already exist on both sides.
 */
export async function syncExistingItemsForRule(credentials, rule) {
  const jiraBoards = await fetchJiraBoardsWithColumns(credentials);
  const direction = rule.direction || DEFAULT_SYNC_DIRECTION;
  const details = [];
  let migrated = 0;

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
        const mapping = await getMappingByJiraIssue(rule.environment_id, issue.key);
        if (mapping?.trello_card_id) {
          details.push({
            ruleId: rule.id,
            jiraIssueKey: issue.key,
            action: 'skipped_already_mapped',
          });
          continue;
        }

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
          jiraIssueKey: issue.key,
          trelloCardId: card.id,
          trelloCardName: card.name,
          action: 'migrated',
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

  const cards = await fetchTrelloBoardCards(credentials, rule.trello_board_id);
  const inSourceList = cards.filter(
    (card) => String(card.idList) === String(rule.trello_source_column_id)
  );

  for (const card of inSourceList) {
    try {
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

      const created = await createJiraIssueFromCard(credentials, project, card);
      await transitionJiraIssueToStatus(
        credentials,
        created.key,
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
        trelloCardId: card.id,
        trelloCardName: card.name,
        jiraIssueKey: created.key,
        action: 'migrated',
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

/**
 * Run sync for all rules in an environment (per-rule direction).
 */
export async function runManualSync(credentials, environmentId) {
  const rules = await dbAll(
    'SELECT * FROM sync_rules WHERE environment_id = ? ORDER BY id',
    [environmentId]
  );
  if (rules.length === 0) {
    return {
      synced: 0,
      details: [],
      message: `No sync rules defined for environment ${environmentId}.`,
    };
  }

  const jiraBoards = await fetchJiraBoardsWithColumns(credentials);
  const details = [];
  let synced = 0;

  for (const rule of rules) {
    const direction = rule.direction || DEFAULT_SYNC_DIRECTION;
    const result =
      direction === 'jira-to-trello'
        ? await syncRuleJiraToTrello(credentials, rule, jiraBoards)
        : await syncRuleTrelloToJira(credentials, rule, jiraBoards);

    synced += result.synced;
    details.push(...result.details);
  }

  return { synced, details };
}
