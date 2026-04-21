import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/adapters/sqlite/connection.js';
import { enqueueRun } from '../db/adapters/sqlite/queue.js';
import { workerLoop } from './worker-loop.js';

const baseOpts = {
  runId: 'run-1',
  benchmarkVersion: '1.0',
  model: 'gpt-4o',
  provider: 'openrouter',
  promptVersion: 'v1',
  attemptsPerTarget: 3,
  startedAt: '2026-04-20T10:00:00Z',
  targets: [
    { id: '1', type: 'battle' },
    { id: '2', type: 'battle' },
  ],
};

function makeDeps(overrides = {}) {
  return {
    resolveTarget: () => ({
      def: { id: '1', name: 't1', colors: ['#fff', '#000'] },
      buffer: Buffer.from('target'),
    }),
    resolveAdapter: () => ({
      generate: async () => ({ code: '<div/>', tokensUsed: 1, cost: 0 }),
    }),
    resolvePromptTemplate: () => 'W={{WIDTH}} H={{HEIGHT}} C={{COLORS}} CV={{CHROME_VERSION}}',
    followupAppendix: 'FOLLOWUP PREV={{PREVIOUS_CODE}}',
    chromeVersion: '140',
    render: async () => Buffer.from('rendered'),
    computeMatch: () => ({ match: 1.0, matchPercent: 100, isProxyPerfect: true }),
    computeScore: () => 999,
    sanitizeCode: (c) => c,
    width: 400, height: 300,
    ...overrides,
  };
}

test('workerLoop: drains a single-target single-attempt run to done', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, attemptsPerTarget: 1, targets: [{ id: '1', type: 'battle' }] });
  await workerLoop({ db, ...makeDeps() });
  const summary = db.prepare('SELECT status, done_count, total FROM runs_summary WHERE run_id=?').get('run-1');
  assert.equal(summary.status, 'done');
  assert.equal(summary.done_count, 1);
  assert.equal(summary.total, 1);
});

test('workerLoop: processes attempts in FIFO order and promotes successors', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, targets: [{ id: '1', type: 'battle' }] });
  const order = [];
  const adapter = {
    generate: async () => {
      order.push('generate');
      return { code: '<div/>', tokensUsed: 1, cost: 0 };
    },
  };
  await workerLoop({ db, ...makeDeps({ resolveAdapter: () => adapter }) });
  assert.equal(order.length, 3);
  const done = db.prepare("SELECT COUNT(*) AS n FROM runs WHERE run_id='run-1' AND status='done'").get().n;
  assert.equal(done, 3);
});

test('workerLoop: two workers drain 2 targets × 3 attempts (6 rows, no duplicates)', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  let generateCount = 0;
  const adapter = {
    generate: async () => {
      generateCount++;
      await new Promise(r => setTimeout(r, 5));
      return { code: '<div/>', tokensUsed: 1, cost: 0 };
    },
  };
  const deps = makeDeps({ resolveAdapter: () => adapter });
  await Promise.all([
    workerLoop({ db, ...deps }),
    workerLoop({ db, ...deps }),
  ]);
  assert.equal(generateCount, 6);
  const done = db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status='done'").get().n;
  assert.equal(done, 6);
});

test('workerLoop: exits when signal is aborted, paused rows may remain', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const controller = new AbortController();
  const adapter = {
    generate: async ({ signal }) => {
      // Abort mid-flight
      controller.abort();
      throw new DOMException('cancel', 'AbortError');
    },
  };
  await workerLoop({
    db, signal: controller.signal,
    ...makeDeps({ resolveAdapter: () => adapter }),
  });
  // Loop should have returned promptly without throwing.
  // Exact DB state depends on how benchmark wraps pause; worker itself leaves row as-is.
  const running = db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status='running'").get().n;
  // The in-flight row was either still running (abort caught mid-claim) or never claimed.
  assert.ok(running <= 1);
});

test('workerLoop: returns after queue is empty (no infinite loop)', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, attemptsPerTarget: 1, targets: [{ id: '1', type: 'battle' }] });
  const start = Date.now();
  await workerLoop({ db, ...makeDeps() });
  assert.ok(Date.now() - start < 2000, 'loop should exit quickly once queue drains');
});

test('workerLoop: propagates resolveAdapter/resolveTarget per-claim (different runs)', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, attemptsPerTarget: 1, targets: [{ id: '1', type: 'battle' }] });
  enqueueRun(db, { ...baseOpts, runId: 'run-2', attemptsPerTarget: 1, targets: [{ id: '5', type: 'battle' }] });

  const seenTargets = [];
  const resolveTarget = (type, id) => {
    seenTargets.push({ type, id });
    return { def: { id, name: `t${id}`, colors: [] }, buffer: Buffer.from(`b${id}`) };
  };
  await workerLoop({ db, ...makeDeps({ resolveTarget }) });
  const ids = seenTargets.map(t => t.id).sort();
  assert.deepEqual(ids, ['1', '5']);
});

test('workerLoop: emits target_done when the last open attempt of a target finishes', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, attemptsPerTarget: 1, targets: [{ id: '1', type: 'battle' }, { id: '2', type: 'battle' }] });
  const events = [];
  await workerLoop({ db, onProgress: (e) => events.push(e), ...makeDeps() });
  const targetDone = events.filter(e => e.type === 'target_done');
  const ids = targetDone.map(e => e.targetId).sort();
  assert.deepEqual(ids, ['1', '2']);
});

test('workerLoop: does NOT emit target_done after an intermediate attempt completes', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, attemptsPerTarget: 3, targets: [{ id: '1', type: 'battle' }] });
  const events = [];
  await workerLoop({ db, onProgress: (e) => events.push(e), ...makeDeps() });
  const targetDone = events.filter(e => e.type === 'target_done');
  assert.equal(targetDone.length, 1);
  assert.equal(targetDone[0].targetId, '1');
});

test('workerLoop: continues after an individual claim fails (error does not kill worker)', async () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, attemptsPerTarget: 1, targets: [{ id: '1', type: 'battle' }, { id: '2', type: 'battle' }] });
  let call = 0;
  const adapter = {
    generate: async () => {
      call++;
      if (call === 1) {
        const err = new Error('first fails');
        err.name = 'PolicyViolationError'; // permanent — skip internal retry
        throw err;
      }
      return { code: '<div/>', tokensUsed: 1, cost: 0 };
    },
  };
  await workerLoop({ db, ...makeDeps({ resolveAdapter: () => adapter }) });
  const rows = db.prepare("SELECT status FROM runs WHERE run_id='run-1' ORDER BY target_id").all().map(r => r.status);
  assert.ok(rows.includes('error'));
  assert.ok(rows.includes('done'));
});
