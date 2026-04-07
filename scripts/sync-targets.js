#!/usr/bin/env node
// Syncs battle_targets and daily_targets from Supabase into the local SQLite DB
// and downloads missing target images to images/battle/ and images/daily/.
//
// Usage:
//   node --env-file=.env scripts/sync-targets.js

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertBattleTarget, upsertDailyTarget } from '../packages/db/adapters/sqlite/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES_DIR = resolve(ROOT, 'targets', 'images');

const SUPABASE_URL = process.env.SUPABASE_TARGETS_URL;
const SUPABASE_KEY = process.env.SUPABASE_TARGETS_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: SUPABASE_TARGETS_URL and SUPABASE_TARGETS_KEY must be set (use --env-file=.env)');
  process.exit(1);
}

// --- Supabase REST fetch (paginated) ---
const PAGE_SIZE = 1000;

async function fetchTable(table) {
  const rows = [];
  let offset = 0;

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'count=none',
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${table} (offset ${offset}): HTTP ${res.status} – ${await res.text()}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

// --- Image download ---
function localImagePath(type, idOrKey, imageUrl) {
  const ext = extname(new URL(imageUrl).pathname) || '.png';
  return resolve(IMAGES_DIR, type, `${idOrKey}${ext}`);
}

async function downloadImage(imageUrl, destPath) {
  mkdirSync(dirname(destPath), { recursive: true });
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

// --- Sync battle_targets ---
console.log('Fetching battle_targets…');
const battleTargets = await fetchTable('battle_targets');
let battleImgCount = 0;

for (const t of battleTargets) {
  upsertBattleTarget(t);

  const dest = localImagePath('battle', t.id, t.image_url);
  if (!existsSync(dest)) {
    process.stdout.write(`  Downloading images/battle/${t.id}…`);
    await downloadImage(t.image_url, dest);
    process.stdout.write(' done\n');
    battleImgCount++;
  }
}
console.log(`battle_targets: ${battleTargets.length} synced, ${battleImgCount} image(s) downloaded\n`);

// --- Sync daily_targets ---
console.log('Fetching daily_targets…');
const dailyTargets = await fetchTable('daily_targets');
let dailyImgCount = 0;

for (const t of dailyTargets) {
  upsertDailyTarget(t);

  const dest = localImagePath('daily', t.key, t.image_url);
  if (!existsSync(dest)) {
    process.stdout.write(`  Downloading images/daily/${t.key}…`);
    await downloadImage(t.image_url, dest);
    process.stdout.write(' done\n');
    dailyImgCount++;
  }
}
console.log(`daily_targets: ${dailyTargets.length} synced, ${dailyImgCount} image(s) downloaded\n`);

console.log('Sync complete.');
