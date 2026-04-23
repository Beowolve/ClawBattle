import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../../db/adapters/sqlite/connection.js';
import {
  enqueueRun, claimNextPending, completeAttempt, failAttempt, pauseRun,
  getRunQueue, getRunHistory, retryAttempt, resetErrors, resumeRun,
  hasRunPendingWork,
  getAttemptById,
} from '../../db/adapters/sqlite/queue.js';
import { createRunsQueueRouter } from './runs-queue.js';

const baseOpts = {
  runId: 'run-http-1',
  benchmarkVersion: '1.0',
  model: 'gpt-4o',
  provider: 'openrouter',
  promptVersion: 'v1',
  attemptsPerTarget: 2,
  startedAt: '2026-04-20T10:00:00Z',
  targets: [{ id: '1', type: 'battle' }, { id: '2', type: 'battle' }],
};

async function startServer(db, extra = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/runs', createRunsQueueRouter({
    getRunQueue: () => getRunQueue(db),
    getRunHistory: () => getRunHistory(db),
    retryAttempt: (id) => retryAttempt(db, id),
    resetErrors: (runId) => resetErrors(db, runId),
    resumeRun: (runId) => resumeRun(db, runId),
    hasRunPendingWork: (runId) => hasRunPendingWork(db, runId),
    getAttemptById: (id) => getAttemptById(db, id),
    ...extra,
  }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

test('GET /api/runs/queue returns non-done runs with attempts[]', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const { url, close } = await startServer(db);
  try {
    const res = await fetch(`${url}/api/runs/queue`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 1);
    assert.equal(body[0].run_id, 'run-http-1');
    assert.ok(Array.isArray(body[0].attempts));
    assert.equal(body[0].attempts.length, 4); // 2 targets × 2 attempts
  } finally {
    await close();
  }
});

test('GET /api/runs/history returns only done runs', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const { url, close } = await startServer(db);
  try {
    const res = await fetch(`${url}/api/runs/history`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 0); // nothing done yet
  } finally {
    await close();
  }
});

test('POST /api/runs/attempts/:id/retry flips error → pending', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claim = claimNextPending(db);
  failAttempt(db, claim.id, claim.claim_token, 'boom');

  const { url, close } = await startServer(db);
  try {
    const res = await fetch(`${url}/api/runs/attempts/${claim.id}/retry`, { method: 'POST' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.retried, true);
    const row = db.prepare('SELECT status FROM runs WHERE id=?').get(claim.id);
    assert.equal(row.status, 'pending');
  } finally {
    await close();
  }
});

test('POST /api/runs/attempts/:id/retry returns 409 when row is not error', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const row = db.prepare("SELECT id FROM runs WHERE status='pending' LIMIT 1").get();
  const { url, close } = await startServer(db);
  try {
    const res = await fetch(`${url}/api/runs/attempts/${row.id}/retry`, { method: 'POST' });
    assert.equal(res.status, 409);
  } finally {
    await close();
  }
});

test('POST /api/runs/attempts/:id/retry rejects invalid id', async () => {
  const db = openDb(':memory:');
  const { url, close } = await startServer(db);
  try {
    const res = await fetch(`${url}/api/runs/attempts/abc/retry`, { method: 'POST' });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test('POST /api/runs/:runId/reset-errors resets all errors of that run', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const c1 = claimNextPending(db);
  failAttempt(db, c1.id, c1.claim_token, 'boom');
  const c2 = claimNextPending(db);
  failAttempt(db, c2.id, c2.claim_token, 'boom');

  const { url, close } = await startServer(db);
  try {
    const res = await fetch(`${url}/api/runs/run-http-1/reset-errors`, { method: 'POST' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.resetCount, 2);
    const errors = db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status='error'").get().n;
    assert.equal(errors, 0);
  } finally {
    await close();
  }
});

test('POST /api/runs/:runId/resume restores paused rows and calls startResumedRun', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  pauseRun(db, 'run-http-1');
  let resumedFor = null;
  let resumedConcurrency = null;
  const { url, close } = await startServer(db, {
    startResumedRun: (runId, concurrency) => {
      resumedFor = runId;
      resumedConcurrency = concurrency;
    },
  });
  try {
    const res = await fetch(`${url}/api/runs/run-http-1/resume`, { method: 'POST' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.resumed, true);
    assert.ok(body.count > 0);
    assert.equal(resumedFor, 'run-http-1');
    assert.equal(resumedConcurrency, 1);
    const paused = db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status='paused'").get().n;
    assert.equal(paused, 0);
  } finally {
    await close();
  }
});

test('POST /api/runs/:runId/resume starts workers on a non-paused run with pending rows', async () => {
  // Scenario: workers exited without pausing (e.g. credits ran out, server
  // restart). Rows are pending/waiting, not paused. Resume should still
  // kick off workers.
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  let resumedFor = null;
  let resumedConcurrency = null;
  const { url, close } = await startServer(db, {
    startResumedRun: (runId, concurrency) => {
      resumedFor = runId;
      resumedConcurrency = concurrency;
    },
  });
  try {
    const res = await fetch(`${url}/api/runs/run-http-1/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concurrency: 5 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.resumed, true);
    assert.equal(body.count, 0); // nothing restored — nothing was paused
    assert.equal(body.concurrency, 5);
    assert.equal(resumedFor, 'run-http-1');
    assert.equal(resumedConcurrency, 5);
  } finally {
    await close();
  }
});

test('POST /api/runs/:runId/resume rejects invalid concurrency', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  let resumedCalls = 0;
  const { url, close } = await startServer(db, {
    startResumedRun: () => { resumedCalls++; },
  });
  try {
    const res = await fetch(`${url}/api/runs/run-http-1/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concurrency: 0 }),
    });
    assert.equal(res.status, 400);
    assert.equal(resumedCalls, 0);
  } finally {
    await close();
  }
});

test('POST /api/runs/:runId/resume returns 409 when run has no outstanding work', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, targets: [{ id: '1', type: 'battle' }], attemptsPerTarget: 1 });
  const claim = claimNextPending(db);
  completeAttempt(db, claim.id, claim.claim_token, { match: 100, score: 50 });
  const { url, close } = await startServer(db);
  try {
    const res = await fetch(`${url}/api/runs/run-http-1/resume`, { method: 'POST' });
    assert.equal(res.status, 409);
  } finally {
    await close();
  }
});

test('POST /api/runs/:runId/resume returns 409 when a worker is already active', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  let resumedCalls = 0;
  const { url, close } = await startServer(db, {
    isJobActive: () => true,
    startResumedRun: () => { resumedCalls++; },
  });
  try {
    const res = await fetch(`${url}/api/runs/run-http-1/resume`, { method: 'POST' });
    assert.equal(res.status, 409);
    assert.equal(resumedCalls, 0);
  } finally {
    await close();
  }
});

test('GET /api/runs/attempts/:id/request returns in-memory request trace for the attempt', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claim = claimNextPending(db);

  const { url, close } = await startServer(db, {
    buildAttemptPreview: async () => ({
      promptVersion: 'v1',
      chromeVersion: '140.0.0.0',
      width: 400,
      height: 300,
      isFollowup: false,
      computedPrompt: 'PROMPT',
      computedRequestBody: { model: 'moonshotai/kimi-k2.6' },
    }),
    getAttemptRequests: (runId, attemptId) => {
      assert.equal(runId, 'run-http-1');
      assert.equal(attemptId, claim.id);
      return [{
        requestAttempt: 1,
        provider: 'openrouter',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        requestBody: { model: 'moonshotai/kimi-k2.6' },
      }];
    },
  });

  try {
    const res = await fetch(`${url}/api/runs/attempts/${claim.id}/request`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.attemptId, claim.id);
    assert.equal(body.runId, 'run-http-1');
    assert.equal(body.targetId, '1');
    assert.equal(body.attempt, 1);
    assert.equal(body.computedPrompt, 'PROMPT');
    assert.equal(body.computedRequestBody.model, 'moonshotai/kimi-k2.6');
    assert.equal(body.capturedRequests.length, 1);
    assert.equal(body.capturedRequests[0].requestBody.model, 'moonshotai/kimi-k2.6');
  } finally {
    await close();
  }
});

test('GET /api/runs/attempts/:id/request returns computed preview even without captured requests', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claim = claimNextPending(db);

  const { url, close } = await startServer(db, {
    buildAttemptPreview: async () => ({
      promptVersion: 'v1',
      chromeVersion: '140.0.0.0',
      width: 400,
      height: 300,
      isFollowup: false,
      computedPrompt: 'PROMPT ONLY',
      computedRequestBody: { model: 'gpt-4o' },
    }),
    getAttemptRequests: () => [],
  });

  try {
    const res = await fetch(`${url}/api/runs/attempts/${claim.id}/request`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.computedPrompt, 'PROMPT ONLY');
    assert.equal(body.computedRequestBody.model, 'gpt-4o');
    assert.deepEqual(body.capturedRequests, []);
  } finally {
    await close();
  }
});

test('DELETE /api/runs/group is not swallowed by DELETE /api/runs/:runId', async () => {
  const db = openDb(':memory:');
  let deleteRunCalls = 0;
  let groupDeleteCalls = 0;

  const app = express();
  app.use(express.json());
  app.use('/api/runs', createRunsQueueRouter({
    getRunQueue: () => getRunQueue(db),
    getRunHistory: () => getRunHistory(db),
    retryAttempt: (id) => retryAttempt(db, id),
    resetErrors: (runId) => resetErrors(db, runId),
    resumeRun: (runId) => resumeRun(db, runId),
    hasRunPendingWork: (runId) => hasRunPendingWork(db, runId),
    deleteRun: () => {
      deleteRunCalls += 1;
      return 0;
    },
  }));
  app.delete('/api/runs/group', (req, res) => {
    groupDeleteCalls += 1;
    res.json({ ok: true });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${url}/api/runs/group`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(groupDeleteCalls, 1);
    assert.equal(deleteRunCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
