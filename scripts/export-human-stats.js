#!/usr/bin/env node
// Exports per-target human baseline stats from Supabase leaderboard data.
//
// Usage:
//   node --env-file=.env scripts/export-human-stats.js
//   node --env-file=.env scripts/export-human-stats.js --source=battle_target_leaderboard_current_entries --output=baselines/human_stats.json
//
// Notes:
// - Defaults to cssbattle-feed's current leaderboard view.
// - rank100 is the lowest retained row after --max-per-target sorting.
// - p50/p90 are nearest-rank percentiles by score and preserve paired charCount.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHumanStats, fetchSupabaseRows } from '../packages/db/human-stats.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`Unknown argument format: ${arg}`);
    const idx = arg.indexOf('=');
    if (idx === -1) {
      out[arg.slice(2)] = true;
      continue;
    }
    out[arg.slice(2, idx)] = arg.slice(idx + 1);
  }
  return out;
}

function asPositiveInt(value, name, fallback) {
  if (value == null) return fallback;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

function printUsage() {
  console.log(`Export human baseline stats from Supabase leaderboard rows.

Required env:
  Preferred for cssbattle-feed:
    SUPABASE_FEED_URL + SUPABASE_FEED_KEY
    or SUPABASE_TARGETS_URL + SUPABASE_TARGETS_KEY
  Also supported:
    SUPABASE_URL + SUPABASE_SERVICE_KEY
    or SUPABASE_RESULTS_URL + SUPABASE_RESULTS_KEY

Options:
  --source=<relation[,relation...]> Source relation(s), tried in order
                                    default: battle_target_leaderboard_current_entries,target_leaderboards
  --output=<path>                  Output file (default: baselines/human_stats.json)
  --target-id-field=<name>         Target id field (default: target_id)
  --score-field=<name>             Score field (default: score)
  --char-field=<name>              Char count field (default: char_count)
  --target-type-field=<name>       Optional target type field (default: target_type)
  --target-type=<value|all>        Optional filter (default: all)
  --max-per-target=<n>             Max rows per target after sorting (default: 100)
  --top-n=<n>                      Top-N used for top10Avg pair (default: 10)
  --page-size=<n>                  Supabase page size (default: 1000)
  --schema-version=<version>       Output schema version (default: 2.2.0)
`);
}

function parseSourceList(value) {
  const raw = String(value ?? 'battle_target_leaderboard_current_entries,target_leaderboards');
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function isMissingRelationError(err) {
  const body = String(err?.responseBody ?? err?.message ?? '');
  return err?.status === 404 && (err?.code === 'PGRST205' || body.includes('Could not find the table'));
}

function resolveConnection(args) {
  const url = args.url
    ?? process.env.SUPABASE_FEED_URL
    ?? process.env.SUPABASE_TARGETS_URL
    ?? process.env.SUPABASE_URL
    ?? process.env.SUPABASE_RESULTS_URL;

  const key = args.key
    ?? process.env.SUPABASE_FEED_KEY
    ?? process.env.SUPABASE_TARGETS_KEY
    ?? process.env.SUPABASE_SERVICE_KEY
    ?? process.env.SUPABASE_RESULTS_KEY;

  return { url, key };
}

async function fetchFromSources({ sources, url, key, fields, filters, order, pageSize }) {
  const missing = [];
  for (const source of sources) {
    try {
      console.log(`Fetching leaderboard rows from Supabase (${source})…`);
      const rows = await fetchSupabaseRows({
        url,
        key,
        source,
        fields,
        filters,
        order,
        pageSize,
      });
      return { source, rows };
    } catch (err) {
      if (!isMissingRelationError(err)) throw err;
      missing.push(source);
      console.warn(`  -> Source not found in this DB schema: ${source}`);
    }
  }

  throw new Error(
    `None of the configured sources exist in this Supabase project: ${missing.join(', ')}.\n` +
    'Use --source=<relation> for your schema, or point URL/KEY to the cssbattle-feed Supabase project.'
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const { url, key } = resolveConnection(args);
  if (!url || !key) {
    throw new Error(
      'Missing Supabase credentials. Set SUPABASE_FEED_URL+SUPABASE_FEED_KEY ' +
      '(or SUPABASE_TARGETS_URL+SUPABASE_TARGETS_KEY / SUPABASE_URL+SUPABASE_SERVICE_KEY).'
    );
  }

  const sources = parseSourceList(args.source);
  if (sources.length === 0) throw new Error('No sources configured.');

  const outputPath = resolve(ROOT, String(args.output ?? 'baselines/human_stats.json'));
  const targetIdField = String(args['target-id-field'] ?? 'target_id');
  const scoreField = String(args['score-field'] ?? 'score');
  const charField = String(args['char-field'] ?? 'char_count');
  const targetTypeField = String(args['target-type-field'] ?? 'target_type');
  const targetType = String(args['target-type'] ?? 'all');
  const pageSize = asPositiveInt(args['page-size'], '--page-size', 1000);
  const maxPerTarget = asPositiveInt(args['max-per-target'], '--max-per-target', 100);
  const topN = asPositiveInt(args['top-n'], '--top-n', 10);
  const schemaVersion = String(args['schema-version'] ?? '2.2.0');

  const useTargetTypeFilter = targetType.toLowerCase() !== 'all';
  const fields = useTargetTypeFilter
    ? [...new Set([targetIdField, scoreField, charField, targetTypeField])]
    : [...new Set([targetIdField, scoreField, charField])];
  const filters = useTargetTypeFilter
    ? [[targetTypeField, `eq.${targetType}`]]
    : [];
  const order = [targetIdField, `${scoreField}.desc`, `${charField}.asc`];

  const { source, rows } = await fetchFromSources({
    sources,
    url,
    key,
    fields,
    filters,
    order,
    pageSize,
  });

  const data = buildHumanStats(rows, {
    schemaVersion,
    updatedAt: new Date().toISOString(),
    targetIdField,
    scoreField,
    charCountField: charField,
    maxPerTarget,
    topN,
  });

  const targetCount = Object.keys(data.targets).length;
  if (targetCount === 0) {
    throw new Error(`No target stats were produced from source "${source}". Check field names and filters.`);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);

  console.log(`Done. Exported ${targetCount} target(s) from ${source} to ${outputPath}`);
}

await main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
