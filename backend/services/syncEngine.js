/**
 * Core sync engine: executes rules by direction (Trello ↔ Jira).
 */

import { dbAll } from '../db.js';
import { DEFAULT_SYNC_DIRECTION } from '../utils/ruleValidation.js';
import { fetchJiraBoardsWithColumns } from './jiraService.js';
import {
  fetchTrelloBoardCards,
  findTrelloCardByJiraIssue,
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
  const jiraTargetStatusId = rule.jira_target_column_id;

  const cards = await fetchTrelloBoardCards(credentials, rule.trello_board_id);
  const inSourceList = cards.filter(
    (card) => String(card.idList) === String(trelloSourceListId)
  );

  for (const card of inSourceList) {
    try {
      let issue = await findJiraIssueByTrelloCard(
        credentials,
        project.key,
        card.id
      );

      if (!issue) {
        const created = await createJiraIssueFromCard(
          credentials,
          project,
          card
        );
        issue = { key: created.key, fields: { status: null } };
        details.push({
          ruleId: rule.id,
          direction,
          trelloCardId: card.id,
          trelloCardName: card.name,
          action: 'created',
          jiraIssueKey: created.key,
        });
      }

      const currentStatusId = issue.fields?.status?.id;
      if (String(currentStatusId) !== String(jiraTargetStatusId)) {
        await transitionJiraIssueToStatus(
          credentials,
          issue.key,
          jiraTargetStatusId
        );
        details.push({
          ruleId: rule.id,
          direction,
          trelloCardId: card.id,
          trelloCardName: card.name,
          action: issue.fields?.status ? 'transitioned' : 'transitioned_after_create',
          jiraIssueKey: issue.key,
          targetStatusId: jiraTargetStatusId,
        });
      } else {
        details.push({
          ruleId: rule.id,
          direction,
          trelloCardId: card.id,
          trelloCardName: card.name,
          action: 'already_in_target',
          jiraIssueKey: issue.key,
        });
      }

      synced += 1;
    } catch (err) {
      details.push({
        ruleId: rule.id,
        direction,
        trelloCardId: card.id,
        trelloCardName: card.name,
        error: err.response?.data?.errorMessages?.[0] || err.message,
      });
    }
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

  const jiraSourceStatusId = rule.jira_target_column_id;
  const trelloTargetListId = rule.trello_source_column_id;
  const trelloBoardId = rule.trello_board_id;

  const issues = await fetchJiraBoardIssues(credentials, rule.jira_board_id);
  const inSourceStatus = issues.filter(
    (issue) => String(issue.statusId) === String(jiraSourceStatusId)
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
