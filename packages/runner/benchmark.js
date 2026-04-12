// Benchmark orchestrator
// Iterates targets, calls LLM, scores, saves results

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import { render, closeBrowser, getChromeVersion } from '../core/renderer.js';
import { score, computeScore, normalizeCode, PROXY_PERFECT_MATCH_THRESHOLD } from '../core/scorer.js';
import { saveAttempt, saveRunStart, saveRunEnd, getBattleTargets, getDailyTargets, getCompletedTargetIds } from '../db/index.js';

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
  promptVersion,
  reasoningEffort,
  runId: providedRunId, onProgress, signal,
}) {
  const runId = providedRunId ?? crypto.randomUUID();
  const startedAt = new Date().toISOString();

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

    let retryNum = 0;
    while (true) {
      if (signal?.aborted) throw new DOMException('Run cancelled', 'AbortError');

      if (retryNum > 0) {
        console.log(`[${def.id}] Retry ${retryNum}`);
        onProgress?.({ type: 'target_retry', targetId: def.id, targetName: def.name, retryNum });
      }

      console.log(`[${def.id}] ${def.name}`);
      onProgress?.({ type: 'target', targetId: def.id, targetName: def.name, targetCount: definitions.length });

      const scores = [];
      let allErrors = true;
      let previousRender = null;
      let previousCode = null;

      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (signal?.aborted) throw new DOMException('Run cancelled', 'AbortError');
        const isFollowup = attempt > 1 && previousRender !== null;
        const prompt = isFollowup
          ? buildFollowupPrompt(promptTemplate, followupAppendix, def, chromeVersion, previousCode)
          : buildPrompt(promptTemplate, def, chromeVersion);
        const images = isFollowup ? [targetBuffer, previousRender] : [targetBuffer];

        try {
          const t0 = Date.now();
          const { code: rawCode, tokensUsed, cost } = await adapter.generate({ model, prompt, images, reasoningEffort, signal });
          const durationMs = Date.now() - t0;
          const code = normalizeCode(rawCode);
          const rendered = await render(code);
          const { match, matchPercent, isProxyPerfect } = score(rendered, targetBuffer);
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
          console.error(`  [${def.id}] Attempt ${attempt} failed: ${err.message}`);
          scores.push(0);
          onProgress?.({ type: 'attempt_error', targetId: def.id, attempt, message: err.message });
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
        if (signal?.aborted) throw new DOMException('Run cancelled', 'AbortError');
        await runTarget(queue.shift());
      }
    }
  );

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
