import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './connection.js';
import { enqueueRun, claimNextPending, completeAttempt, failAttempt, setAttemptPrompt, retryAttempt, resetErrors, pauseRun, resumeRun, requeueStaleRunningAttempts, getRunQueue, getRunHistory } from './queue.js';

const baseOpts = {
  runId: 'run-1',
  benchmarkVersion: '1.0',
  model: 'gpt-4o',
  provider: 'openrouter',
  promptVersion: 'v1',
  reasoningEffort: null,
  attemptsPerTarget: 3,
  startedAt: '2026-04-20T10:00:00Z',
  targets: [
    { id: '1', type: 'battle' },
    { id: '2', type: 'battle' },
  ],
};

test('enqueueRun inserts targets × attempts rows', () => {
  const db = openDb(':memory:');
  const inserted = enqueueRun(db, baseOpts);
  assert.equal(inserted, 6);
  const count = db.prepare('SELECT COUNT(*) AS n FROM runs WHERE run_id = ?').get('run-1').n;
  assert.equal(count, 6);
});

test('enqueueRun: attempt 1 rows are pending, attempts 2+ are waiting', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const rows = db.prepare(`
    SELECT target_id, attempt, status FROM runs
    WHERE run_id = ? ORDER BY target_id, attempt
  `).all('run-1');
  const expected = [
    { target_id: '1', attempt: 1, status: 'pending' },
    { target_id: '1', attempt: 2, status: 'waiting' },
    { target_id: '1', attempt: 3, status: 'waiting' },
    { target_id: '2', attempt: 1, status: 'pending' },
    { target_id: '2', attempt: 2, status: 'waiting' },
    { target_id: '2', attempt: 3, status: 'waiting' },
  ];
  assert.deepEqual(
    rows.map(r => ({ target_id: r.target_id, attempt: r.attempt, status: r.status })),
    expected,
  );
});

test('enqueueRun: all rows carry run-level metadata', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const rows = db.prepare('SELECT * FROM runs WHERE run_id = ?').all('run-1');
  for (const row of rows) {
    assert.equal(row.run_id, 'run-1');
    assert.equal(row.benchmark_version, '1.0');
    assert.equal(row.model, 'gpt-4o');
    assert.equal(row.provider, 'openrouter');
    assert.equal(row.prompt_version, 'v1');
    assert.equal(row.reasoning_effort, null);
    assert.equal(row.attempts_per_target, 3);
    assert.equal(row.started_at, '2026-04-20T10:00:00Z');
    assert.equal(row.target_type, 'battle');
    assert.ok(row.enqueued_at, 'enqueued_at should be auto-filled');
    assert.equal(row.match, null);
    assert.equal(row.score, null);
    assert.equal(row.finished_at, null);
  }
});

test('enqueueRun: large run (25 targets × 3 attempts = 75 rows)', () => {
  const db = openDb(':memory:');
  const targets = Array.from({ length: 25 }, (_, i) => ({ id: String(i + 1), type: 'battle' }));
  const inserted = enqueueRun(db, { ...baseOpts, targets });
  assert.equal(inserted, 75);

  const summary = db.prepare('SELECT * FROM runs_summary WHERE run_id = ?').get('run-1');
  assert.equal(summary.total, 75);
  assert.equal(summary.pending_count, 25);
  assert.equal(summary.waiting_count, 50);
  assert.equal(summary.status, 'queued');
});

test('enqueueRun: reasoning_effort is stored on all rows', () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, reasoningEffort: 'high' });
  const rows = db.prepare('SELECT reasoning_effort FROM runs WHERE run_id = ?').all('run-1');
  for (const r of rows) assert.equal(r.reasoning_effort, 'high');
});

test('enqueueRun: second call with same runId is a no-op (INSERT OR IGNORE)', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const first = db.prepare('SELECT COUNT(*) AS n FROM runs').get().n;
  const insertedSecond = enqueueRun(db, baseOpts);
  const second = db.prepare('SELECT COUNT(*) AS n FROM runs').get().n;
  assert.equal(first, 6);
  assert.equal(second, 6);
  assert.equal(insertedSecond, 0);
});

test('enqueueRun: different runIds produce independent rows', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  enqueueRun(db, { ...baseOpts, runId: 'run-2' });
  const total = db.prepare('SELECT COUNT(*) AS n FROM runs').get().n;
  assert.equal(total, 12);
});

test('enqueueRun: attemptsPerTarget = 1 only creates attempt 1 rows as pending', () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, attemptsPerTarget: 1 });
  const rows = db.prepare('SELECT attempt, status FROM runs WHERE run_id = ? ORDER BY target_id, attempt').all('run-1');
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.attempt, 1);
    assert.equal(r.status, 'pending');
  }
});

test('enqueueRun: target ids are stored as text', () => {
  const db = openDb(':memory:');
  enqueueRun(db, {
    ...baseOpts,
    targets: [{ id: 7, type: 'battle' }, { id: 'daily-key', type: 'daily' }],
    attemptsPerTarget: 1,
  });
  const rows = db.prepare('SELECT target_id, target_type FROM runs WHERE run_id = ? ORDER BY target_id').all('run-1');
  assert.equal(rows.length, 2);
  const byType = Object.fromEntries(rows.map(r => [r.target_type, r.target_id]));
  assert.equal(byType.battle, '7');
  assert.equal(byType.daily, 'daily-key');
});

// ─── claimNextPending ─────────────────────────────────────────────────────────

test('claimNextPending: returns null when nothing is pending', () => {
  const db = openDb(':memory:');
  assert.equal(claimNextPending(db), null);
});

test('claimNextPending: claims the oldest pending row and marks it running', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  assert.ok(claimed);
  assert.equal(claimed.status, 'running');
  assert.equal(claimed.attempt, 1);
  assert.ok(claimed.claim_token);
  assert.ok(claimed.claimed_at);
});

test('claimNextPending: never picks up waiting/error/paused/done rows', () => {
  const db = openDb(':memory:');
  // Two runs, but only the first has a pending row
  enqueueRun(db, baseOpts);
  db.prepare('UPDATE runs SET status = ? WHERE run_id = ? AND attempt = 1 AND target_id = ?').run('error', 'run-1', '1');
  db.prepare('UPDATE runs SET status = ? WHERE run_id = ? AND attempt = 1 AND target_id = ?').run('paused', 'run-1', '2');
  // No pending left
  assert.equal(claimNextPending(db), null);
});

test('claimNextPending: consecutive claims return different rows (FIFO)', () => {
  const db = openDb(':memory:');
  // Explicit enqueued_at to avoid ties within the same second
  const rows = [
    { targetId: '1', enqueuedAt: '2026-04-20T10:00:00Z' },
    { targetId: '2', enqueuedAt: '2026-04-20T10:00:01Z' },
    { targetId: '3', enqueuedAt: '2026-04-20T10:00:02Z' },
  ];
  for (const r of rows) {
    db.prepare(`
      INSERT INTO runs
        (run_id, benchmark_version, model, provider, target_id, target_type, attempt, status, enqueued_at)
      VALUES (?, '1.0', 'gpt-4o', 'openrouter', ?, 'battle', 1, 'pending', ?)
    `).run('run-1', r.targetId, r.enqueuedAt);
  }

  const c1 = claimNextPending(db);
  const c2 = claimNextPending(db);
  const c3 = claimNextPending(db);
  const c4 = claimNextPending(db);

  assert.equal(c1.target_id, '1');
  assert.equal(c2.target_id, '2');
  assert.equal(c3.target_id, '3');
  assert.equal(c4, null);
  assert.notEqual(c1.claim_token, c2.claim_token);
  assert.notEqual(c2.claim_token, c3.claim_token);
});

test('claimNextPending: FIFO across multiple runs by enqueued_at', () => {
  const db = openDb(':memory:');
  db.prepare(`
    INSERT INTO runs (run_id, benchmark_version, model, provider, target_id, target_type, attempt, status, enqueued_at)
    VALUES (?, '1.0', 'gpt-4o', 'openrouter', '1', 'battle', 1, 'pending', ?)
  `).run('run-older', '2026-04-20T10:00:00Z');
  db.prepare(`
    INSERT INTO runs (run_id, benchmark_version, model, provider, target_id, target_type, attempt, status, enqueued_at)
    VALUES (?, '1.0', 'gpt-4o', 'openrouter', '1', 'battle', 1, 'pending', ?)
  `).run('run-newer', '2026-04-20T10:00:05Z');

  const claimed = claimNextPending(db);
  assert.equal(claimed.run_id, 'run-older');
});

test('claimNextPending: marks only one row running per call', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  claimNextPending(db);
  const running = db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status = 'running'").get().n;
  assert.equal(running, 1);
});

test('claimNextPending: each claim generates a unique claim_token', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const c1 = claimNextPending(db);
  const c2 = claimNextPending(db);
  assert.ok(c1.claim_token);
  assert.ok(c2.claim_token);
  assert.notEqual(c1.claim_token, c2.claim_token);
});

test('claimNextPending: ignores waiting attempts (attempt 2+ before attempt 1 done)', () => {
  const db = openDb(':memory:');
  // 2 targets × 3 attempts — 2 pending, 4 waiting
  enqueueRun(db, baseOpts);
  // Claim both pending rows
  const a = claimNextPending(db);
  const b = claimNextPending(db);
  const c = claimNextPending(db);
  assert.ok(a);
  assert.ok(b);
  assert.equal(c, null);
  assert.equal(a.attempt, 1);
  assert.equal(b.attempt, 1);
});

// ─── completeAttempt ──────────────────────────────────────────────────────────

const sampleResult = {
  match: 87.5,
  score: 85.2,
  code: '<div></div>',
  codeLength: 11,
  tokensUsed: 1234,
  cost: 0.002,
  durationMs: 4200,
  finishedAt: '2026-04-20T10:05:00Z',
};

test('completeAttempt: marks running row as done with result fields', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  const ok = completeAttempt(db, claimed.id, claimed.claim_token, sampleResult);
  assert.equal(ok, true);
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(claimed.id);
  assert.equal(row.status, 'done');
  assert.equal(row.match, sampleResult.match);
  assert.equal(row.score, sampleResult.score);
  assert.equal(row.code, sampleResult.code);
  assert.equal(row.code_length, sampleResult.codeLength);
  assert.equal(row.tokens_used, sampleResult.tokensUsed);
  assert.equal(row.cost, sampleResult.cost);
  assert.equal(row.duration_ms, sampleResult.durationMs);
  assert.equal(row.finished_at, sampleResult.finishedAt);
  assert.equal(row.error_message, null);
});

test('completeAttempt: wrong claim_token does not update', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  const ok = completeAttempt(db, claimed.id, 'not-the-token', sampleResult);
  assert.equal(ok, false);
  const row = db.prepare('SELECT status FROM runs WHERE id = ?').get(claimed.id);
  assert.equal(row.status, 'running');
});

test('completeAttempt: row not in running state does not update', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const pending = db.prepare("SELECT id FROM runs WHERE status='pending' LIMIT 1").get();
  const ok = completeAttempt(db, pending.id, 'any-token', sampleResult);
  assert.equal(ok, false);
  const row = db.prepare('SELECT status FROM runs WHERE id = ?').get(pending.id);
  assert.equal(row.status, 'pending');
});

test('completeAttempt: promotes next waiting attempt (same run_id, target_id) to pending', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  completeAttempt(db, claimed.id, claimed.claim_token, sampleResult);
  const next = db.prepare(`
    SELECT status FROM runs
    WHERE run_id = ? AND target_id = ? AND attempt = ?
  `).get(claimed.run_id, claimed.target_id, claimed.attempt + 1);
  assert.equal(next.status, 'pending');
});

test('completeAttempt: does not touch waiting rows of other targets', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  completeAttempt(db, claimed.id, claimed.claim_token, sampleResult);
  const otherTarget = claimed.target_id === '1' ? '2' : '1';
  const other = db.prepare(`
    SELECT status FROM runs WHERE run_id = ? AND target_id = ? AND attempt = 2
  `).get(claimed.run_id, otherTarget);
  assert.equal(other.status, 'waiting');
});

test('completeAttempt: no-op when attempt has no successor', () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, attemptsPerTarget: 1 });
  const claimed = claimNextPending(db);
  const ok = completeAttempt(db, claimed.id, claimed.claim_token, sampleResult);
  assert.equal(ok, true);
  const row = db.prepare('SELECT status FROM runs WHERE id = ?').get(claimed.id);
  assert.equal(row.status, 'done');
});

test('completeAttempt: promotion chain — attempt 2 claimable after attempt 1 done', () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, targets: [{ id: '1', type: 'battle' }] });
  const a1 = claimNextPending(db);
  assert.equal(a1.attempt, 1);
  completeAttempt(db, a1.id, a1.claim_token, sampleResult);
  const a2 = claimNextPending(db);
  assert.ok(a2);
  assert.equal(a2.attempt, 2);
});

// ─── failAttempt ──────────────────────────────────────────────────────────────

test('failAttempt: marks row as error and stores error_message', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  const ok = failAttempt(db, claimed.id, claimed.claim_token, 'boom');
  assert.equal(ok, true);
  const row = db.prepare('SELECT status, error_message, finished_at FROM runs WHERE id = ?').get(claimed.id);
  assert.equal(row.status, 'error');
  assert.equal(row.error_message, 'boom');
  assert.ok(row.finished_at, 'finished_at should be set');
});

test('failAttempt: successors stay waiting (no auto-promotion, no skip)', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  failAttempt(db, claimed.id, claimed.claim_token, 'boom');
  const rows = db.prepare(`
    SELECT attempt, status FROM runs
    WHERE run_id = ? AND target_id = ? ORDER BY attempt
  `).all(claimed.run_id, claimed.target_id);
  assert.equal(rows[0].status, 'error');
  assert.equal(rows[1].status, 'waiting');
  assert.equal(rows[2].status, 'waiting');
});

test('failAttempt: wrong claim_token does not update', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  const ok = failAttempt(db, claimed.id, 'not-the-token', 'boom');
  assert.equal(ok, false);
  const row = db.prepare('SELECT status FROM runs WHERE id = ?').get(claimed.id);
  assert.equal(row.status, 'running');
});

test('failAttempt: row not in running state does not update', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const pending = db.prepare("SELECT id FROM runs WHERE status='pending' LIMIT 1").get();
  const ok = failAttempt(db, pending.id, 'any-token', 'boom');
  assert.equal(ok, false);
});

test('failAttempt: does not promote next waiting attempt', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  failAttempt(db, claimed.id, claimed.claim_token, 'boom');
  const next = db.prepare(`
    SELECT status FROM runs
    WHERE run_id = ? AND target_id = ? AND attempt = ?
  `).get(claimed.run_id, claimed.target_id, claimed.attempt + 1);
  assert.equal(next.status, 'waiting');
});

test('setAttemptPrompt: stores prompt text only for matching running claim', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  const ok = setAttemptPrompt(db, claimed.id, claimed.claim_token, 'PROMPT BODY');
  assert.equal(ok, true);
  const row = db.prepare('SELECT prompt_text FROM runs WHERE id = ?').get(claimed.id);
  assert.equal(row.prompt_text, 'PROMPT BODY');
  const bad = setAttemptPrompt(db, claimed.id, 'wrong-token', 'OTHER');
  assert.equal(bad, false);
});

test('stale claim protection: after pause-like token change, old worker cannot overwrite', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  // Simulate external state change (pause then re-claim with new token)
  db.prepare("UPDATE runs SET claim_token = 'fresh-token' WHERE id = ?").run(claimed.id);
  const ok = completeAttempt(db, claimed.id, claimed.claim_token, sampleResult);
  assert.equal(ok, false);
  const row = db.prepare('SELECT status FROM runs WHERE id = ?').get(claimed.id);
  assert.equal(row.status, 'running');
});

// ─── retryAttempt ─────────────────────────────────────────────────────────────

function erroredRow(db, opts = baseOpts) {
  enqueueRun(db, opts);
  const claimed = claimNextPending(db);
  failAttempt(db, claimed.id, claimed.claim_token, 'boom');
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(claimed.id);
}

test('retryAttempt: error → pending, clears error fields and claim state', () => {
  const db = openDb(':memory:');
  const row = erroredRow(db);
  db.prepare('UPDATE runs SET prompt_text = ? WHERE id = ?').run('OLD PROMPT', row.id);
  const ok = retryAttempt(db, row.id);
  assert.equal(ok, true);
  const updated = db.prepare('SELECT * FROM runs WHERE id = ?').get(row.id);
  assert.equal(updated.status, 'pending');
  assert.equal(updated.error_message, null);
  assert.equal(updated.prompt_text, null);
  assert.equal(updated.claimed_at, null);
  assert.equal(updated.claim_token, null);
  assert.equal(updated.finished_at, null);
});

test('retryAttempt: non-error row is not changed', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const pending = db.prepare("SELECT id FROM runs WHERE status='pending' LIMIT 1").get();
  const ok = retryAttempt(db, pending.id);
  assert.equal(ok, false);
  const row = db.prepare('SELECT status FROM runs WHERE id = ?').get(pending.id);
  assert.equal(row.status, 'pending');
});

test('retryAttempt: done row is not changed', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  completeAttempt(db, claimed.id, claimed.claim_token, sampleResult);
  const ok = retryAttempt(db, claimed.id);
  assert.equal(ok, false);
  const row = db.prepare('SELECT status FROM runs WHERE id = ?').get(claimed.id);
  assert.equal(row.status, 'done');
});

test('retryAttempt: after retry + success, next waiting attempt is promoted', () => {
  const db = openDb(':memory:');
  const errored = erroredRow(db, { ...baseOpts, targets: [{ id: '1', type: 'battle' }] });
  retryAttempt(db, errored.id);
  const again = claimNextPending(db);
  assert.ok(again);
  assert.equal(again.attempt, 1);
  completeAttempt(db, again.id, again.claim_token, sampleResult);
  const next = db.prepare(`
    SELECT status FROM runs WHERE run_id = ? AND target_id = ? AND attempt = 2
  `).get(errored.run_id, errored.target_id);
  assert.equal(next.status, 'pending');
});

test('retryAttempt: does not touch waiting successors', () => {
  const db = openDb(':memory:');
  const errored = erroredRow(db);
  retryAttempt(db, errored.id);
  const rows = db.prepare(`
    SELECT attempt, status FROM runs WHERE run_id = ? AND target_id = ? ORDER BY attempt
  `).all(errored.run_id, errored.target_id);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[1].status, 'waiting');
  assert.equal(rows[2].status, 'waiting');
});

// ─── resetErrors ──────────────────────────────────────────────────────────────

test('resetErrors: with runId, resets all error rows of that run to pending', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  // Produce 2 errors (both attempt 1 rows of run-1)
  const a = claimNextPending(db); failAttempt(db, a.id, a.claim_token, 'e1');
  const b = claimNextPending(db); failAttempt(db, b.id, b.claim_token, 'e2');
  const n = resetErrors(db, 'run-1');
  assert.equal(n, 2);
  const statuses = db.prepare(`
    SELECT status FROM runs WHERE run_id='run-1' AND attempt=1
  `).all().map(r => r.status).sort();
  assert.deepEqual(statuses, ['pending', 'pending']);
});

test('resetErrors: runId-scoped does not touch errors in other runs', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  enqueueRun(db, { ...baseOpts, runId: 'run-2' });
  const a = claimNextPending(db); failAttempt(db, a.id, a.claim_token, 'e1');
  // Force an error in run-2 directly
  db.prepare("UPDATE runs SET status='error', error_message='x' WHERE run_id='run-2' AND attempt=1 AND target_id='1'").run();
  const n = resetErrors(db, 'run-1');
  assert.equal(n, 1);
  const r2 = db.prepare("SELECT status FROM runs WHERE run_id='run-2' AND attempt=1 AND target_id='1'").get();
  assert.equal(r2.status, 'error');
});

test('resetErrors: without runId, resets all errors globally', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  enqueueRun(db, { ...baseOpts, runId: 'run-2' });
  db.prepare("UPDATE runs SET status='error' WHERE attempt=1 AND target_id='1'").run();
  const n = resetErrors(db);
  assert.equal(n, 2);
  const errors = db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status='error'").get().n;
  assert.equal(errors, 0);
});

test('resetErrors: clears error_message, finished_at, claim_token, claimed_at', () => {
  const db = openDb(':memory:');
  const errored = erroredRow(db);
  db.prepare('UPDATE runs SET prompt_text = ? WHERE id = ?').run('OLD PROMPT', errored.id);
  resetErrors(db, errored.run_id);
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(errored.id);
  assert.equal(row.status, 'pending');
  assert.equal(row.error_message, null);
  assert.equal(row.prompt_text, null);
  assert.equal(row.finished_at, null);
  assert.equal(row.claim_token, null);
  assert.equal(row.claimed_at, null);
});

test('resetErrors: returns 0 when no errors exist', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  assert.equal(resetErrors(db, 'run-1'), 0);
  assert.equal(resetErrors(db), 0);
});

test('resetErrors: does not touch pending/waiting/running/done rows', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db); // one row running
  // Other pending row: make it error
  db.prepare("UPDATE runs SET status='error' WHERE run_id='run-1' AND attempt=1 AND target_id='2'").run();
  const n = resetErrors(db, 'run-1');
  assert.equal(n, 1);
  const runningRow = db.prepare('SELECT status FROM runs WHERE id = ?').get(claimed.id);
  assert.equal(runningRow.status, 'running');
  const waitingCount = db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status='waiting'").get().n;
  assert.equal(waitingCount, 4);
});

// ─── pauseRun / resumeRun ─────────────────────────────────────────────────────

test('pauseRun: pending/waiting/running/error rows all become paused', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  claimNextPending(db); // one running
  db.prepare("UPDATE runs SET status='error' WHERE run_id='run-1' AND target_id='2' AND attempt=1").run();
  const n = pauseRun(db, 'run-1');
  assert.equal(n, 6);
  const statuses = db.prepare("SELECT status FROM runs WHERE run_id='run-1'").all().map(r => r.status);
  for (const s of statuses) assert.equal(s, 'paused');
});

test('pauseRun: does not affect other runs', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  enqueueRun(db, { ...baseOpts, runId: 'run-2' });
  pauseRun(db, 'run-1');
  const r2 = db.prepare("SELECT COUNT(*) AS n FROM runs WHERE run_id='run-2' AND status='paused'").get().n;
  assert.equal(r2, 0);
});

test('pauseRun: does not pause done rows', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  completeAttempt(db, claimed.id, claimed.claim_token, sampleResult);
  pauseRun(db, 'run-1');
  const done = db.prepare('SELECT status FROM runs WHERE id = ?').get(claimed.id);
  assert.equal(done.status, 'done');
});

test('pauseRun: stores original status in paused_from', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  claimNextPending(db); // target '1' attempt 1 becomes running
  db.prepare("UPDATE runs SET status='error' WHERE run_id='run-1' AND target_id='2' AND attempt=1").run();
  pauseRun(db, 'run-1');
  const row = (t, a) => db.prepare("SELECT paused_from FROM runs WHERE run_id='run-1' AND target_id=? AND attempt=?").get(t, a);
  // running → treated as pending (partial work discarded)
  assert.equal(row('1', 1).paused_from, 'pending');
  assert.equal(row('1', 2).paused_from, 'waiting');
  assert.equal(row('2', 1).paused_from, 'error');
  assert.equal(row('2', 2).paused_from, 'waiting');
});

test('pauseRun: clears partial results and claim fields on running rows', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  // Pretend the worker had written partial results before pause
  db.prepare(`
    UPDATE runs SET match=50, score=40, code='partial', code_length=7,
                    tokens_used=500, cost=0.001, duration_ms=1000, finished_at='2026-04-20T10:01:00Z',
                    prompt_text='PROMPT BODY'
    WHERE id = ?
  `).run(claimed.id);
  pauseRun(db, 'run-1');
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(claimed.id);
  assert.equal(row.match, null);
  assert.equal(row.score, null);
  assert.equal(row.code, null);
  assert.equal(row.code_length, null);
  assert.equal(row.tokens_used, null);
  assert.equal(row.cost, null);
  assert.equal(row.duration_ms, null);
  assert.equal(row.finished_at, null);
  assert.equal(row.prompt_text, null);
  assert.equal(row.claim_token, null);
  assert.equal(row.claimed_at, null);
});

test('pauseRun: in-flight completeAttempt from paused worker fails', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  pauseRun(db, 'run-1');
  const ok = completeAttempt(db, claimed.id, claimed.claim_token, sampleResult);
  assert.equal(ok, false);
  const row = db.prepare('SELECT status FROM runs WHERE id = ?').get(claimed.id);
  assert.equal(row.status, 'paused');
});

test('pauseRun: returns 0 when nothing to pause (run is fully done)', () => {
  const db = openDb(':memory:');
  enqueueRun(db, { runId: 'run-done', benchmarkVersion: '1.0', model: 'gpt-4o', provider: 'openrouter',
                   attemptsPerTarget: 1, targets: [{ id: '1', type: 'battle' }] });
  const c = claimNextPending(db);
  completeAttempt(db, c.id, c.claim_token, sampleResult);
  assert.equal(pauseRun(db, 'run-done'), 0);
});

test('resumeRun: restores original status from paused_from', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  claimNextPending(db);
  db.prepare("UPDATE runs SET status='error' WHERE run_id='run-1' AND target_id='2' AND attempt=1").run();
  pauseRun(db, 'run-1');
  const n = resumeRun(db, 'run-1');
  assert.equal(n, 6);
  const get = (t, a) => db.prepare("SELECT status, paused_from FROM runs WHERE run_id='run-1' AND target_id=? AND attempt=?").get(t, a);
  assert.equal(get('1', 1).status, 'pending');  // was running → restored to pending
  assert.equal(get('1', 2).status, 'waiting');
  assert.equal(get('2', 1).status, 'error');
  assert.equal(get('2', 2).status, 'waiting');
  // paused_from cleared
  for (const r of db.prepare("SELECT paused_from FROM runs WHERE run_id='run-1'").all()) {
    assert.equal(r.paused_from, null);
  }
});

test('resumeRun: sets enqueued_at = now() on reactivated rows', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const before = db.prepare("SELECT enqueued_at FROM runs WHERE run_id='run-1' LIMIT 1").get().enqueued_at;
  // Backdate enqueued_at so we can detect the change
  db.prepare("UPDATE runs SET enqueued_at = '2020-01-01T00:00:00Z' WHERE run_id='run-1'").run();
  pauseRun(db, 'run-1');
  resumeRun(db, 'run-1');
  const after = db.prepare("SELECT enqueued_at FROM runs WHERE run_id='run-1' LIMIT 1").get().enqueued_at;
  assert.notEqual(after, '2020-01-01T00:00:00Z');
  assert.ok(before);
});

test('resumeRun: resumed row lands after a run enqueued in the distant past', () => {
  const db = openDb(':memory:');
  // Backdate run-2 to simulate an older queued run
  enqueueRun(db, { ...baseOpts, runId: 'run-2', targets: [{ id: '1', type: 'battle' }], attemptsPerTarget: 1 });
  db.prepare("UPDATE runs SET enqueued_at = '2020-01-01T00:00:00Z' WHERE run_id='run-2'").run();
  // run-1 is much older, paused, then resumed → should land behind run-2
  enqueueRun(db, { ...baseOpts, targets: [{ id: '1', type: 'battle' }], attemptsPerTarget: 1 });
  db.prepare("UPDATE runs SET enqueued_at = '2019-01-01T00:00:00Z' WHERE run_id='run-1'").run();
  pauseRun(db, 'run-1');
  resumeRun(db, 'run-1');
  const claimed = claimNextPending(db);
  assert.equal(claimed.run_id, 'run-2');
});

test('resumeRun: does nothing when no paused rows exist', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  assert.equal(resumeRun(db, 'run-1'), 0);
});

// ─── requeueStaleRunningAttempts ──────────────────────────────────────────────

test('requeueStaleRunningAttempts: running → pending, clears claim fields', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const claimed = claimNextPending(db);
  db.prepare('UPDATE runs SET prompt_text = ? WHERE id = ?').run('PROMPT BODY', claimed.id);
  const n = requeueStaleRunningAttempts(db);
  assert.equal(n, 1);
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(claimed.id);
  assert.equal(row.status, 'pending');
  assert.equal(row.prompt_text, null);
  assert.equal(row.claim_token, null);
  assert.equal(row.claimed_at, null);
});

test('requeueStaleRunningAttempts: requeued row is claimable again', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const first = claimNextPending(db);
  requeueStaleRunningAttempts(db);
  const second = claimNextPending(db);
  assert.ok(second);
  assert.equal(second.id, first.id);
  assert.notEqual(second.claim_token, first.claim_token);
});

test('requeueStaleRunningAttempts: handles multiple running rows', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  claimNextPending(db);
  claimNextPending(db);
  const n = requeueStaleRunningAttempts(db);
  assert.equal(n, 2);
  const running = db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status='running'").get().n;
  assert.equal(running, 0);
});

test('requeueStaleRunningAttempts: does not touch pending/waiting/done/error/paused rows', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const done = claimNextPending(db);
  completeAttempt(db, done.id, done.claim_token, sampleResult);
  const errRow = claimNextPending(db);
  failAttempt(db, errRow.id, errRow.claim_token, 'boom');
  enqueueRun(db, { ...baseOpts, runId: 'run-2' });
  const paused = claimNextPending(db);
  pauseRun(db, paused.run_id);
  // Remaining status snapshot
  const before = db.prepare('SELECT id, status FROM runs ORDER BY id').all();
  assert.equal(requeueStaleRunningAttempts(db), 0);
  const after = db.prepare('SELECT id, status FROM runs ORDER BY id').all();
  assert.deepEqual(before, after);
});

test('requeueStaleRunningAttempts: old claim_token cannot complete after requeue', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const stale = claimNextPending(db);
  requeueStaleRunningAttempts(db);
  const ok = completeAttempt(db, stale.id, stale.claim_token, sampleResult);
  assert.equal(ok, false);
});

test('requeueStaleRunningAttempts: returns 0 when no running rows', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  assert.equal(requeueStaleRunningAttempts(db), 0);
});

// ─── getRunQueue / getRunHistory ──────────────────────────────────────────────

function completeAllOfRun(db, runId) {
  while (true) {
    const c = claimNextPending(db);
    if (!c || c.run_id !== runId) {
      if (c) {
        // Put back — it's for a different run
        db.prepare("UPDATE runs SET status='pending', claim_token=NULL, claimed_at=NULL WHERE id=?").run(c.id);
      }
      break;
    }
    completeAttempt(db, c.id, c.claim_token, sampleResult);
  }
}

test('getRunQueue: returns only non-done runs', () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, runId: 'r-queued' });
  enqueueRun(db, { ...baseOpts, runId: 'r-done', attemptsPerTarget: 1, targets: [{ id: '1', type: 'battle' }] });
  const c = claimNextPending(db);
  while (c && c.run_id !== 'r-done') {
    // shouldn't happen — r-queued enqueued first, so it claims first
    break;
  }
  // Make r-done fully done
  if (c && c.run_id === 'r-done') {
    completeAttempt(db, c.id, c.claim_token, sampleResult);
  } else {
    // r-queued claimed first; unclaim and claim again for r-done
    db.prepare("UPDATE runs SET status='pending', claim_token=NULL, claimed_at=NULL WHERE id=?").run(c.id);
    const c2 = claimNextPending(db);
    // still might be r-queued — force via direct update instead
    db.prepare("UPDATE runs SET status='pending', claim_token=NULL, claimed_at=NULL WHERE id=?").run(c2.id);
    // Direct-complete r-done's single attempt
    db.prepare(`UPDATE runs SET status='done', finished_at=? WHERE run_id='r-done'`).run('2026-04-20T10:00:00Z');
  }
  const queue = getRunQueue(db);
  const ids = queue.map(r => r.run_id);
  assert.ok(ids.includes('r-queued'));
  assert.ok(!ids.includes('r-done'));
});

test('getRunQueue: returns plain objects (no null prototype)', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const queue = getRunQueue(db);
  assert.equal(queue.length, 1);
  assert.equal(Object.getPrototypeOf(queue[0]), Object.prototype);
});

test('getRunQueue: each entry has summary fields and attempts array', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  const queue = getRunQueue(db);
  const r = queue[0];
  assert.equal(r.run_id, 'run-1');
  assert.equal(r.model, 'gpt-4o');
  assert.equal(r.provider, 'openrouter');
  assert.equal(r.status, 'queued');
  assert.equal(r.total, 6);
  assert.ok(Array.isArray(r.attempts));
  assert.equal(r.attempts.length, 6);
  for (const a of r.attempts) {
    assert.equal(a.run_id, 'run-1');
    assert.ok(['pending', 'waiting'].includes(a.status));
  }
});

test('getRunQueue: empty when no open runs', () => {
  const db = openDb(':memory:');
  assert.deepEqual(getRunQueue(db), []);
});

test('getRunQueue: includes paused, error, running runs', () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, runId: 'r-running' });
  claimNextPending(db);
  enqueueRun(db, { ...baseOpts, runId: 'r-paused' });
  pauseRun(db, 'r-paused');
  enqueueRun(db, { ...baseOpts, runId: 'r-error', attemptsPerTarget: 1, targets: [{ id: '1', type: 'battle' }] });
  db.prepare("UPDATE runs SET status='error' WHERE run_id='r-error'").run();
  const queue = getRunQueue(db);
  const byId = Object.fromEntries(queue.map(r => [r.run_id, r.status]));
  assert.equal(byId['r-running'], 'running');
  assert.equal(byId['r-paused'], 'paused');
  assert.equal(byId['r-error'], 'error');
});

test('getRunHistory: returns only fully-done runs', () => {
  const db = openDb(':memory:');
  enqueueRun(db, { runId: 'r-done', benchmarkVersion: '1.0', model: 'gpt-4o', provider: 'openrouter',
                   attemptsPerTarget: 1, targets: [{ id: '1', type: 'battle' }] });
  enqueueRun(db, { ...baseOpts, runId: 'r-open' });
  const c = claimNextPending(db);
  completeAttempt(db, c.id, c.claim_token, { ...sampleResult, finishedAt: '2026-04-20T10:00:00Z' });
  const history = getRunHistory(db);
  const ids = history.map(r => r.run_id);
  assert.deepEqual(ids, ['r-done']);
});

test('getRunHistory: returns plain objects with summary fields', () => {
  const db = openDb(':memory:');
  enqueueRun(db, { runId: 'r-done', benchmarkVersion: '1.0', model: 'gpt-4o', provider: 'openrouter',
                   attemptsPerTarget: 1, targets: [{ id: '1', type: 'battle' }], startedAt: '2026-04-20T10:00:00Z' });
  const c = claimNextPending(db);
  completeAttempt(db, c.id, c.claim_token, { ...sampleResult, finishedAt: '2026-04-20T10:01:00Z' });
  const [r] = getRunHistory(db);
  assert.equal(Object.getPrototypeOf(r), Object.prototype);
  assert.equal(r.run_id, 'r-done');
  assert.equal(r.status, 'done');
  assert.equal(r.total, 1);
  assert.equal(r.done_count, 1);
  assert.equal(r.finished_at, '2026-04-20T10:01:00Z');
});

test('getRunHistory: empty when no completed runs', () => {
  const db = openDb(':memory:');
  enqueueRun(db, baseOpts);
  assert.deepEqual(getRunHistory(db), []);
});

test('getRunHistory: ordered by finished_at DESC', () => {
  const db = openDb(':memory:');
  const mkDone = (runId, finishedAt) => {
    enqueueRun(db, { runId, benchmarkVersion: '1.0', model: 'gpt-4o', provider: 'openrouter',
                     attemptsPerTarget: 1, targets: [{ id: '1', type: 'battle' }] });
    const c = claimNextPending(db);
    completeAttempt(db, c.id, c.claim_token, { ...sampleResult, finishedAt });
  };
  mkDone('r-old', '2026-04-20T09:00:00Z');
  mkDone('r-new', '2026-04-20T11:00:00Z');
  mkDone('r-mid', '2026-04-20T10:00:00Z');
  const ids = getRunHistory(db).map(r => r.run_id);
  assert.deepEqual(ids, ['r-new', 'r-mid', 'r-old']);
});

test('pause then resume then complete: promotion chain still works', () => {
  const db = openDb(':memory:');
  enqueueRun(db, { ...baseOpts, targets: [{ id: '1', type: 'battle' }] });
  claimNextPending(db);
  pauseRun(db, 'run-1');
  resumeRun(db, 'run-1');
  const c = claimNextPending(db);
  assert.ok(c);
  assert.equal(c.attempt, 1);
  completeAttempt(db, c.id, c.claim_token, sampleResult);
  const a2 = db.prepare("SELECT status FROM runs WHERE run_id='run-1' AND target_id='1' AND attempt=2").get();
  assert.equal(a2.status, 'pending');
});
