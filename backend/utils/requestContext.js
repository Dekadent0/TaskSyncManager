/**
 * Resolve environment id from HTTP request (query, header, or body).
 */

export function getEnvironmentIdFromRequest(req) {
  const fromQuery =
    req.query.environmentId || req.query.environment_id;
  const fromHeader =
    req.headers['x-environment-id'] || req.headers['x-environmentid'];

  const raw = fromQuery ?? fromHeader;
  const id = Number(raw);
  if (!raw || Number.isNaN(id) || id <= 0) {
    throw new Error(
      'Environment id is required. Pass ?environmentId=... or header x-environment-id.'
    );
  }
  return id;
}

export function resolveEnvironmentId(req, body = {}) {
  const fromBody = body.environmentId ?? body.environment_id;
  if (fromBody) return Number(fromBody);
  return getEnvironmentIdFromRequest(req);
}
