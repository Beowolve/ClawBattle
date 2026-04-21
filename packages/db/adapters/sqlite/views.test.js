import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './connection.js';

function insertRun(db, { runId, targetId = '1', attempt = 1, status = 'done', match = null, score = null, startedAt = null, finishedAt = null, model = 'gpt-4o', provider = 'openrouter', promptVersion = 'v1', reasoningEffort = null, attemptsPerTarget = 3, benchmarkVersion = '1.0', enqueuedAt = null }) {
  db.prepare(`
    INSERT INTO runs
      (run_id, benchmark_version, model, provider, prompt_version, reasoning_effort,
       attempts_per_target, started_at, finished_at, enqueued_at,
       target_id, target_type, attempt, match, score, status)
    VALUES (?,?,?,?,?,?,?,?,?,COALESCE(?, datetime('now')),?,?,?,?,?,?)
  `).run(
    runId, benchmarkVersion, model, provider, promptVersion, reasoningEffort,
    attemptsPerTarget, startedAt, finishedAt, enqueuedAt,
    String(targetId), 'battle', attempt, match, score, status,
  );
}

function summaryFor(db, runId) {
  return db.prepare('SELECT * FROM runs_summary WHERE run_id = ?').get(runId);
}

test('attempt_results returns only rows with status=done', () => {
  const db = openDb(':memory:');
  insertRun(db, { runId: 'r1', attempt: 1, status: 'done', match: 87.5 });
  insertRun(db, { runId: 'r1', attempt: 2, status: 'pending' });
  insertRun(db, { runId: 'r1', attempt: 3, status: 'error' });
  insertRun(db, { runId: 'r2', attempt: 1, status: 'waiting' });
  insertRun(db, { runId: 'r2', attempt: 2, status: 'running' });

  const rows = db.prepare('SELECT run_id, attempt FROM attempt_results ORDER BY run_id, attempt').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].run_id, 'r1');
  assert.equal(rows[0].attempt, 1);
});

test('runs_summary: all done → status=done', () => {
  const db = openDb(':memory:');
  insertRun(db, { runId: 'r1', attempt: 1, status: 'done', finishedAt: '2026-01-01T00:10:00Z' });
  insertRun(db, { runId: 'r1', attempt: 2, status: 'done', finishedAt: '2026-01-01T00:20:00Z' });
  const s = summaryFor(db, 'r1');
  assert.equal(s.status, 'done');
  assert.equal(s.done_count, 2);
  assert.equal(s.total, 2);
  assert.equal(s.finished_at, '2026-01-01T00:20:00Z');
});

test('runs_summary: finished_at is null while any attempt is still open', () => {
  const db = openDb(':memory:');
  insertRun(db, { runId: 'r1', attempt: 1, status: 'done', finishedAt: '2026-01-01T00:10:00Z' });
  insertRun(db, { runId: 'r1', attempt: 2, status: 'pending' });
  const s = summaryFor(db, 'r1');
  assert.equal(s.finished_at, null);
});

test('runs_summary: pending/waiting only → status=queued', () => {
  const db = openDb(':memory:');
  insertRun(db, { runId: 'r1', attempt: 1, status: 'pending' });
  insertRun(db, { runId: 'r1', attempt: 2, status: 'waiting' });
  const s = summaryFor(db, 'r1');
  assert.equal(s.status, 'queued');
  assert.equal(s.pending_count, 1);
  assert.equal(s.waiting_count, 1);
});

test('runs_summary: any running → status=running (wins over error)', () => {
  const db = openDb(':memory:');
  insertRun(db, { runId: 'r1', attempt: 1, status: 'error' });
  insertRun(db, { runId: 'r1', attempt: 2, status: 'running' });
  insertRun(db, { runId: 'r1', attempt: 3, status: 'waiting' });
  const s = summaryFor(db, 'r1');
  assert.equal(s.status, 'running');
});

test('runs_summary: any paused → status=paused (wins over running)', () => {
  const db = openDb(':memory:');
  insertRun(db, { runId: 'r1', attempt: 1, status: 'running' });
  insertRun(db, { runId: 'r1', attempt: 2, status: 'paused' });
  const s = summaryFor(db, 'r1');
  assert.equal(s.status, 'paused');
  assert.equal(s.paused_count, 1);
});

test('runs_summary: error with no running → status=error (wins over queued)', () => {
  const db = openDb(':memory:');
  insertRun(db, { runId: 'r1', attempt: 1, status: 'error' });
  insertRun(db, { runId: 'r1', attempt: 2, status: 'waiting' });
  insertRun(db, { runId: 'r1', attempt: 3, status: 'pending' });
  const s = summaryFor(db, 'r1');
  assert.equal(s.status, 'error');
  assert.equal(s.error_count, 1);
});

test('runs_summary: started_at is MIN across attempts', () => {
  const db = openDb(':memory:');
  insertRun(db, { runId: 'r1', attempt: 1, status: 'done', startedAt: '2026-01-01T00:00:00Z' });
  insertRun(db, { runId: 'r1', attempt: 2, status: 'done', startedAt: '2026-01-01T00:05:00Z' });
  const s = summaryFor(db, 'r1');
  assert.equal(s.started_at, '2026-01-01T00:00:00Z');
});

test('runs_summary: run metadata is aggregated from rows', () => {
  const db = openDb(':memory:');
  insertRun(db, { runId: 'r1', attempt: 1, status: 'done', model: 'gpt-4o', provider: 'openrouter', promptVersion: 'v2', reasoningEffort: 'high', attemptsPerTarget: 3 });
  insertRun(db, { runId: 'r1', attempt: 2, status: 'done', model: 'gpt-4o', provider: 'openrouter', promptVersion: 'v2', reasoningEffort: 'high', attemptsPerTarget: 3 });
  const s = summaryFor(db, 'r1');
  assert.equal(s.model, 'gpt-4o');
  assert.equal(s.provider, 'openrouter');
  assert.equal(s.prompt_version, 'v2');
  assert.equal(s.reasoning_effort, 'high');
  assert.equal(s.attempts_per_target, 3);
});

test('runs_summary: counts cover all status buckets', () => {
  const db = openDb(':memory:');
  insertRun(db, { runId: 'r1', attempt: 1, status: 'done' });
  insertRun(db, { runId: 'r1', attempt: 2, status: 'running' });
  insertRun(db, { runId: 'r1', attempt: 3, status: 'waiting' });
  insertRun(db, { runId: 'r1', targetId: '2', attempt: 1, status: 'error' });
  insertRun(db, { runId: 'r1', targetId: '2', attempt: 2, status: 'pending' });
  insertRun(db, { runId: 'r1', targetId: '3', attempt: 1, status: 'paused' });
  const s = summaryFor(db, 'r1');
  assert.equal(s.total, 6);
  assert.equal(s.done_count, 1);
  assert.equal(s.running_count, 1);
  assert.equal(s.waiting_count, 1);
  assert.equal(s.error_count, 1);
  assert.equal(s.pending_count, 1);
  assert.equal(s.paused_count, 1);
});

test('runs_summary: returns one row per run_id', () => {
  const db = openDb(':memory:');
  insertRun(db, { runId: 'r1', attempt: 1, status: 'done' });
  insertRun(db, { runId: 'r2', attempt: 1, status: 'pending' });
  insertRun(db, { runId: 'r3', attempt: 1, status: 'running' });
  const rows = db.prepare('SELECT run_id, status FROM runs_summary ORDER BY run_id').all()
    .map(r => ({ run_id: r.run_id, status: r.status }));
  assert.deepEqual(rows, [
    { run_id: 'r1', status: 'done' },
    { run_id: 'r2', status: 'queued' },
    { run_id: 'r3', status: 'running' },
  ]);
});
