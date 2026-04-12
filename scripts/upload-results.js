#!/usr/bin/env node
// Uploads all local SQLite runs to Supabase (upsert).
// Run AFTER migrate-runs.js so meta fields are present.
//
// Usage:
//   node --env-file=.env scripts/upload-results.js

import { getResults } from '../packages/db/adapters/sqlite/index.js';

const SB_URL = process.env.SUPABASE_RESULTS_URL;
const SB_KEY = process.env.SUPABASE_RESULTS_KEY;

if (!SB_URL || !SB_KEY) {
  console.error('Error: SUPABASE_RESULTS_URL and SUPABASE_RESULTS_KEY must be set');
  process.exit(1);
}

const BATCH_SIZE = 500;

async function upsertBatch(rows) {
  const res = await fetch(`${SB_URL}/rest/v1/runs`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`Supabase upsert failed: HTTP ${res.status} – ${await res.text()}`);
  }
}

console.log('Reading local runs…');
const rows = getResults();
console.log(`  ${rows.length} row(s) found\n`);

if (rows.length === 0) {
  console.log('Nothing to upload.');
  process.exit(0);
}

const total = rows.length;
let uploaded = 0;

for (let i = 0; i < total; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);
  process.stdout.write(`Uploading rows ${i + 1}–${Math.min(i + BATCH_SIZE, total)} of ${total}…`);
  await upsertBatch(batch);
  uploaded += batch.length;
  process.stdout.write(' done\n');
}

console.log(`\nUpload complete — ${uploaded} row(s) upserted to Supabase.`);
