/**
 * In-memory recent sync activity per environment (for dashboard live log).
 */

import {
  formatUserActivityMessage,
  pickLoggableSyncDetails,
} from '../utils/syncActivityFormat.js';

const MAX_ENTRIES = 50;
const logsByEnvironment = new Map();

export function appendSyncActivity(environmentId, entry) {
  const envId = Number(environmentId);
  if (!envId || Number.isNaN(envId)) return;

  const message = entry.message?.trim();
  if (!message) return;
  if (entry.status === 'skipped' || entry.status === 'info') return;

  const list = logsByEnvironment.get(envId) ?? [];
  list.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date().toISOString(),
    status: entry.status === 'error' ? 'error' : 'ok',
    message,
  });

  if (list.length > MAX_ENTRIES) {
    list.length = MAX_ENTRIES;
  }

  logsByEnvironment.set(envId, list);
}

export function appendSyncResultActivity(environmentId, result, meta = {}) {
  for (const detail of pickLoggableSyncDetails(result?.details ?? [])) {
    appendSyncActivity(environmentId, {
      status: detail.error ? 'error' : 'ok',
      message: formatUserActivityMessage(detail),
      source: meta.source ?? 'webhook',
    });
  }
}

export function getSyncActivity(environmentId, limit = 30) {
  const envId = Number(environmentId);
  const list = logsByEnvironment.get(envId) ?? [];
  return list.slice(0, Math.min(limit, MAX_ENTRIES));
}
