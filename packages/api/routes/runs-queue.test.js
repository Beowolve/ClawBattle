import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { openDb } from '../../db/adapters/sqlite/connection.js';
import {
  enqueueRun, claimNextPending, failAttempt, pauseRun,
  getRunQueue, getRunHistory, retryAttempt, resetErrors, resumeRun,
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
  const { url, close } = await startServer(db, {
    startResumedRun: (runId) => { resumedFor = runId; },
  });
  try {
    const res = await fetch(`${url}/api/runs/run-http-1/resume`, { method: 'POST' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.resumed, true);
    assert.ok(body.count > 0);
    assert.equal(resumedFor, 'run-http-1');
    const paused = db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status='paused'").get().n;
    assert.equal(paused, 0);
  } finally {
    await close();
  }
});

test('POST /api/runs/:runId/resume returns 409 when nothing is paused', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const { url, close } = await startServer(db);
  try {
    const res = await fetch(`${url}/api/runs/run-http-1/resume`, { method: 'POST' });
    assert.equal(res.status, 409);
  } finally {
    await close();
  }
});
