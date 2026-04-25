// Benchmark orchestrator
// Pre-inserts every (target, attempt) as a DB row via enqueueRun,
// then drives a pool of workerLoop() workers that claim rows atomically
// and process them through processClaim. Resume/fill are handled by
// skipping already-completed targets and (for fill) pre-seeding done rows.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import { render, getChromeVersion } from '../core/renderer.js';
import { computeMatch, computeScore, PROXY_PERFECT_MATCH_THRESHOLD } from '../core/scorer.js';
import { sanitizeCode } from '../core/utils/code.js';
import {
  getBattleTargets, getDailyTargets,
  getCompletedTargetIds, getExistingAttempts,
} from '../db/index.js';
import { getDb } from '../db/adapters/sqlite/connection.js';
import { enqueueRun } from '../db/adapters/sqlite/queue.js';
import { normalizeReasoningEffort } from '../core/model-reasoning.js';
import { workerLoop } from './worker-loop.js';

const BENCHMARK_VERSION = '1.0';
const TARGET_WIDTH = 400;
const TARGET_HEIGHT = 300;
const TARGETS_DIR = path.join(ROOT, 'targets');
const PROMPTS_DIR = path.join(ROOT, 'prompts');

export async function runBenchmark({
  model, provider, targetType = 'battle',
  targetId, targetFrom, targetTo,
  attempts = 3,
  concurrency = 1,
  retries = 0, // kept for signature compatibility; retries now happen per-attempt via UI
  resumeRunId,
  fillMode = false,
  promptVersion,
  reasoningEffort,
  runId: providedRunId, onProgress, signal,
}) {
  const normalizedReasoningEffort = normalizeReasoningEffort(provider, model, reasoningEffort);
  const runId = providedRunId ?? crypto.randomUUID();
  const startedAt = new Date().toISOString();

  console.log(`\nClawBattle Benchmark`);
  console.log(`  Run ID:              ${runId}`);
  console.log(`  Model:               ${model}${normalizedReasoningEffort ? ` [${normalizedReasoningEffort}]` : ''}`);
  console.log(`  Targets:             ${targetType}`);
  console.log(`  Attempts per target: ${attempts}`);
  console.log(`  Concurrency:         ${concurrency}\n`);

  const promptTemplate = fs.readFileSync(path.join(PROMPTS_DIR, promptVersion, 'prompt.md'), 'utf8');
  const followupAppendix = fs.readFileSync(path.join(PROMPTS_DIR, promptVersion, 'followup.md'), 'utf8');
  const chromeVersion = await getChromeVersion();
  const db = getDb();

  const adapterModule = await resolveAdapterModule(provider);
  const allDefs = loadDefinitions(targetType, targetId, targetFrom, targetTo);

  const completedIds = resumeRunId ? getCompletedTargetIds(resumeRunId) : new Set();
  if (resumeRunId) {
    console.log(`  Resume from: ${resumeRunId}`);
    console.log(`  Completed target IDs: [${[...completedIds].join(', ')}] (${completedIds.size} total)`);
  }

  const existingByTarget = fillMode
    ? getExistingAttempts({
        model,
        promptVersion: promptVersion ?? null,
        reasoningEffort: normalizedReasoningEffort,
        targetType,
        targetIds: allDefs.map(d => d.id),
      })
    : new Map();
  if (fillMode) {
    const summary = allDefs.map(d => {
      const e = existingByTarget.get(String(Math.round(Number(d.id))));
      return `${d.id}:${e?.maxAttempt ?? 0}/${attempts}`;
    }).join(' ');
    console.log(`  Fill mode: target attempt counts → ${summary}`);
  }

  // Classify targets: enqueue vs. skip. Skipped ones emit immediate target_done.
  const enqueueDefs = [];
  const seedOps = []; // { targetId, startAttempt, lastCode }
  const skippedDefs = [];
  for (const def of allDefs) {
    if (completedIds.has(String(def.id))) {
      skippedDefs.push(def);
      continue;
    }
    if (fillMode) {
      const existing = existingByTarget.get(String(Math.round(Number(def.id))));
      const startAttempt = (existing?.maxAttempt ?? 0) + 1;
      if (startAttempt > attempts) {
        skippedDefs.push(def);
        continue;
      }
      enqueueDefs.push(def);
      if (startAttempt > 1 && existing?.lastCode) {
        seedOps.push({ targetId: String(def.id), startAttempt, lastCode: existing.lastCode });
      }
    } else {
      enqueueDefs.push(def);
    }
  }

  onProgress?.({
    type: 'start', runId, model, targetCount: allDefs.length,
    targets: allDefs.map(d => ({ id: d.id, name: d.name })),
  });

  for (const def of skippedDefs) {
    console.log(`[${def.id}] Skipping (${fillMode ? 'already filled' : 'already completed'})`);
    onProgress?.({ type: 'target_skipped', targetId: def.id, targetName: def.name });
    onProgress?.({
      type: 'target_done', targetId: def.id, targetName: def.name,
      bestMatch: null, bestScore: null, allErrors: false, skipped: true,
    });
  }

  if (enqueueDefs.length === 0) {
    const summary = { avgScore: 0, perfectRate: 0, targetCount: 0 };
    onProgress?.({ type: 'done', runId, summary });
    return { runId, summary };
  }

  enqueueRun(db, {
    runId,
    benchmarkVersion: BENCHMARK_VERSION,
    model,
    provider,
    promptVersion: promptVersion ?? null,
    reasoningEffort: normalizedReasoningEffort,
    attemptsPerTarget: attempts,
    startedAt,
    targets: enqueueDefs.map(d => ({ id: d.id, type: targetType })),
  });

  // Fill mode: mark attempts 1..startAttempt-1 as 'done' so getPreviousAttempt
  // finds the seed code at attempt startAttempt-1, and flip attempt=startAttempt
  // from 'waiting' to 'pending' so a worker can claim it immediately.
  for (const { targetId, startAttempt, lastCode } of seedOps) {
    db.prepare(`
      UPDATE runs
      SET status = 'done', code = NULL
      WHERE run_id = ? AND target_id = ? AND attempt < ?
    `).run(runId, targetId, startAttempt);
    db.prepare(`
      UPDATE runs
      SET code = ?
      WHERE run_id = ? AND target_id = ? AND attempt = ?
    `).run(lastCode, runId, targetId, startAttempt - 1);
    db.prepare(`
      UPDATE runs
      SET status = 'pending'
      WHERE run_id = ? AND target_id = ? AND attempt = ? AND status = 'waiting'
    `).run(runId, targetId, startAttempt);
  }

  // Target lookup for workers.
  const defById = new Map(enqueueDefs.map(d => [String(d.id), d]));
  const bufferByKey = new Map();
  const resolveTarget = (type, tid) => {
    const norm = String(Math.round(Number(tid)));
    const def = defById.get(String(tid))
      ?? defById.get(norm)
      ?? [...defById.values()].find(d => String(Math.round(Number(d.id))) === norm);
    if (!def) throw new Error(`Target not found: type=${type} id=${tid}`);
    const key = `${type}/${def.id}`;
    let buffer = bufferByKey.get(key);
    if (!buffer) {
      buffer = fs.readFileSync(path.join(TARGETS_DIR, 'images', type, `${def.id}.png`));
      bufferByKey.set(key, buffer);
    }
    return { def, buffer };
  };

  const resolveAdapter = () => adapterModule;
  const resolvePromptTemplate = () => promptTemplate;

  const progressShim = createProgressShim(defById, onProgress);

  const workerCount = Math.max(1, Math.min(concurrency, enqueueDefs.length));
  const workers = Array.from({ length: workerCount }, () =>
    workerLoop({
      db, signal,
      runId,
      resolveTarget, resolveAdapter, resolvePromptTemplate,
      followupAppendix, chromeVersion,
      render, computeMatch, computeScore, sanitizeCode,
      width: TARGET_WIDTH, height: TARGET_HEIGHT,
      onProgress: progressShim,
    }),
  );

  // finished_at is stamped per-row by completeAttempt; run-level status is
  // derived from runs_summary by the dashboard — no extra bookkeeping here.
  await Promise.all(workers);

  const summary = buildSummaryFromDb(db, runId);
  console.log(`\nDone`);
  console.log(`  Avg Best Score (per target): ${summary.avgScore.toFixed(1)}%`);
  console.log(`  Perfect Rate: ${(summary.perfectRate * 100).toFixed(1)}%`);
  console.log(`  Run ID:       ${runId}\n`);

  onProgress?.({ type: 'done', runId, summary });
  return { runId, summary };
}

// Wraps raw worker events with per-target aggregation + console logging.
// Shared between fresh runs (runBenchmark) and resumed runs (resumeWorkers),
// so both paths log every attempt start/result/error identically.
function createProgressShim(defById, onProgress) {
  const targetState = new Map();
  function ensureState(targetId) {
    const key = String(targetId);
    if (!targetState.has(key)) {
      const def = defById.get(String(targetId))
        ?? defById.get(String(Math.round(Number(targetId))))
        ?? { id: targetId, name: String(targetId) };
      targetState.set(key, { def, scores: [], allErrors: true, emittedDone: false });
    }
    return targetState.get(key);
  }
  return (evt) => {
    if (evt.type === 'llm_request') {
      const providerSuffix = evt.provider ? ` via ${evt.provider}` : '';
      const retrySuffix = evt.requestAttempt && evt.requestAttempt > 1 ? ` (retry ${evt.requestAttempt})` : '';
      const providerRouting = evt.requestBody?.provider ? ` provider=${JSON.stringify(evt.requestBody.provider)}` : '';
      console.log(`  [${evt.targetId}] Attempt ${evt.attempt} request${retrySuffix} → ${evt.model}${providerSuffix}${providerRouting}`);
      onProgress?.(evt);
      return;
    }
    if (evt.type === 'attempt_start') {
      const tag = evt.isFollowup ? ' (follow-up)' : '';
      console.log(`  [${evt.targetId}] Attempt ${evt.attempt} starting — ${evt.model}${tag}`);
      onProgress?.(evt);
      return;
    }
    if (evt.type === 'attempt') {
      const s = ensureState(evt.targetId);
      s.scores.push(evt.matchPercent);
      s.allErrors = false;
      console.log(`  [${evt.targetId}] Attempt ${evt.attempt}: ${evt.matchPercent.toFixed(1)}%${evt.perfect ? ' (perfect)' : ''}`);
      onProgress?.(evt);
      return;
    }
    if (evt.type === 'llm_warning') {
      console.warn(`  [${evt.targetId}] Attempt ${evt.attempt} warning: ${evt.message}`);
      onProgress?.(evt);
      return;
    }
    if (evt.type === 'attempt_error') {
      ensureState(evt.targetId).scores.push(0);
      if (evt.errorType === 'policy_violation') {
        console.warn(`  [${evt.targetId}] Attempt ${evt.attempt} rejected by policy: ${evt.message}`);
      } else {
        console.error(`  [${evt.targetId}] Attempt ${evt.attempt} failed: ${evt.message}`);
      }
      onProgress?.(evt);
      return;
    }
    if (evt.type === 'target_done') {
      const s = ensureState(evt.targetId);
      if (!s.emittedDone) {
        s.emittedDone = true;
        const bestMatch = s.scores.length ? Math.max(...s.scores) : 0;
        onProgress?.({
          type: 'target_done', targetId: s.def.id, targetName: s.def.name,
          bestMatch, bestScore: bestMatch, allErrors: s.allErrors, skipped: false,
        });
      }
      return;
    }
    onProgress?.(evt);
  };
}

function buildSummaryFromDb(db, runId) {
  const rows = db.prepare(`
    SELECT target_id, MAX(match) AS best_match
    FROM runs
    WHERE run_id = ? AND status = 'done' AND match IS NOT NULL
    GROUP BY target_id
  `).all(runId);
  if (rows.length === 0) return { avgScore: 0, perfectRate: 0, targetCount: 0 };
  const avgScore = rows.reduce((s, r) => s + r.best_match, 0) / rows.length;
  const perfectRate = rows.filter(r => r.best_match >= PROXY_PERFECT_MATCH_THRESHOLD * 100).length / rows.length;
  return { avgScore, perfectRate, targetCount: rows.length };
}

function loadDefinitions(targetType, targetId, targetFrom, targetTo) {
  if (targetType === 'daily') {
    const all = getDailyTargets().map(t => ({ id: t.key, name: t.name, colors: t.colors }));
    return targetId ? all.filter(t => Number(t.id) === Number(targetId)) : all;
  }
  const all = getBattleTargets().map(t => ({ id: t.id, name: t.name, colors: t.colors }));
  if (targetId) return all.filter(t => Number(t.id) === Number(targetId));
  return all.filter(t => {
    const id = Number(t.id);
    if (targetFrom != null && id < targetFrom) return false;
    if (targetTo != null && id > targetTo) return false;
    return true;
  });
}

// Resumes an already-enqueued run by starting workers against the existing DB
// rows — no enqueueRun call. Use this when the run was paused/cancelled and
// its rows are already in the correct state (pending/waiting/error).
export async function resumeWorkers({
  runId, model, provider, promptVersion, reasoningEffort,
  concurrency = 1, signal, onProgress,
}) {
  const normalizedReasoningEffort = normalizeReasoningEffort(provider, model, reasoningEffort);
  const promptTemplate = fs.readFileSync(path.join(PROMPTS_DIR, promptVersion, 'prompt.md'), 'utf8');
  const followupAppendix = fs.readFileSync(path.join(PROMPTS_DIR, promptVersion, 'followup.md'), 'utf8');
  const chromeVersion = await getChromeVersion();
  const adapterModule = await resolveAdapterModule(provider);
  const db = getDb();

  const counts = db.prepare(`
    SELECT status, COUNT(*) AS n FROM runs WHERE run_id = ? GROUP BY status
  `).all(runId);
  const range = db.prepare(`
    SELECT MIN(CAST(target_id AS REAL)) AS lo, MAX(CAST(target_id AS REAL)) AS hi,
           COUNT(DISTINCT target_id) AS n
    FROM runs WHERE run_id = ?
  `).get(runId);
  const statusSummary = counts.map(c => `${c.status}:${c.n}`).join(' ') || '(empty)';
  console.log(`\nClawBattle Resume`);
  console.log(`  Run ID:      ${runId}`);
  console.log(`  Model:       ${model}${normalizedReasoningEffort ? ` [${normalizedReasoningEffort}]` : ''}`);
  console.log(`  Provider:    ${provider}`);
  console.log(`  Prompt:      ${promptVersion}`);
  console.log(`  Targets:     ${range?.n ?? 0} (id ${range?.lo ?? '?'}–${range?.hi ?? '?'})`);
  console.log(`  Concurrency: ${concurrency}`);
  console.log(`  Status:      ${statusSummary}\n`);

  const allDefs = getBattleTargets().map(t => ({ id: t.id, name: t.name, colors: t.colors }));
  const defById = new Map(allDefs.map(d => [String(d.id), d]));
  const bufferByKey = new Map();

  const resolveTarget = (type, tid) => {
    const norm = String(Math.round(Number(tid)));
    const def = defById.get(String(tid)) ?? defById.get(norm) ??
      [...defById.values()].find(d => String(Math.round(Number(d.id))) === norm);
    if (!def) throw new Error(`Target not found: type=${type} id=${tid}`);
    const key = `${type}/${def.id}`;
    if (!bufferByKey.has(key)) {
      bufferByKey.set(key, fs.readFileSync(path.join(TARGETS_DIR, 'images', type, `${def.id}.png`)));
    }
    return { def, buffer: bufferByKey.get(key) };
  };

  const progressShim = createProgressShim(defById, onProgress);

  const workerCount = Math.max(1, concurrency);
  const workers = Array.from({ length: workerCount }, () =>
    workerLoop({
      db, signal,
      runId,
      resolveTarget,
      resolveAdapter: () => adapterModule,
      resolvePromptTemplate: () => promptTemplate,
      followupAppendix, chromeVersion,
      render, computeMatch, computeScore, sanitizeCode,
      width: TARGET_WIDTH, height: TARGET_HEIGHT,
      onProgress: progressShim,
    }),
  );

  await Promise.all(workers);

  const summary = buildSummaryFromDb(db, runId);
  onProgress?.({ type: 'done', runId, summary });
  return { runId, summary };
}

async function resolveAdapterModule(provider) {
  if (provider === 'openai') return import('../core/llm/openai.js');
  if (provider === 'ollama') return import('../core/llm/ollama.js');
  return import('../core/llm/openrouter.js');
}
