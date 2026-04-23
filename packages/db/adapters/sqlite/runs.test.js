import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './connection.js';
import { saveAttempt, getResults, deleteRunGroup } from './runs.js';

function makeDb() {
  return openDb(':memory:');
}

const baseAttempt = {
  runId: 'run-1',
  benchmarkVersion: '1.0',
  model: 'gpt-4o',
  provider: 'openrouter',
  promptVersion: 'v1',
  temperature: null,
  attemptsPerTarget: 3,
  startedAt: '2024-01-01T00:00:00Z',
  targetId: 'battle-001',
  targetType: 'battle',
  attempt: 1,
  match: 87.5,
  score: 634.21,
  tokensUsed: 512,
  code: '<div></div><style>div{width:400px;height:300px;background:#5d3a3a}</style>',
  codeLength: 70,
};

// saveAttempt is kept as a test-only helper: it's the shortest path to seed
// a completed row for view/aggregate/delete tests. Real benchmark flow writes
// rows via enqueueRun + completeAttempt instead.

test('saveAttempt persists a run row', () => {
  const db = makeDb();
  saveAttempt(db, baseAttempt);
  const rows = getResults(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].run_id, 'run-1');
  assert.equal(rows[0].match, 87.5);
  assert.equal(rows[0].score, 634.21);
});

test('saveAttempt stores meta fields', () => {
  const db = makeDb();
  saveAttempt(db, baseAttempt);
  const [row] = getResults(db);
  assert.equal(row.prompt_version, 'v1');
  assert.equal(row.attempts_per_target, 3);
  assert.equal(row.started_at, '2024-01-01T00:00:00Z');
  assert.equal(row.finished_at, null);
});

test('saveAttempt stores code and code_length', () => {
  const db = makeDb();
  saveAttempt(db, baseAttempt);
  const [row] = getResults(db);
  assert.equal(row.code, baseAttempt.code);
  assert.equal(row.code_length, 70);
});

test('getResults returns rows newest-first', () => {
  const db = makeDb();
  saveAttempt(db, { ...baseAttempt, runId: 'run-1' });
  saveAttempt(db, { ...baseAttempt, runId: 'run-2' });
  const rows = getResults(db);
  assert.equal(rows.length, 2);
  const ids = rows.map(r => r.run_id);
  assert.ok(ids.includes('run-1'));
  assert.ok(ids.includes('run-2'));
});

test('saveAttempt stores optional fields as null when omitted', () => {
  const db = makeDb();
  saveAttempt(db, { ...baseAttempt, tokensUsed: undefined, code: undefined, codeLength: undefined, score: undefined });
  const [row] = getResults(db);
  assert.equal(row.tokens_used, null);
  assert.equal(row.code, null);
  assert.equal(row.code_length, null);
  assert.equal(row.score, null);
});

// ─── deleteRunGroup ──────────────────────────────────────────────────────────
// Queries the runs table directly (run_state is gone in slice 4.3).
// Queue rows (non-done) are swept along with done rows — deleting a group
// is destructive by design.

test('deleteRunGroup deletes only the selected leaderboard group and prompt versions', () => {
  const db = makeDb();

  saveAttempt(db, { ...baseAttempt, runId: 'run-low-v1', promptVersion: 'v1', reasoningEffort: 'low' });
  saveAttempt(db, { ...baseAttempt, runId: 'run-low-v2', promptVersion: 'v2', reasoningEffort: 'low' });
  saveAttempt(db, { ...baseAttempt, runId: 'run-high-v1', promptVersion: 'v1', reasoningEffort: 'high' });
  saveAttempt(db, { ...baseAttempt, runId: 'run-other', model: 'gpt-4.1', promptVersion: 'v1', reasoningEffort: 'low' });

  const result = deleteRunGroup(db, {
    model: 'gpt-4o',
    reasoningEffort: 'low',
    promptVersions: ['v2'],
  });

  assert.deepEqual(result, { deletedRuns: 1, deletedAttempts: 1 });

  const remainingRunIds = [...new Set(getResults(db).map(r => r.run_id))].sort();
  assert.deepEqual(remainingRunIds, ['run-high-v1', 'run-low-v1', 'run-other']);
});

test('deleteRunGroup deletes all prompt versions for the selected model and null reasoning group', () => {
  const db = makeDb();

  saveAttempt(db, { ...baseAttempt, runId: 'run-null-v1', promptVersion: 'v1', reasoningEffort: null });
  saveAttempt(db, { ...baseAttempt, runId: 'run-null-v2', promptVersion: 'v2', reasoningEffort: null });
  saveAttempt(db, { ...baseAttempt, runId: 'run-low-v1', promptVersion: 'v1', reasoningEffort: 'low' });

  const result = deleteRunGroup(db, {
    model: 'gpt-4o',
    reasoningEffort: null,
  });

  assert.deepEqual(result, { deletedRuns: 2, deletedAttempts: 2 });

  const remainingRunIds = [...new Set(getResults(db).map(r => r.run_id))].sort();
  assert.deepEqual(remainingRunIds, ['run-low-v1']);
});

test('deleteRunGroup removes queue rows alongside done attempts', () => {
  const db = makeDb();
  saveAttempt(db, { ...baseAttempt, runId: 'run-mix', promptVersion: 'v1', reasoningEffort: null });
  // Attempt 2 still pending for the same run.
  db.prepare(`
    INSERT INTO runs (run_id, benchmark_version, model, provider, prompt_version, reasoning_effort,
                      target_id, target_type, attempt, status, enqueued_at)
    VALUES ('run-mix', '1.0', 'gpt-4o', 'openrouter', 'v1', NULL, 'battle-001', 'battle', 2, 'pending', datetime('now'))
  `).run();

  const result = deleteRunGroup(db, { model: 'gpt-4o', reasoningEffort: null });
  assert.deepEqual(result, { deletedRuns: 1, deletedAttempts: 2 });

  const remaining = db.prepare('SELECT COUNT(*) AS n FROM runs').get().n;
  assert.equal(remaining, 0);
});

test('deleteRunGroup filters by reasoningMaxTokens within same model/reasoning group', () => {
  const db = makeDb();
  saveAttempt(db, { ...baseAttempt, runId: 'run-no-cap', reasoningEffort: null, reasoningMaxTokens: null });
  saveAttempt(db, { ...baseAttempt, runId: 'run-cap-8k', reasoningEffort: null, reasoningMaxTokens: 8000 });

  const result = deleteRunGroup(db, {
    model: 'gpt-4o',
    reasoningEffort: null,
    reasoningMaxTokens: 8000,
  });
  assert.deepEqual(result, { deletedRuns: 1, deletedAttempts: 1 });

  const remainingRunIds = [...new Set(getResults(db).map(r => r.run_id))].sort();
  assert.deepEqual(remainingRunIds, ['run-no-cap']);
});

// ─── Views read from attempt_results (done-only) ─────────────────────────────

test('leaderboard view excludes non-done attempts', () => {
  const db = makeDb();
  // One finished attempt and one still-pending attempt for the same model.
  saveAttempt(db, { ...baseAttempt, runId: 'r-done', targetId: '1', match: 100, score: 1000 });
  // Insert a pending row directly so it does not accidentally show up in the view.
  db.prepare(`
    INSERT INTO runs (run_id, benchmark_version, model, provider, target_id, target_type, attempt, status, enqueued_at)
    VALUES ('r-open', '1.0', 'gpt-4o', 'openrouter', '2', 'battle', 1, 'pending', datetime('now'))
  `).run();
  const board = db.prepare('SELECT * FROM leaderboard').all();
  assert.equal(board.length, 1);
  assert.equal(board[0].targets, 1, 'should only count the one done target');
  assert.equal(board[0].perfect_count, 1);
});

test('leaderboard view separates groups by reasoning_max_tokens', () => {
  const db = makeDb();
  saveAttempt(db, {
    ...baseAttempt,
    runId: 'run-no-cap',
    model: 'openai/gpt-5.4',
    targetId: '1',
    reasoningEffort: null,
    reasoningMaxTokens: null,
  });
  saveAttempt(db, {
    ...baseAttempt,
    runId: 'run-cap-8k',
    model: 'openai/gpt-5.4',
    targetId: '2',
    reasoningEffort: null,
    reasoningMaxTokens: 8000,
  });

  const board = db.prepare(`
    SELECT model, reasoning_effort, reasoning_max_tokens, targets
    FROM leaderboard
    WHERE model = 'openai/gpt-5.4'
    ORDER BY reasoning_max_tokens
  `).all();

  assert.equal(board.length, 2);
  assert.deepEqual(
    board.map(row => ({ reasoning_max_tokens: row.reasoning_max_tokens, targets: row.targets })),
    [
      { reasoning_max_tokens: null, targets: 1 },
      { reasoning_max_tokens: 8000, targets: 1 },
    ],
  );
});

test('match_distribution view excludes non-done attempts', () => {
  const db = makeDb();
  saveAttempt(db, { ...baseAttempt, runId: 'r-done', targetId: '1', match: 95 });
  db.prepare(`
    INSERT INTO runs (run_id, benchmark_version, model, provider, target_id, target_type, attempt, match, status, enqueued_at)
    VALUES ('r-open', '1.0', 'gpt-4o', 'openrouter', '2', 'battle', 1, 42, 'error', datetime('now'))
  `).run();
  const rows = db.prepare('SELECT * FROM match_distribution').all();
  // Only the done row's bucket should appear; the error row must not leak in.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bucket, '90\u201399');
  assert.equal(rows[0].count, 1);
});

test('attempt_results view returns exactly status=done rows', () => {
  const db = makeDb();
  saveAttempt(db, { ...baseAttempt, runId: 'r-done', targetId: '1' });
  db.prepare(`
    INSERT INTO runs (run_id, benchmark_version, model, provider, target_id, target_type, attempt, status, enqueued_at)
    VALUES ('r-open', '1.0', 'gpt-4o', 'openrouter', '2', 'battle', 1, 'pending', datetime('now'))
  `).run();
  const rows = db.prepare('SELECT run_id, status FROM attempt_results').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].run_id, 'r-done');
  assert.equal(rows[0].status, 'done');
});
