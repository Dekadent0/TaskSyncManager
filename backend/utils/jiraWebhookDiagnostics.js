/**
 * Jira webhook diagnostics (user actor, loop/bot bypass hints).
 */

/**
 * Inspect who triggered the webhook and whether bot/loop bypass applies.
 */
export function evaluateJiraWebhookActor(payload) {
  const user = payload?.user;
  const triggeredByUser =
    user?.displayName ?? user?.name ?? user?.emailAddress ?? user?.accountId ?? null;

  const accountType = user?.accountType ?? null;
  const isAppActor = accountType === 'app';

  const botBypassEnabled = process.env.JIRA_WEBHOOK_ALLOW_BOT === 'true';
  const botBypassTriggered = botBypassEnabled && isAppActor;

  const changelog = payload?.changelog;
  const isStatusChange =
    changelog?.items?.some((item) => item.field === 'status') ?? false;

  const wouldSkipForLoop =
    isAppActor && !botBypassEnabled && !isStatusChange;

  const skip =
    process.env.JIRA_WEBHOOK_SKIP_APP_USER === 'true' && wouldSkipForLoop;

  const skipReason = skip
    ? 'App/bot actor with no status change (loop prevention; JIRA_WEBHOOK_SKIP_APP_USER=true)'
    : wouldSkipForLoop
      ? 'Would skip (app actor, no status change) but JIRA_WEBHOOK_SKIP_APP_USER is not true'
      : null;

  return {
    triggeredByUser,
    accountType,
    isAppActor,
    botBypassEnabled,
    botBypassTriggered,
    isStatusChange,
    wouldSkipForLoop,
    skip,
    skipReason,
    webhookEvent: payload?.webhookEvent ?? payload?.issue_event_type_name ?? null,
  };
}

export function logJiraIssueContext(payload) {
  const issue = payload?.issue;
  console.log(
    '[Jira Sync] Processing issue:',
    issue?.key ?? '(no key)',
    'Status:',
    issue?.fields?.status?.name ?? '(unknown)',
    'Status ID:',
    issue?.fields?.status?.id ?? '(unknown)'
  );
}
