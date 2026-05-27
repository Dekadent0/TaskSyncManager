/**
 * Normalize environment credential fields from API request bodies.
 * Accepts legacy keys (trello_key, jira_token) for backward compatibility.
 */
export function parseEnvironmentCredentialsBody(body = {}) {
  return {
    trello_api_key: body.trello_api_key ?? body.trello_key ?? '',
    trello_token: body.trello_token ?? '',
    jira_domain: body.jira_domain ?? '',
    jira_email: body.jira_email ?? '',
    jira_api_token: body.jira_api_token ?? body.jira_token ?? '',
  };
}

export const ENV_CREDENTIAL_COLUMNS =
  'trello_api_key, trello_token, jira_domain, jira_email, jira_api_token';

export const ENV_SELECT_COLUMNS = `id, name, ${ENV_CREDENTIAL_COLUMNS}, created_at, updated_at`;
