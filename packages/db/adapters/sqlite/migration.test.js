import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openDb, initSchema } from './connection.js';

const NEW_COLS = ['status', 'error_message', 'enqueued_at', 'claimed_at', 'claim_token', 'paused_from'];

function legacyRunsDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE runs (
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
    CREATE UNIQUE INDEX idx_runs_unique ON runs(run_id, target_id, attempt);
  `);
  return db;
}

test('fresh DB has all new runs columns', () => {
  const db = openDb(':memory:');
  const names = db.prepare("PRAGMA table_info(runs)").all().map(c => c.name);
  for (const n of NEW_COLS) {
    assert.ok(names.includes(n), `column ${n} missing`);
  }
});

test('fresh DB: match column is nullable', () => {
  const db = openDb(':memory:');
  const matchCol = db.prepare("PRAGMA table_info(runs)").all().find(c => c.name === 'match');
  assert.equal(matchCol.notnull, 0);
});

test('fresh DB: status column is NOT NULL with default "done"', () => {
  const db = openDb(':memory:');
  const statusCol = db.prepare("PRAGMA table_info(runs)").all().find(c => c.name === 'status');
  assert.equal(statusCol.notnull, 1);
  db.prepare(`
    INSERT INTO runs (run_id, benchmark_version, model, provider, target_id, target_type, attempt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('r1', '1.0', 'gpt-4o', 'openrouter', '1', 'battle', 1);
  const row = db.prepare('SELECT status, enqueued_at FROM runs WHERE run_id = ?').get('r1');
  assert.equal(row.status, 'done');
  assert.ok(row.enqueued_at, 'enqueued_at should be auto-filled');
});

test('fresh DB: idx_runs_queue partial index exists', () => {
  const db = openDb(':memory:');
  const idx = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='runs' AND name='idx_runs_queue'
  `).get();
  assert.ok(idx, 'idx_runs_queue should exist');
});

test('legacy DB: initSchema adds new columns and preserves old rows', () => {
  const db = legacyRunsDb();
  db.prepare(`
    INSERT INTO runs (run_id, benchmark_version, model, provider, target_id, target_type, attempt, match, score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('legacy-1', '1.0', 'gpt-4o', 'openrouter', '1', 'battle', 1, 87.5, 600.0);

  initSchema(db);

  const names = db.prepare("PRAGMA table_info(runs)").all().map(c => c.name);
  for (const n of NEW_COLS) {
    assert.ok(names.includes(n), `column ${n} missing after migration`);
  }
  const row = db.prepare('SELECT run_id, match, score, status FROM runs WHERE run_id = ?').get('legacy-1');
  assert.equal(row.run_id, 'legacy-1');
  assert.equal(row.match, 87.5);
  assert.equal(row.score, 600.0);
  assert.equal(row.status, 'done');
});

test('legacy DB: match becomes nullable after migration', () => {
  const db = legacyRunsDb();
  initSchema(db);
  const matchCol = db.prepare("PRAGMA table_info(runs)").all().find(c => c.name === 'match');
  assert.equal(matchCol.notnull, 0);
  db.prepare(`
    INSERT INTO runs (run_id, benchmark_version, model, provider, target_id, target_type, attempt, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('r-pending', '1.0', 'gpt-4o', 'openrouter', '1', 'battle', 1, 'pending');
  const row = db.prepare('SELECT match FROM runs WHERE run_id = ?').get('r-pending');
  assert.equal(row.match, null);
});

test('legacy DB: unique index on (run_id, target_id, attempt) still present after migration', () => {
  const db = legacyRunsDb();
  initSchema(db);
  const idx = db.prepare(`
    SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='runs' AND name='idx_runs_unique'
  `).get();
  assert.ok(idx);
});

test('initSchema is idempotent', () => {
  const db = openDb(':memory:');
  const colsBefore = db.prepare("PRAGMA table_info(runs)").all();
  initSchema(db);
  initSchema(db);
  const colsAfter = db.prepare("PRAGMA table_info(runs)").all();
  assert.equal(colsAfter.length, colsBefore.length);
});

test('legacy DB: running migration twice is a no-op on the second call', () => {
  const db = legacyRunsDb();
  initSchema(db);
  const colsAfterFirst = db.prepare("PRAGMA table_info(runs)").all().length;
  initSchema(db);
  const colsAfterSecond = db.prepare("PRAGMA table_info(runs)").all().length;
  assert.equal(colsAfterSecond, colsAfterFirst);
});

test('orphan recovery: runs_new without runs is renamed to runs on initSchema', () => {
  // Simulate an interrupted migration: runs_new was created and populated,
  // runs was dropped, but the rename never completed.
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE runs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      benchmark_version TEXT NOT NULL DEFAULT '1.0',
      model TEXT NOT NULL DEFAULT 'gpt-4o',
      provider TEXT NOT NULL DEFAULT 'openrouter',
      prompt_version TEXT,
      temperature REAL,
      attempts_per_target INTEGER,
      started_at TEXT,
      finished_at TEXT,
      target_id TEXT NOT NULL DEFAULT '1',
      target_type TEXT NOT NULL DEFAULT 'battle',
      attempt INTEGER NOT NULL DEFAULT 1,
      match REAL,
      score REAL,
      tokens_used INTEGER,
      code TEXT,
      code_length INTEGER,
      cost REAL,
      duration_ms INTEGER,
      reasoning_effort TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'done',
      error_message TEXT,
      enqueued_at TEXT NOT NULL DEFAULT (datetime('now')),
      claimed_at TEXT,
      claim_token TEXT,
      paused_from TEXT
    );
    INSERT INTO runs_new (run_id, target_id) VALUES ('orphan-1', '1');
  `);

  // No 'runs' table at this point — exactly the interrupted-migration state.
  initSchema(db);

  // runs_new should be gone, runs should have the data.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.ok(!tables.includes('runs_new'), 'runs_new should not exist after recovery');
  assert.ok(tables.includes('runs'), 'runs should exist after recovery');
  const row = db.prepare("SELECT run_id FROM runs WHERE run_id = 'orphan-1'").get();
  assert.ok(row, 'orphaned row should be present in runs after recovery');
});

test('orphan recovery: stale runs_new alongside existing runs is dropped', () => {
  // Simulate a leftover runs_new from a previously completed migration.
  const db = openDb(':memory:');
  db.exec("CREATE TABLE runs_new (id INTEGER PRIMARY KEY, run_id TEXT NOT NULL)");
  db.exec("INSERT INTO runs_new (run_id) VALUES ('stale')");

  // initSchema must not blow up and must remove runs_new.
  initSchema(db);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.ok(!tables.includes('runs_new'), 'stale runs_new should be dropped');
  assert.ok(tables.includes('runs'), 'runs should still exist');
});
