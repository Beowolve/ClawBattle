// Queue + history routes for the DB-backed run system.
// Dependency-injected so tests can wire an in-memory DB + no-op job runner.

import express from 'express';

export function createRunsQueueRouter({
  getRunQueue,
  getRunHistory,
  retryAttempt,
  resetErrors,
  resumeRun,
  hasRunPendingWork, // (runId) => boolean — run has pending/waiting/running rows
  isJobActive,       // optional: (runId) => boolean — worker already running
  cancelJob,         // optional: (runId) => boolean — abort live worker pool
  startResumedRun,   // optional: (runId) => void — re-kicks worker pool for the run
  deleteRun,         // optional: (runId) => number — drops all rows of a run
  deleteAttempt,     // optional: (id)    => boolean — drops one attempt row
}) {
  const router = express.Router();

  // Augments each run with `worker_active` — true iff an in-memory worker pool
  // is actively processing it. DB status alone is not enough: after a crash or
  // credits-out abort, rows can stay 'running'/'pending' with no live worker.
  // The frontend uses this to decide Resume/Cancel visibility correctly.
  router.get('/queue', (req, res) => {
    const runs = getRunQueue();
    const withActivity = runs.map(r => ({
      ...r,
      worker_active: isJobActive ? Boolean(isJobActive(r.run_id)) : false,
    }));
    res.json(withActivity);
  });

  router.get('/history', (req, res) => {
    res.json(getRunHistory());
  });

  router.post('/attempts/:id/retry', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid attempt id' });
    }
    const ok = retryAttempt(id);
    if (!ok) return res.status(409).json({ error: 'attempt is not in error state' });
    res.json({ retried: true });
  });

  router.post('/:runId/reset-errors', (req, res) => {
    const { runId } = req.params;
    const changed = resetErrors(runId);
    res.json({ resetCount: changed });
  });

  // "Resume" is unified: it ensures workers are running for whatever
  // outstanding work the run has. This handles three cases:
  //   (a) the run was paused — restore paused rows, then start workers
  //   (b) workers exited without pausing (e.g. credits-out orphaned the
  //       queue, or the server restarted) — just start workers
  //   (c) the user reset errors on a non-paused run — same as (b)
  router.post('/:runId/resume', (req, res) => {
    const { runId } = req.params;
    if (isJobActive?.(runId)) {
      return res.status(409).json({ error: 'run is already active' });
    }
    const restored = resumeRun(runId);
    const hasWork = hasRunPendingWork?.(runId) ?? restored > 0;
    if (!hasWork && restored === 0) {
      return res.status(409).json({ error: 'run has no work to resume' });
    }
    startResumedRun?.(runId);
    res.json({ resumed: true, count: restored });
  });

  // Delete a single attempt row by primary key. If the row was 'running' the
  // worker's claim-token-protected writes become no-ops; no crash.
  router.delete('/attempts/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid attempt id' });
    }
    if (!deleteAttempt) return res.status(501).json({ error: 'delete not wired' });
    const ok = deleteAttempt(id);
    if (!ok) return res.status(404).json({ error: 'attempt not found' });
    res.json({ deleted: true });
  });

  // Delete the entire run. If workers are live, abort them first so they
  // stop claiming new rows before we drop everything.
  router.delete('/:runId', (req, res) => {
    const { runId } = req.params;
    if (!deleteRun) return res.status(501).json({ error: 'delete not wired' });
    if (isJobActive?.(runId)) cancelJob?.(runId);
    const removed = deleteRun(runId);
    if (removed === 0) return res.status(404).json({ error: 'run not found' });
    res.json({ deleted: true, count: removed });
  });

  return router;
}
