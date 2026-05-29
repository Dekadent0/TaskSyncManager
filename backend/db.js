/**
 * SQLite database connection, schema initialization, and query helpers.
 */

import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'node:util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = path.join(__dirname, 'database.sqlite');

export const db = new sqlite3.Database(DB_PATH);

const dbGetAsync = promisify(db.get.bind(db));
const dbAllAsync = promisify(db.all.bind(db));

function tryRenameColumn(table, from, to) {
  db.run(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`, (err) => {
    if (!err) return;
    const msg = String(err.message);
    if (
      msg.includes('no such column') ||
      msg.includes('duplicate column name')
    ) {
      return;
    }
    console.error(`Rename ${table}.${from} -> ${to}:`, msg);
  });
}

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      trello_api_key TEXT,
      trello_token TEXT,
      jira_domain TEXT,
      jira_email TEXT,
      jira_api_token TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS environments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      trello_api_key TEXT,
      trello_token TEXT,
      jira_domain TEXT,
      jira_email TEXT,
      jira_api_token TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      trello_board_id TEXT NOT NULL,
      trello_source_column_id TEXT NOT NULL,
      jira_project_id TEXT NOT NULL,
      jira_board_id TEXT,
      jira_target_column_id TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'trello-to-jira',
      environment_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_item_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      environment_id INTEGER NOT NULL,
      sync_rule_id INTEGER,
      trello_card_id TEXT NOT NULL,
      jira_issue_key TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(environment_id, trello_card_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS processed_trello_actions (
      action_id TEXT PRIMARY KEY,
      environment_id INTEGER NOT NULL,
      processed_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS webhook_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      environment_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      external_webhook_id TEXT,
      callback_url TEXT NOT NULL,
      secret TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(environment_id, provider, resource_id)
    )
  `);

  // Upgrade existing databases created before column names were unified.
  tryRenameColumn('environments', 'trello_key', 'trello_api_key');
  tryRenameColumn('environments', 'jira_token', 'jira_api_token');
});

/** Run a SELECT that returns one row (or undefined). */
export function dbGet(sql, params = []) {
  return dbGetAsync(sql, params);
}

/** Run a SELECT that returns many rows (empty array if none). */
export function dbAll(sql, params = []) {
  return dbAllAsync(sql, params).then((rows) => rows ?? []);
}

/** Run INSERT / UPDATE / DELETE; resolves with { lastID, changes }. */
export function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}
