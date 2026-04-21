import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './connection.js';
import { enqueueRun, claimNextPending, completeAttempt, failAttempt } from './queue.js';
import { getPreviousAttempt } from './previous-attempt.js';

const baseOpts = {
  runId: 'run-1',
  benchmarkVersion: '1.0',
  model: 'gpt-4o',
  provider: 'openrouter',
  promptVersion: 'v1',
  reasoningEffort: null,
  attemptsPerTarget: 3,
  startedAt: '2026-04-20T10:00:00Z',
  targets: [{ id: '1', type: 'battle' }],
};

const sampleResult = {
  match: 80, score: 70, code: '<div>attempt1</div>', codeLength: 20,
  tokensUsed: 100, cost: 0.001, durationMs: 1000, finishedAt: '2026-04-20T10:01:00Z',
};

test('getPreviousAttempt: returns null for attempt 1', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  assert.equal(getPreviousAttempt(db, 'run-1', '1', 1), null);
});

test('getPreviousAttempt: returns null when predecessor is not yet done', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  assert.equal(getPreviousAttempt(db, 'run-1', '1', 2), null);
});

test('getPreviousAttempt: returns code of the done predecessor', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const c1 = claimNextPending(db);
  completeAttempt(db, c1.id, c1.claim_token, sampleResult);
  const prev = getPreviousAttempt(db, 'run-1', '1', 2);
  assert.ok(prev);
  assert.equal(prev.code, '<div>attempt1</div>');
  assert.equal(prev.attempt, 1);
});

test('getPreviousAttempt: returns null when predecessor errored', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const c1 = claimNextPending(db);
  failAttempt(db, c1.id, c1.claim_token, 'boom');
  assert.equal(getPreviousAttempt(db, 'run-1', '1', 2), null);
});

test('getPreviousAttempt: scoped by (run_id, target_id)', () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, targets: [{ id: '1', type: 'battle' }, { id: '2', type: 'battle' }] });
  // complete target 1 attempt 1 only
  const c1 = claimNextPending(db);
  completeAttempt(db, c1.id, c1.claim_token, sampleResult);
  // target 2's attempt 2 must NOT see target 1's code
  assert.equal(getPreviousAttempt(db, 'run-1', '2', 2), null);
  assert.ok(getPreviousAttempt(db, 'run-1', '1', 2));
});

test('getPreviousAttempt: scoped by run_id', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  enqueueRun(db, { ...baseOpts, runId: 'run-2' });
  const c1 = claimNextPending(db);
  completeAttempt(db, c1.id, c1.claim_token, sampleResult);
  assert.equal(getPreviousAttempt(db, 'run-2', '1', 2), null);
});
