#!/usr/bin/env node
// Downloads runs + run_state from Supabase into the local SQLite DB.
// Safe to run multiple times — already-present rows are skipped.
// Usage: node --env-file=.env scripts/download-results.js

import { upsertRuns, upsertRunStates } from '../packages/db/adapters/sqlite/index.js';
import { downloadFromSupabase } from '../packages/db/sync.js';

const url = process.env.SUPABASE_RESULTS_URL;
const key = process.env.SUPABASE_RESULTS_KEY;
if (!url || !key) { console.error('Error: SUPABASE_RESULTS_URL and SUPABASE_RESULTS_KEY must be set'); process.exit(1); }

console.log('Downloading from Supabase…');
const { fetchedRuns, insertedRuns, fetchedStates, insertedStates } =
  await downloadFromSupabase({ url, key, upsertRuns, upsertRunStates });

console.log(`runs:      ${insertedRuns} new / ${fetchedRuns} fetched`);
console.log(`run_state: ${insertedStates} new / ${fetchedStates} fetched`);
console.log('Done.');
