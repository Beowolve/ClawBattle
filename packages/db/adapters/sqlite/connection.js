// Opens and initialises a SQLite database.
// Callers should use getDb() for the app singleton,
// or openDb(':memory:') to get an isolated instance for tests.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      benchmark_version TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      prompt_version TEXT,
      temperature REAL,
      attempts_per_target INTEGER,
      started_at TEXT,
      finished_at TEXT,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      match REAL NOT NULL,
      score REAL,
      tokens_used INTEGER,
      code TEXT,
      code_length INTEGER,
      cost REAL,
      duration_ms INTEGER,
      reasoning_effort TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS run_state (
      run_id           TEXT PRIMARY KEY,
      model            TEXT NOT NULL,
      provider         TEXT NOT NULL,
      prompt_version   TEXT,
      reasoning_effort TEXT,
      started_at       TEXT NOT NULL,
      finished_at      TEXT,
      status           TEXT NOT NULL DEFAULT 'running'
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_unique
      ON runs(run_id, target_id, attempt);

    CREATE TABLE IF NOT EXISTS battle_targets (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT NOT NULL,
      colors TEXT NOT NULL DEFAULT '[]',
      battle_number INTEGER NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_targets (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT NOT NULL,
      colors TEXT NOT NULL DEFAULT '[]',
      date TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
  `);
}

export function openDb(path) {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new DatabaseSync(path);
  initSchema(db);
  return db;
}

let singleton;

export function getDb() {
  if (!singleton) {
    const raw = process.env.SQLITE_PATH ?? 'results/clawbattle.db';
    singleton = openDb(resolve(ROOT, raw));
  }
  return singleton;
}
