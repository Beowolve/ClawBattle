// Long-running worker: claims the next pending attempt from the DB queue,
// processes it via processClaim, and repeats until the queue is drained or
// the abort signal fires. Multiple workers can run in parallel against the
// same DB; claimNextPending is atomic, so each row is processed exactly once.

import { claimNextPending, claimNextPendingForRun } from '../db/adapters/sqlite/queue.js';
import { processClaim } from './process-claim.js';

const IDLE_POLL_MS = 50;

function hasMoreWork(db, runId = null) {
  // 'waiting' rows only transition to 'pending' when a 'running' predecessor
  // calls completeAttempt. If no pending/running rows exist, no promotion can
  // happen and the workers should stop (orphaned 'waiting' rows from errors).
  const row = runId == null
    ? db.prepare(`
        SELECT COUNT(*) AS n FROM runs
        WHERE status IN ('pending', 'running')
      `).get()
    : db.prepare(`
        SELECT COUNT(*) AS n FROM runs
        WHERE run_id = ? AND status IN ('pending', 'running')
      `).get(runId);
  return row.n > 0;
}

function targetIsSettled(db, runId, targetId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM runs
    WHERE run_id = ? AND target_id = ?
      AND status IN ('pending', 'running', 'waiting', 'paused')
  `).get(runId, targetId);
  return row.n === 0;
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

export async function workerLoop({
  db, signal,
  runId = null,
  resolveTarget, resolveAdapter, resolvePromptTemplate,
  followupAppendix, chromeVersion,
  render, computeMatch, computeScore, sanitizeCode,
  width, height,
  onProgress,
}) {
  while (!signal?.aborted) {
    const claim = runId == null ? claimNextPending(db) : claimNextPendingForRun(db, runId);
    if (!claim) {
      if (!hasMoreWork(db, runId)) break;
      await sleep(IDLE_POLL_MS, signal);
      continue;
    }
    const { def, buffer } = resolveTarget(claim.target_type, claim.target_id);
    const adapter = resolveAdapter(claim.provider);
    const promptTemplate = resolvePromptTemplate(claim.prompt_version);
    try {
      await processClaim({
        db, claim,
        adapter, render, computeMatch, computeScore, sanitizeCode,
        model: claim.model,
        reasoningEffort: claim.reasoning_effort,
        reasoningMaxTokens: claim.reasoning_max_tokens,
        promptTemplate, followupAppendix,
        targetDef: def, targetBuffer: buffer,
        width, height, chromeVersion,
        onProgress, signal,
      });
      if (targetIsSettled(db, claim.run_id, claim.target_id)) {
        onProgress?.({ type: 'target_done', targetId: claim.target_id });
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      // processClaim already wrote error state for expected failures.
      // Unexpected throw (DB write failure, bug) — surface it once and stop.
      throw err;
    }
  }
}
