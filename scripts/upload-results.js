#!/usr/bin/env node
// Uploads local SQLite results (done attempts only) to Supabase.
// Queue state is local; only status='done' rows ever leave this process.
// Usage: node --env-file=.env scripts/upload-results.js

import { getResults } from '../packages/db/adapters/sqlite/index.js';
import { uploadToSupabase } from '../packages/db/sync.js';

const url = process.env.SUPABASE_RESULTS_URL;
const key = process.env.SUPABASE_RESULTS_KEY;
if (!url || !key) {
  console.error('Error: SUPABASE_RESULTS_URL and SUPABASE_RESULTS_KEY must be set');
  process.exit(1);
}

const runs = getResults();
console.log(`Uploading ${runs.length} completed run row(s)...`);
const { uploadedRuns, omittedColumns = [] } = await uploadToSupabase({ url, key, runs });
if (omittedColumns.length) {
  console.warn(`Warning: Supabase schema is missing optional column(s): ${omittedColumns.join(', ')}`);
  console.warn('Apply packages/db/schema.sql to the remote project to restore the full dashboard schema.');
}
console.log(`Done - ${uploadedRuns} runs upserted.`);
