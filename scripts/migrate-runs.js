#!/usr/bin/env node
// Migrates an existing SQLite DB from the two-table schema (runs + run_meta)
// to the unified single-table schema (runs with meta fields).
//
// Safe to run multiple times — skips columns that already exist.
//
// Usage:
//   node --env-file=.env scripts/migrate-runs.js

import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const dbPath = resolve(process.env.SQLITE_PATH ?? 'results/clawbattle.db');
console.log(`Migrating: ${dbPath}\n`);

const db = new DatabaseSync(dbPath);

// --- 1. Add new columns to runs (if not present) ---
const newColumns = [
  ['prompt_version',      'TEXT'],
  ['temperature',         'REAL'],
  ['attempts_per_target', 'INTEGER'],
  ['started_at',          'TEXT'],
  ['finished_at',         'TEXT'],
  ['reasoning_effort',    'TEXT'],
];

const existingColumns = new Set(
  db.prepare("PRAGMA table_info(runs)").all().map(c => c.name)
);

for (const [col, type] of newColumns) {
  if (existingColumns.has(col)) {
    console.log(`  Column '${col}' already exists — skipping`);
  } else {
    db.exec(`ALTER TABLE runs ADD COLUMN ${col} ${type}`);
    console.log(`  Added column '${col}'`);
  }
}
console.log();

// --- 2. Check whether run_meta table exists ---
const hasRunMeta = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='run_meta'"
).get();

if (!hasRunMeta) {
  console.log('No run_meta table found — nothing to backfill.\n');
} else {
  // --- 3. Backfill meta fields from run_meta into runs ---
  const metaRows = db.prepare('SELECT * FROM run_meta').all();
  console.log(`Backfilling ${metaRows.length} run_meta row(s) into runs…`);

  const update = db.prepare(`
    UPDATE runs
    SET prompt_version      = ?,
        temperature         = ?,
        attempts_per_target = ?,
        started_at          = ?,
        finished_at         = ?
    WHERE run_id = ?
      AND prompt_version IS NULL
  `);

  let updated = 0;
  for (const m of metaRows) {
    const { changes } = update.run(
      m.prompt_version, m.temperature, m.attempts_per_target,
      m.started_at, m.finished_at,
      m.run_id,
    );
    updated += changes;
  }
  console.log(`  ${updated} run row(s) updated\n`);

  // --- 4. Drop run_meta ---
  db.exec('DROP TABLE run_meta');
  console.log('Dropped run_meta table\n');
}

// --- 5. Create run_state table (if not present) ---
db.exec(`
  CREATE TABLE IF NOT EXISTS run_state (
    run_id           TEXT PRIMARY KEY,
    model            TEXT NOT NULL,
    provider         TEXT NOT NULL,
    prompt_version   TEXT,
    reasoning_effort TEXT,
    started_at       TEXT NOT NULL,
    finished_at      TEXT,
    status           TEXT NOT NULL DEFAULT 'running'
  )
`);
console.log('run_state table ready\n');

// --- 6. Backfill run_state from runs ---
const existingRunState = new Set(
  db.prepare('SELECT run_id FROM run_state').all().map(r => r.run_id)
);

const runGroups = db.prepare(`
  SELECT run_id, model, provider, prompt_version, reasoning_effort,
         MIN(created_at) AS started_at,
         MAX(finished_at) AS finished_at
  FROM runs
  GROUP BY run_id
`).all();

const insert = db.prepare(`
  INSERT OR IGNORE INTO run_state (run_id, model, provider, prompt_version, reasoning_effort, started_at, finished_at, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let inserted = 0;
for (const r of runGroups) {
  if (existingRunState.has(r.run_id)) continue;
  const status = r.finished_at ? 'done' : 'running';
  insert.run(r.run_id, r.model, r.provider, r.prompt_version, r.reasoning_effort, r.started_at, r.finished_at, status);
  inserted++;
}
console.log(`Backfilled ${inserted} row(s) into run_state\n`);

console.log('Migration complete.');
