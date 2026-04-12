#!/usr/bin/env node
// Uploads local SQLite results (runs + run_state) to Supabase.
// Usage: node --env-file=.env scripts/upload-results.js

import { getResults, getRunMeta } from '../packages/db/adapters/sqlite/index.js';
import { uploadToSupabase } from '../packages/db/sync.js';

const url = process.env.SUPABASE_RESULTS_URL;
const key = process.env.SUPABASE_RESULTS_KEY;
if (!url || !key) { console.error('Error: SUPABASE_RESULTS_URL and SUPABASE_RESULTS_KEY must be set'); process.exit(1); }

const runs = getResults();
const runState = getRunMeta();
console.log(`Uploading ${runs.length} run row(s) and ${runState.length} run_state row(s)…`);
const { uploadedRuns, uploadedStates } = await uploadToSupabase({ url, key, runs, runState });
console.log(`Done — ${uploadedRuns} runs, ${uploadedStates} run_state rows upserted.`);
