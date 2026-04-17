// Benchmark orchestrator
// Iterates targets, calls LLM, scores, saves results

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import { render, closeBrowser, getChromeVersion } from '../core/renderer.js';
import { computeMatch, computeScore, PROXY_PERFECT_MATCH_THRESHOLD } from '../core/scorer.js';
import { sanitizeCode } from '../core/utils/code.js';
import { saveAttempt, saveRunStart, saveRunEnd, getBattleTargets, getDailyTargets, getCompletedTargetIds, getExistingAttempts } from '../db/index.js';

function abortPromise(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) return reject(new DOMException('Run cancelled', 'AbortError'));
    signal.addEventListener('abort', () => reject(new DOMException('Run cancelled', 'AbortError')), { once: true });
  });
}

function raceAbort(promise, signal) {
  if (!signal) return promise;
  return Promise.race([promise, abortPromise(signal)]);
}

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
  retries = 0,
  resumeRunId,
  fillMode = false,
  promptVersion,
  reasoningEffort,
  runId: providedRunId, onProgress, signal,
}) {
  const runId = providedRunId ?? crypto.randomUUID();
  const startedAt = new Date().toISOString();
  if (fillMode) retries = 0;

  console.log(`\nClawBattle Benchmark`);
  console.log(`  Run ID:              ${runId}`);
  console.log(`  Model:               ${model}`);
  console.log(`  Targets:             ${targetType}`);
  console.log(`  Attempts per target: ${attempts}`);
  console.log(`  Concurrency:         ${concurrency}`);
  console.log(`  Retries:             ${retries}\n`);

  const promptTemplate = fs.readFileSync(path.join(PROMPTS_DIR, promptVersion, 'prompt.md'), 'utf8');
  const followupAppendix = fs.readFileSync(path.join(PROMPTS_DIR, 'followup.md'), 'utf8');
  const chromeVersion = await getChromeVersion();

  const adapter = await resolveAdapter(provider);
  const definitions = loadDefinitions(targetType, targetId, targetFrom, targetTo);
  const results = [];

  const completedIds = resumeRunId ? getCompletedTargetIds(resumeRunId) : new Set();
  if (resumeRunId) {
    console.log(`  Resume from: ${resumeRunId}`);
    console.log(`  Completed target IDs found: [${[...completedIds].join(', ')}] (${completedIds.size} total)`);
  }

  const existingByTarget = fillMode
    ? getExistingAttempts({
        model,
        promptVersion: promptVersion ?? null,
        reasoningEffort: reasoningEffort ?? null,
        targetType,
        targetIds: definitions.map(d => d.id),
      })
    : new Map();
  if (fillMode) {
    const summary = definitions.map(d => {
      const e = existingByTarget.get(String(Math.round(Number(d.id))));
      return `${d.id}:${e?.maxAttempt ?? 0}/${attempts}`;
    }).join(' ');
    console.log(`  Fill mode: target attempt counts → ${summary}`);
  }

  const runMeta = { promptVersion, temperature: null, attemptsPerTarget: attempts, startedAt, reasoningEffort: reasoningEffort ?? null };

  saveRunStart({ runId, model, provider, promptVersion: promptVersion ?? null, reasoningEffort: reasoningEffort ?? null, startedAt });

  onProgress?.({
    type: 'start', runId, model, targetCount: definitions.length,
    targets: definitions.map(d => ({ id: d.id, name: d.name })),
  });

  async function runTarget(def) {
    const targetImagePath = path.join(TARGETS_DIR, 'images', targetType, `${def.id}.png`);
    const targetBuffer = fs.readFileSync(targetImagePath);

    // Resume: skip targets already completed in a prior run
    if (completedIds.has(String(def.id))) {
      console.log(`[${def.id}] Skipping (already completed in resumed run)`);
      onProgress?.({ type: 'target_skipped', targetId: def.id, targetName: def.name });
      onProgress?.({ type: 'target_done', targetId: def.id, targetName: def.name, bestMatch: null, bestScore: null, allErrors: false, skipped: true });
      return;
    }

    // Fill: skip targets that already have enough attempts
    const existing = fillMode ? existingByTarget.get(String(Math.round(Number(def.id)))) : null;
    const startAttempt = fillMode ? ((existing?.maxAttempt ?? 0) + 1) : 1;
    if (fillMode && startAttempt > attempts) {
      console.log(`[${def.id}] Fill: already at ${existing.maxAttempt}/${attempts} — skipping`);
      onProgress?.({ type: 'target_skipped', targetId: def.id, targetName: def.name });
      onProgress?.({ type: 'target_done', targetId: def.id, targetName: def.name, bestMatch: null, bestScore: null, allErrors: false, skipped: true });
      return;
    }

    let retryNum = 0;
    while (true) {
      if (signal?.aborted) throw new DOMException('Run cancelled', 'AbortError');

      if (retryNum > 0) {
        console.log(`[${def.id}] Retry ${retryNum}`);
        onProgress?.({ type: 'target_retry', targetId: def.id, targetName: def.name, retryNum });
      }

      console.log(`[${def.id}] ${def.name}${fillMode ? ` (fill ${startAttempt}–${attempts})` : ''}`);
      onProgress?.({ type: 'target', targetId: def.id, targetName: def.name, targetCount: definitions.length });

      const scores = [];
      let allErrors = true;
      let previousRender = null;
      let previousCode = null;

      // Fill: seed follow-up context by re-rendering the last stored attempt's code.
      if (fillMode && existing?.lastCode && startAttempt > 1) {
        try {
          const sanitized = sanitizeCode(existing.lastCode);
          previousCode = sanitized;
          previousRender = await raceAbort(render(sanitized, { signal }), signal);
          console.log(`  [${def.id}] Seeded follow-up context from attempt ${existing.maxAttempt}`);
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          console.warn(`  [${def.id}] Could not seed previous render: ${err.message} — continuing without follow-up context`);
          previousRender = null;
          previousCode = null;
        }
      }

      for (let attempt = startAttempt; attempt <= attempts; attempt++) {
        if (signal?.aborted) throw new DOMException('Run cancelled', 'AbortError');
        const isFollowup = attempt > 1 && previousRender !== null;
        const prompt = isFollowup
          ? buildFollowupPrompt(promptTemplate, followupAppendix, def, chromeVersion, previousCode)
          : buildPrompt(promptTemplate, def, chromeVersion);
        const images = isFollowup ? [targetBuffer, previousRender] : [targetBuffer];

        try {
          const t0 = Date.now();
          const { code: rawCode, tokensUsed, cost } = await raceAbort(
            adapter.generate({ model, prompt, images, reasoningEffort, signal }),
            signal,
          );
          const durationMs = Date.now() - t0;
          const code = sanitizeCode(rawCode);
          const rendered = await raceAbort(render(code, { signal }), signal);
          const { match, matchPercent, isProxyPerfect } = computeMatch(rendered, targetBuffer);
          const codeLength = code.length;
          const cssBattleScore = computeScore(codeLength, match);

          previousRender = rendered;
          previousCode = code;
          scores.push(matchPercent);
          allErrors = false;
          saveAttempt({
            runId, benchmarkVersion: BENCHMARK_VERSION, model, provider,
            ...runMeta,
            targetId: def.id, targetType, attempt,
            match: matchPercent, score: cssBattleScore,
            tokensUsed, cost, durationMs, code, codeLength,
          });

          console.log(`  [${def.id}] Attempt ${attempt}: ${matchPercent.toFixed(1)}%${isProxyPerfect ? ' (perfect)' : ''}`);
          onProgress?.({ type: 'attempt', targetId: def.id, attempt, matchPercent, perfect: isProxyPerfect });
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          const isPolicyViolation = err?.name === 'PolicyViolationError';
          if (isPolicyViolation) {
            console.warn(`  [${def.id}] Attempt ${attempt} rejected by policy: ${err.message}`);
          } else {
            console.error(`  [${def.id}] Attempt ${attempt} failed: ${err.message}`);
          }
          scores.push(0);
          onProgress?.({
            type: 'attempt_error',
            targetId: def.id,
            attempt,
            errorType: isPolicyViolation ? 'policy_violation' : 'runtime_error',
            message: err.message,
          });
        }
      }

      const bestMatch = scores.length ? Math.max(...scores) : 0;
      const perfect = scores.some(s => s >= PROXY_PERFECT_MATCH_THRESHOLD * 100);
      const bestScore = bestMatch; // matchPercent as reported in target_done

      onProgress?.({ type: 'target_done', targetId: def.id, targetName: def.name, bestMatch, bestScore, allErrors, skipped: false });

      if (allErrors && retryNum < retries) {
        retryNum++;
        continue;
      }

      results.push({ targetId: def.id, bestScore: bestMatch, scores, perfect, allErrors });
      break;
    }
  }

  const queue = [...definitions];
  const workers = Array.from(
    { length: Math.min(concurrency, definitions.length) },
    async () => {
      while (queue.length) {
        if (signal?.aborted) {
          queue.length = 0;
          throw new DOMException('Run cancelled', 'AbortError');
        }
        await runTarget(queue.shift());
      }
    }
  );

  // Drain queue as soon as abort fires so workers can't pick up more targets.
  signal?.addEventListener('abort', () => { queue.length = 0; }, { once: true });

  let finalStatus = 'done';
  let workerError;
  try {
    await Promise.all(workers);
    if (results.some(r => r.allErrors)) finalStatus = 'incomplete';
  } catch (err) {
    finalStatus = err.name === 'AbortError' ? 'cancelled' : 'error';
    workerError = err;
  } finally {
    try { await closeBrowser(); } catch { /* ignore browser-close errors */ }
    saveRunEnd({ runId, finishedAt: new Date().toISOString(), status: finalStatus });
  }
  if (workerError) throw workerError;

  const summary = buildSummary(results);
  const finishedAt = new Date().toISOString();

  console.log(`\nDone`);
  console.log(`  Avg Best Score (per target): ${summary.avgScore.toFixed(1)}%`);
  console.log(`  Perfect Rate: ${(summary.perfectRate * 100).toFixed(1)}%`);
  console.log(`  Run ID:       ${runId}\n`);

  onProgress?.({ type: 'done', runId, summary });

  return { runId, summary };
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

function buildPrompt(template, def, chromeVersion) {
  return template
    .replace('{{WIDTH}}', TARGET_WIDTH)
    .replace('{{HEIGHT}}', TARGET_HEIGHT)
    .replace('{{COLORS}}', def.colors.join(', '))
    .replace('{{CHROME_VERSION}}', chromeVersion);
}

function buildFollowupPrompt(template, appendix, def, chromeVersion, previousCode) {
  const base = buildPrompt(template, def, chromeVersion);
  return base + '\n' + appendix.replace('{{PREVIOUS_CODE}}', previousCode ?? '');
}

function buildSummary(results) {
  if (results.length === 0) return { avgScore: 0, perfectRate: 0, targetCount: 0 };
  const avgScore = results.reduce((s, r) => s + r.bestScore, 0) / results.length;
  const perfectRate = results.filter(r => r.perfect).length / results.length;
  return { avgScore, perfectRate, targetCount: results.length };
}

async function resolveAdapter(provider) {
  if (provider === 'openai') return import('../core/llm/openai.js');
  if (provider === 'ollama') return import('../core/llm/ollama.js');
  return import('../core/llm/openrouter.js'); // default
}
