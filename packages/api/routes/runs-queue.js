// Queue + history routes for the DB-backed run system.
// Dependency-injected so tests can wire an in-memory DB + no-op job runner.

import express from 'express';

export function createRunsQueueRouter({
  getRunQueue,
  getRunHistory,
  retryAttempt,
  resetErrors,
  resumeRun,
  startResumedRun, // optional: (runId) => void — re-kicks worker pool for the run
}) {
  const router = express.Router();

  router.get('/queue', (req, res) => {
    res.json(getRunQueue());
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

  router.post('/:runId/resume', (req, res) => {
    const { runId } = req.params;
    const changed = resumeRun(runId);
    if (changed === 0) {
      return res.status(409).json({ error: 'run has no paused attempts' });
    }
    startResumedRun?.(runId);
    res.json({ resumed: true, count: changed });
  });

  return router;
}
