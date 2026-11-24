const path = require('path');
const fs = require('fs');
const { openDatabase } = require('./sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('admin','manager','member')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  owner_id    INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','review','done')),
  priority    TEXT    NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  due_date    TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  from_status TEXT,
  to_status   TEXT    NOT NULL,
  note        TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_project  ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
`;

function createDb(file) {
  const target = file || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tasks.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = openDatabase(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

module.exports = { createDb };
