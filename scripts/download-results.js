#!/usr/bin/env node
// Downloads runs from Supabase into the local SQLite DB.
// Safe to run multiple times — already-present rows are skipped.
// Supabase only holds completed runs (see packages/db/sync.js).
// Usage: node --env-file=.env scripts/download-results.js

import { upsertRuns } from '../packages/db/adapters/sqlite/index.js';
import { downloadFromSupabase } from '../packages/db/sync.js';

const url = process.env.SUPABASE_RESULTS_URL;
const key = process.env.SUPABASE_RESULTS_KEY;
if (!url || !key) { console.error('Error: SUPABASE_RESULTS_URL and SUPABASE_RESULTS_KEY must be set'); process.exit(1); }

console.log('Downloading from Supabase…');
const { fetchedRuns, insertedRuns } = await downloadFromSupabase({ url, key, upsertRuns });

console.log(`runs: ${insertedRuns} new / ${fetchedRuns} fetched`);
console.log('Done.');
