#!/usr/bin/env node
// Uploads local battle_targets and daily_targets to Supabase.
// Run once to seed the DB, safe to re-run (upsert).
// Usage: node --env-file=.env scripts/upload-targets.js

import { getBattleTargets, getDailyTargets } from '../packages/db/adapters/sqlite/index.js';
import { uploadTargetsToSupabase } from '../packages/db/sync.js';

const url = process.env.SUPABASE_RESULTS_URL;
const key = process.env.SUPABASE_RESULTS_KEY;
if (!url || !key) { console.error('Error: SUPABASE_RESULTS_URL and SUPABASE_RESULTS_KEY must be set'); process.exit(1); }

const battleTargets = getBattleTargets();
const dailyTargets = getDailyTargets();
console.log(`Uploading ${battleTargets.length} battle targets, ${dailyTargets.length} daily targets…`);
const { uploadedBattle, uploadedDaily } = await uploadTargetsToSupabase({ url, key, battleTargets, dailyTargets });
console.log(`Done — ${uploadedBattle} battle, ${uploadedDaily} daily targets upserted.`);
