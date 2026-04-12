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

console.log('Migration complete.');
