// ClawBattle API – serves results and targets to the dashboard
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import {
  getResults, getResultsCount, getLeaderboard, getInsights,
  getBattleTargets, getDailyTargets, deleteRunGroup,
  upsertRuns,
  getRunQueue, getRunHistory, retryAttempt, resetErrors, pauseRun, resumeRun,
  requeueStaleRunningAttempts,
} from '../db/index.js';
import { uploadToSupabase, uploadTargetsToSupabase, downloadFromSupabase } from '../db/sync.js';
import { runBenchmark } from '../runner/benchmark.js';
import { createJob, getJob, isJobActive, cancelJob, listActiveJobs, pushEvent, subscribe, unsubscribe } from './jobs.js';
import { createRunsQueueRouter } from './routes/runs-queue.js';
import { closeBrowser } from '../core/renderer.js';

const app = express();
const PORT = process.env.PORT ?? 3000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TARGETS_DIR = path.join(ROOT, 'targets');

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/config', (req, res) => {
  const promptsDir = path.join(ROOT, 'prompts');
  const available = fs.readdirSync(promptsDir)
    .filter(d => fs.statSync(path.join(promptsDir, d)).isDirectory())
    .sort();
  res.json({
    promptVersion: process.env.PROMPT_VERSION ?? 'v1',
    availablePromptVersions: available,
  });
});

app.get('/api/targets/battle', (req, res) => {
  res.json(getBattleTargets());
});

app.get('/api/targets/daily', (req, res) => {
  res.json(getDailyTargets());
});

app.get('/api/targets/battle/:id/image', (req, res) => {
  res.sendFile(path.join(TARGETS_DIR, 'images', 'battle', `${req.params.id}.png`));
});

app.get('/api/targets/daily/:key/image', (req, res) => {
  res.sendFile(path.join(TARGETS_DIR, 'images', 'daily', `${req.params.key}.png`));
});

app.get('/api/leaderboard', (req, res) => {
  const promptVersion = req.query.prompt_version || null;
  res.json(getLeaderboard(promptVersion));
});

app.get('/api/insights', (req, res) => {
  const promptVersion = req.query.prompt_version || null;
  res.json(getInsights(promptVersion));
});

app.get('/api/results', (req, res) => {
  const { limit, offset, sort, dir, run_id } = req.query;
  res.json(getResults({
    limit: limit != null ? Number(limit) : undefined,
    offset: offset != null ? Number(offset) : undefined,
    sort: sort || 'created_at',
    dir: dir || 'desc',
    runId: run_id || undefined,
  }));
});

app.get('/api/results/count', (req, res) => {
  const { run_id } = req.query;
  res.json({ count: getResultsCount({ runId: run_id || undefined }) });
});

// Queue/history/retry/resume/reset routes.
// Resume rewires a benchmark run against the now-pending DB rows; the worker
// pool picks them up via claimNextPending just like a fresh run.
app.use('/api/runs', createRunsQueueRouter({
  getRunQueue,
  getRunHistory,
  retryAttempt,
  resetErrors,
  resumeRun,
  startResumedRun: (runId) => {
    const meta = getRunQueue().find(r => r.run_id === runId);
    if (!meta) return;
    const signal = createJob(runId, {
      model: meta.model,
      provider: meta.provider,
      promptVersion: meta.prompt_version ?? null,
      reasoningEffort: meta.reasoning_effort ?? null,
    });
    runBenchmark({
      runId,
      model: meta.model,
      provider: meta.provider,
      targetType: 'battle',
      attempts: meta.attempts_per_target ?? 3,
      promptVersion: meta.prompt_version,
      reasoningEffort: meta.reasoning_effort ?? undefined,
      signal,
      concurrency: 1, // resumed runs keep whatever concurrency the user wanted next; default conservative
      onProgress: (event) => pushEvent(runId, event),
    }).catch((err) => {
      if (err.name === 'AbortError') pushEvent(runId, { type: 'cancelled' });
      else pushEvent(runId, { type: 'fatal_error', message: err.message });
    });
  },
}));

app.delete('/api/runs/group', (req, res) => {
  const { model, reasoningEffort = null, promptVersions } = req.body ?? {};
  if (!model) return res.status(400).json({ error: 'model required' });
  if (promptVersions != null && !Array.isArray(promptVersions)) {
    return res.status(400).json({ error: 'promptVersions must be an array when provided' });
  }

  try {
    res.json(deleteRunGroup({ model, reasoningEffort, promptVersions }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/runs/start', (req, res) => {
  const {
    model, provider = 'openrouter', attempts = 3, promptVersion = process.env.PROMPT_VERSION ?? 'v1',
    targetFrom, targetTo,
    concurrency = 1,
    retries = 0,
    resumeRunId,
    fillMode = false,
    reasoningEffort,
  } = req.body ?? {};
  if (!model) return res.status(400).json({ error: 'model required' });

  const runId = crypto.randomUUID();
  const signal = createJob(runId, { model, provider, promptVersion: promptVersion ?? null, reasoningEffort: reasoningEffort ?? null });

  if (resumeRunId) {
    console.log(`[API] Resume requested — resumeRunId: ${resumeRunId}`);
  }

  runBenchmark({
    runId, model, provider, targetType: 'battle', attempts, promptVersion, signal,
    concurrency: Number(concurrency),
    retries: Number(retries),
    resumeRunId: resumeRunId ?? undefined,
    fillMode: Boolean(fillMode),
    targetFrom: targetFrom != null ? Number(targetFrom) : undefined,
    targetTo: targetTo != null ? Number(targetTo) : undefined,
    reasoningEffort: reasoningEffort ?? undefined,
    onProgress: (event) => pushEvent(runId, event),
  }).catch((err) => {
    if (err.name === 'AbortError') {
      pushEvent(runId, { type: 'cancelled' });
    } else {
      pushEvent(runId, { type: 'fatal_error', message: err.message });
    }
  });

  res.json({ runId });
});

app.get('/api/runs/active', (req, res) => {
  res.json(listActiveJobs());
});

app.post('/api/runs/:runId/cancel', (req, res) => {
  const { runId } = req.params;
  if (!getJob(runId)) return res.status(404).json({ error: 'run not found' });
  // Abort in-flight LLM/render calls first so the worker releases the row.
  const cancelled = cancelJob(runId);
  // Then flip any remaining queue rows to paused so they're resumable.
  const paused = pauseRun(runId);
  res.json({ cancelled, paused });
});

app.get('/api/runs/:runId/progress', (req, res) => {
  const { runId } = req.params;
  if (!getJob(runId)) return res.status(404).json({ error: 'run not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  subscribe(runId, res);
  req.on('close', () => unsubscribe(runId, res));
});

app.get('/api/sync/config', (req, res) => {
  res.json({ configured: !!(process.env.SUPABASE_RESULTS_URL && process.env.SUPABASE_RESULTS_KEY) });
});

app.post('/api/sync/upload', async (req, res) => {
  const url = process.env.SUPABASE_RESULTS_URL;
  const key = process.env.SUPABASE_RESULTS_KEY;
  if (!url || !key) return res.status(400).json({ error: 'Supabase not configured in .env' });
  try {
    // getResults() already reads from attempt_results (done rows only),
    // so in-flight queue state never leaves the local process.
    const runs = getResults();
    const result = await uploadToSupabase({ url, key, runs });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/upload-targets', async (req, res) => {
  const url = process.env.SUPABASE_RESULTS_URL;
  const key = process.env.SUPABASE_RESULTS_KEY;
  if (!url || !key) return res.status(400).json({ error: 'Supabase not configured in .env' });
  try {
    const battleTargets = getBattleTargets();
    const dailyTargets = getDailyTargets();
    const result = await uploadTargetsToSupabase({ url, key, battleTargets, dailyTargets });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/download', async (req, res) => {
  const url = process.env.SUPABASE_RESULTS_URL;
  const key = process.env.SUPABASE_RESULTS_KEY;
  if (!url || !key) return res.status(400).json({ error: 'Supabase not configured in .env' });
  try {
    const result = await downloadFromSupabase({ url, key, upsertRuns });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Startup recovery: any `running` rows left over from a crashed/killed
// process had their in-memory workers disappear. Flip them back to `pending`
// so a fresh worker can re-claim them. Claim tokens get invalidated in the
// process.
const recovered = requeueStaleRunningAttempts();
if (recovered > 0) {
  console.log(`[API] Startup recovery: requeued ${recovered} stale running attempt(s)`);
}

const server = app.listen(PORT, () => console.log(`ClawBattle API running on :${PORT}`));

let shuttingDown = false;

async function shutdown(signal, exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[API] ${signal} received — shutting down`);

  for (const job of listActiveJobs()) {
    cancelJob(job.runId);
  }

  await new Promise(resolve => {
    server.close(() => resolve());
  });

  await closeBrowser().catch(() => {});
  process.exit(exitCode);
}

process.once('SIGINT', () => {
  void shutdown('SIGINT', 130);
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM', 143);
});
