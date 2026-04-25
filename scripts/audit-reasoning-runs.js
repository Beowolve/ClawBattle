#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getReasoningOptions } from '../packages/core/model-reasoning.js';

const SAFE_OPENROUTER_DEFAULT_ONLY_MODELS = new Set([
  'qwen/qwen3.6-plus',
  'xiaomi/mimo-v2.5',
  'z-ai/glm-5v-turbo',
]);

function normalizeText(value) {
  return String(value ?? '').trim();
}

export function parseArgs(argv) {
  const opts = { dbPath: 'results/clawbattle.db', apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') {
      opts.apply = true;
    } else if (arg === '--db') {
      opts.dbPath = argv[++i];
    } else if (arg.startsWith('--db=')) {
      opts.dbPath = arg.slice('--db='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

export function getReasoningGroups(db) {
  return db.prepare(`
    SELECT provider, model, reasoning_effort, COUNT(*) AS rows, COUNT(DISTINCT run_id) AS runs
    FROM runs
    GROUP BY provider, model, reasoning_effort
    ORDER BY provider, model, reasoning_effort
  `).all();
}

function correctionFor(row) {
  const provider = normalizeText(row.provider);
  const model = normalizeText(row.model);
  const effort = row.reasoning_effort == null ? null : normalizeText(row.reasoning_effort);

  if (effort == null) return null;
  if (provider === 'ollama' && effort !== 'default') return 'default';
  if (
    provider === 'openrouter'
    && SAFE_OPENROUTER_DEFAULT_ONLY_MODELS.has(model)
    && effort === 'medium'
  ) {
    return 'default';
  }
  return null;
}

export function auditReasoningGroups(groups) {
  return groups.map((row) => {
    const effort = row.reasoning_effort == null ? null : normalizeText(row.reasoning_effort);
    const options = getReasoningOptions(row.provider, row.model);
    const isLegacyDefault = effort == null;
    const isValid = isLegacyDefault || options.includes(effort);
    const correction = correctionFor(row);
    return {
      ...row,
      options,
      status: isLegacyDefault ? 'legacy-default' : (isValid ? 'valid' : 'invalid'),
      correction,
    };
  });
}

export function applySafeCorrections(db, auditRows) {
  const stmt = db.prepare(`
    UPDATE runs
    SET reasoning_effort = ?
    WHERE provider = ?
      AND model = ?
      AND reasoning_effort = ?
  `);
  let updatedRows = 0;
  let updatedGroups = 0;

  db.exec('BEGIN');
  try {
    for (const row of auditRows) {
      if (!row.correction || row.reasoning_effort == null) continue;
      const { changes } = stmt.run(row.correction, row.provider, row.model, row.reasoning_effort);
      updatedRows += changes;
      updatedGroups += changes > 0 ? 1 : 0;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { updatedRows, updatedGroups };
}

export function formatAuditRows(rows) {
  if (!rows.length) return 'No reasoning groups found.';
  return rows.map((row) => {
    const effort = row.reasoning_effort ?? 'NULL';
    const correction = row.correction ? ` -> ${row.correction}` : '';
    return [
      row.status.padEnd(14),
      `${row.provider}/${row.model}`,
      `reasoning=${effort}${correction}`,
      `runs=${row.runs}`,
      `rows=${row.rows}`,
      `allowed=${row.options.join('|')}`,
    ].join('  ');
  }).join('\n');
}

export function runAudit({ dbPath = 'results/clawbattle.db', apply = false } = {}) {
  const db = new DatabaseSync(resolve(dbPath));
  try {
    const auditRows = auditReasoningGroups(getReasoningGroups(db));
    const result = apply ? applySafeCorrections(db, auditRows) : { updatedRows: 0, updatedGroups: 0 };
    return { auditRows, result };
  } finally {
    db.close();
  }
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const opts = parseArgs(process.argv.slice(2));
  const { auditRows, result } = runAudit(opts);
  console.log(formatAuditRows(auditRows));
  if (opts.apply) {
    console.log(`\nApplied safe corrections: ${result.updatedRows} rows in ${result.updatedGroups} groups.`);
  } else {
    console.log('\nDry run only. Re-run with --apply to apply safe corrections.');
  }
}
