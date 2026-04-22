import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/adapters/sqlite/connection.js';
import { enqueueRun, claimNextPending } from '../db/adapters/sqlite/queue.js';
import { processClaim } from './process-claim.js';

const baseOpts = {
  runId: 'run-1',
  benchmarkVersion: '1.0',
  model: 'gpt-4o',
  provider: 'openrouter',
  promptVersion: 'v1',
  attemptsPerTarget: 3,
  startedAt: '2026-04-20T10:00:00Z',
  targets: [{ id: '1', type: 'battle' }],
};

const targetDef = { id: '1', name: 'Target #1', colors: ['#fff', '#000'] };
const targetBuffer = Buffer.from('fake-target-png');
const promptTemplate = 'W={{WIDTH}} H={{HEIGHT}} C={{COLORS}} CV={{CHROME_VERSION}}';
const followupAppendix = 'FOLLOWUP PREV={{PREVIOUS_CODE}} MATCH={{PREVIOUS_MATCH}} SCORE={{PREVIOUS_SCORE}}';

function makeDeps(overrides = {}) {
  return {
    adapter: {
      generate: async () => ({ code: '<div>hi</div>', tokensUsed: 42, cost: 0.001 }),
    },
    render: async () => Buffer.from('rendered-png'),
    computeMatch: () => ({ match: 0.875, matchPercent: 87.5, isProxyPerfect: false }),
    computeScore: () => 700,
    sanitizeCode: (x) => x,
    ...overrides,
  };
}

function baseArgs(db, claim, overrides = {}) {
  return {
    db, claim,
    model: 'gpt-4o', reasoningEffort: null,
    promptTemplate, followupAppendix,
    targetDef, targetBuffer,
    width: 400, height: 300, chromeVersion: '140',
    ...makeDeps(overrides.deps),
    ...overrides,
  };
}

test('processClaim: attempt 1 — adapter prompt uses base template, result is stored', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claim = claimNextPending(db);

  let capturedPrompt, capturedImages;
  const adapter = {
    generate: async ({ prompt, images }) => {
      capturedPrompt = prompt;
      capturedImages = images;
      return { code: '<div>hi</div>', tokensUsed: 42, cost: 0.001 };
    },
  };
  const result = await processClaim(baseArgs(db, claim, { deps: { adapter } }));

  assert.equal(result.status, 'done');
  assert.ok(capturedPrompt.includes('W=400'));
  assert.ok(capturedPrompt.includes('H=300'));
  assert.ok(capturedPrompt.includes('CV=140'));
  assert.ok(!capturedPrompt.includes('FOLLOWUP'));
  assert.equal(capturedImages.length, 1);

  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(claim.id);
  assert.equal(row.status, 'done');
  assert.equal(row.match, 87.5);
  assert.equal(row.score, 700);
  assert.equal(row.code, '<div>hi</div>');
  assert.equal(row.code_length, '<div>hi</div>'.length);
  assert.equal(row.tokens_used, 42);
  assert.equal(row.cost, 0.001);
  assert.ok(row.duration_ms >= 0);
  assert.ok(row.finished_at);
});

test('processClaim: attempt 1 — successor promoted from waiting to pending', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claim = claimNextPending(db);
  await processClaim(baseArgs(db, claim));
  const next = db.prepare(`
    SELECT status FROM runs WHERE run_id='run-1' AND target_id='1' AND attempt=2
  `).get();
  assert.equal(next.status, 'pending');
});

test('processClaim: attempt 2 — previous code is re-rendered and injected into follow-up prompt', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);

  // Complete attempt 1 with specific code
  const c1 = claimNextPending(db);
  const adapter1 = {
    generate: async () => ({ code: '<p>first</p>', tokensUsed: 10, cost: 0.0001 }),
  };
  await processClaim(baseArgs(db, c1, { deps: { adapter: adapter1 } }));

  // Claim attempt 2
  const c2 = claimNextPending(db);
  assert.equal(c2.attempt, 2);

  let capturedPrompt, capturedImages;
  let renderCalls = 0;
  const adapter2 = {
    generate: async ({ prompt, images }) => {
      capturedPrompt = prompt;
      capturedImages = images;
      return { code: '<p>second</p>', tokensUsed: 20, cost: 0.0002 };
    },
  };
  const render = async (code) => {
    renderCalls++;
    return Buffer.from(`rendered:${code}`);
  };
  await processClaim(baseArgs(db, c2, { deps: { adapter: adapter2, render } }));

  assert.ok(capturedPrompt.includes('FOLLOWUP PREV=<p>first</p>'));
  // Score and match from attempt 1 (computeMatch → 87.5, computeScore → 700)
  assert.ok(capturedPrompt.includes('MATCH=87.50%'), `expected MATCH=87.50% in prompt, got: ${capturedPrompt}`);
  assert.ok(capturedPrompt.includes('SCORE=700.00'), `expected SCORE=700.00 in prompt, got: ${capturedPrompt}`);
  assert.equal(capturedImages.length, 2);
  // render called once for previous code + once for current result
  assert.equal(renderCalls, 2);
});

test('processClaim: adapter error → failAttempt sets status=error with message', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claim = claimNextPending(db);

  const adapter = {
    generate: async () => { throw new Error('api exploded'); },
  };
  const result = await processClaim(baseArgs(db, claim, { deps: { adapter } }));
  assert.equal(result.status, 'error');

  const row = db.prepare('SELECT status, error_message FROM runs WHERE id = ?').get(claim.id);
  assert.equal(row.status, 'error');
  assert.equal(row.error_message, 'api exploded');
});

test('processClaim: AbortError is re-thrown, no completeAttempt/failAttempt write', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claim = claimNextPending(db);

  const adapter = {
    generate: async () => { throw new DOMException('cancel', 'AbortError'); },
  };
  await assert.rejects(
    () => processClaim(baseArgs(db, claim, { deps: { adapter } })),
    (err) => err.name === 'AbortError',
  );
  const row = db.prepare('SELECT status FROM runs WHERE id = ?').get(claim.id);
  assert.equal(row.status, 'running'); // left as-is for caller to handle (pause etc.)
});

test('processClaim: onProgress emits attempt event on success', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claim = claimNextPending(db);
  const events = [];
  await processClaim(baseArgs(db, claim, {
    onProgress: (e) => events.push(e),
  }));
  const attemptEvt = events.find(e => e.type === 'attempt');
  assert.ok(attemptEvt);
  assert.equal(attemptEvt.targetId, '1');
  assert.equal(attemptEvt.attempt, 1);
  assert.equal(attemptEvt.matchPercent, 87.5);
});

test('processClaim: onProgress emits attempt_error on failure with error type', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claim = claimNextPending(db);
  const events = [];
  const adapter = {
    generate: async () => {
      const e = new Error('policy!');
      e.name = 'PolicyViolationError';
      throw e;
    },
  };
  await processClaim(baseArgs(db, claim, {
    onProgress: (e) => events.push(e),
    deps: { adapter },
  }));
  const err = events.find(e => e.type === 'attempt_error');
  assert.ok(err);
  assert.equal(err.errorType, 'policy_violation');
  assert.equal(err.message, 'policy!');
});

test('processClaim: retries transient adapter errors and succeeds on 2nd attempt', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claim = claimNextPending(db);
  let calls = 0;
  const adapter = {
    generate: async () => {
      calls++;
      if (calls === 1) throw new Error('ECONNRESET');
      return { code: '<div/>', tokensUsed: 1, cost: 0 };
    },
  };
  const result = await processClaim(baseArgs(db, claim, {
    deps: { adapter },
    internalRetries: 2,
    internalRetryDelayMs: 0,
  }));
  assert.equal(result.status, 'done');
  assert.equal(calls, 2);
  const row = db.prepare('SELECT status FROM runs WHERE id = ?').get(claim.id);
  assert.equal(row.status, 'done');
});

test('processClaim: gives up after N internal retries and marks attempt as error', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claim = claimNextPending(db);
  let calls = 0;
  const adapter = {
    generate: async () => { calls++; throw new Error('rate limit'); },
  };
  const result = await processClaim(baseArgs(db, claim, {
    deps: { adapter },
    internalRetries: 2,
    internalRetryDelayMs: 0,
  }));
  assert.equal(result.status, 'error');
  assert.equal(calls, 3); // 1 initial + 2 retries
  const row = db.prepare('SELECT status, error_message FROM runs WHERE id = ?').get(claim.id);
  assert.equal(row.status, 'error');
  assert.equal(row.error_message, 'rate limit');
});

test('processClaim: does NOT retry PolicyViolationError (permanent)', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claim = claimNextPending(db);
  let calls = 0;
  const adapter = {
    generate: async () => {
      calls++;
      const err = new Error('blocked');
      err.name = 'PolicyViolationError';
      throw err;
    },
  };
  await processClaim(baseArgs(db, claim, {
    deps: { adapter },
    internalRetries: 2,
    internalRetryDelayMs: 0,
  }));
  assert.equal(calls, 1);
});

test('processClaim: does NOT retry AbortError (re-throws immediately)', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claim = claimNextPending(db);
  let calls = 0;
  const adapter = {
    generate: async () => {
      calls++;
      throw new DOMException('cancel', 'AbortError');
    },
  };
  await assert.rejects(
    () => processClaim(baseArgs(db, claim, {
      deps: { adapter },
      internalRetries: 2,
      internalRetryDelayMs: 0,
    })),
    (err) => err.name === 'AbortError',
  );
  assert.equal(calls, 1);
});

test('processClaim: tokensUsed=0 → failAttempt with refusal message', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claim = claimNextPending(db);

  const adapter = {
    generate: async () => ({ code: "I'm sorry, but I cannot assist with that request.", tokensUsed: 0, cost: 0 }),
  };
  const result = await processClaim(baseArgs(db, claim, { deps: { adapter } }));
  assert.equal(result.status, 'error');
  assert.ok(result.message.includes('0 tokens'));

  const row = db.prepare('SELECT status, error_message FROM runs WHERE id = ?').get(claim.id);
  assert.equal(row.status, 'error');
  assert.ok(row.error_message.includes('0 tokens'));
});

test('processClaim: previous render failure falls back to base prompt (no followup)', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const c1 = claimNextPending(db);
  await processClaim(baseArgs(db, c1, {
    deps: { adapter: { generate: async () => ({ code: 'BAD', tokensUsed: 1, cost: 0 }) } },
  }));

  const c2 = claimNextPending(db);
  let capturedPrompt, capturedImages;
  let firstRender = true;
  const render = async (code) => {
    if (firstRender) { firstRender = false; throw new Error('render blew up'); }
    return Buffer.from('ok');
  };
  const adapter = {
    generate: async ({ prompt, images }) => {
      capturedPrompt = prompt;
      capturedImages = images;
      return { code: '<div/>', tokensUsed: 1, cost: 0 };
    },
  };
  await processClaim(baseArgs(db, c2, { deps: { adapter, render } }));
  assert.ok(!capturedPrompt.includes('FOLLOWUP'));
  assert.equal(capturedImages.length, 1);
});
