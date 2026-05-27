/**
 * SQLite database connection, schema initialization, and query helpers.
 */

import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = path.join(__dirname, 'database.sqlite');

export const db = new sqlite3.Database(DB_PATH);

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
      trello_key TEXT,
      trello_token TEXT,
      jira_domain TEXT,
      jira_email TEXT,
      jira_token TEXT,
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

  const syncRuleMigrations = [
    'ALTER TABLE sync_rules ADD COLUMN environment_id INTEGER',
    'ALTER TABLE sync_rules ADD COLUMN jira_board_id TEXT',
    'ALTER TABLE sync_rules ADD COLUMN name TEXT',
    "ALTER TABLE sync_rules ADD COLUMN direction TEXT DEFAULT 'trello-to-jira'",
  ];

  for (const sql of syncRuleMigrations) {
    db.run(sql, (err) => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.error(`Migration failed (${sql}):`, err.message);
      }
    });
  }
});

export function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

export function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows ?? [])));
  });
}

export function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}
