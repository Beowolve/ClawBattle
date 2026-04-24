import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './connection.js';
import { saveAttempt, getResults, getInsights, getLeaderboard, deleteRunGroup } from './runs.js';

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

test('saveAttempt stores and returns canonical model names', () => {
  const db = makeDb();
  saveAttempt(db, {
    ...baseAttempt,
    model: 'gpt-5.4-mini-2026-03-17',
    provider: 'openai',
  });

  const [row] = getResults(db);
  assert.equal(row.model, 'openai/gpt-5.4-mini');
  assert.equal(row.raw_model, 'gpt-5.4-mini-2026-03-17');
  assert.equal(row.canonical_model, 'openai/gpt-5.4-mini');
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

test('deleteRunGroup deletes by canonical model name', () => {
  const db = makeDb();
  saveAttempt(db, {
    ...baseAttempt,
    runId: 'run-openai',
    model: 'gpt-5.4-mini-2026-03-17',
    provider: 'openai',
    reasoningEffort: 'low',
  });
  saveAttempt(db, {
    ...baseAttempt,
    runId: 'run-openrouter',
    model: 'openai/gpt-5.4-mini',
    provider: 'openrouter',
    reasoningEffort: 'low',
  });

  const result = deleteRunGroup(db, {
    model: 'openai/gpt-5.4-mini',
    reasoningEffort: 'low',
  });

  assert.deepEqual(result, { deletedRuns: 2, deletedAttempts: 2 });
  assert.equal(getResults(db).length, 0);
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

test('leaderboard view separates groups by reasoning effort', () => {
  const db = makeDb();
  saveAttempt(db, {
    ...baseAttempt,
    runId: 'run-low',
    model: 'openai/gpt-5.4',
    targetId: '1',
    reasoningEffort: 'low',
  });
  saveAttempt(db, {
    ...baseAttempt,
    runId: 'run-high',
    model: 'openai/gpt-5.4',
    targetId: '2',
    reasoningEffort: 'high',
  });

  const board = db.prepare(`
    SELECT model, reasoning_effort, targets
    FROM leaderboard
    WHERE model = 'openai/gpt-5.4'
    ORDER BY reasoning_effort
  `).all();

  assert.equal(board.length, 2);
  assert.deepEqual(
    board.map(row => ({ reasoning_effort: row.reasoning_effort, targets: row.targets })),
    [
      { reasoning_effort: 'high', targets: 1 },
      { reasoning_effort: 'low', targets: 1 },
    ],
  );
});

test('leaderboard view separates groups by prompt version', () => {
  const db = makeDb();
  saveAttempt(db, {
    ...baseAttempt,
    runId: 'run-v1',
    model: 'openai/gpt-5.4',
    targetId: '1',
    promptVersion: 'v1',
    reasoningEffort: 'high',
    score: 700,
  });
  saveAttempt(db, {
    ...baseAttempt,
    runId: 'run-v2',
    model: 'openai/gpt-5.4',
    targetId: '1',
    promptVersion: 'v2',
    reasoningEffort: 'high',
    score: 900,
  });

  const board = db.prepare(`
    SELECT model, reasoning_effort, prompt_version, targets, avg_score
    FROM leaderboard
    WHERE model = 'openai/gpt-5.4'
    ORDER BY prompt_version
  `).all();

  assert.deepEqual(
    board.map(row => ({
      reasoning_effort: row.reasoning_effort,
      prompt_version: row.prompt_version,
      targets: row.targets,
      avg_score: row.avg_score,
    })),
    [
      { reasoning_effort: 'high', prompt_version: 'v1', targets: 1, avg_score: 700 },
      { reasoning_effort: 'high', prompt_version: 'v2', targets: 1, avg_score: 900 },
    ],
  );
});

test('leaderboard view aggregates aliases by canonical model name', () => {
  const db = makeDb();
  saveAttempt(db, {
    ...baseAttempt,
    runId: 'run-openai',
    model: 'gpt-5.4-mini-2026-03-17',
    provider: 'openai',
    targetId: '1',
    reasoningEffort: 'low',
    promptVersion: 'v1',
    score: 700,
  });
  saveAttempt(db, {
    ...baseAttempt,
    runId: 'run-openrouter',
    model: 'openai/gpt-5.4-mini',
    provider: 'openrouter',
    targetId: '2',
    reasoningEffort: 'low',
    promptVersion: 'v1',
    score: 900,
  });

  const board = db.prepare(`
    SELECT model, reasoning_effort, prompt_version, targets, attempt_count
    FROM leaderboard
    WHERE model = 'openai/gpt-5.4-mini'
  `).all();

  assert.deepEqual(
    board.map(row => ({
      model: row.model,
      reasoning_effort: row.reasoning_effort,
      prompt_version: row.prompt_version,
      targets: row.targets,
      attempt_count: row.attempt_count,
    })),
    [
      {
        model: 'openai/gpt-5.4-mini',
        reasoning_effort: 'low',
        prompt_version: 'v1',
        targets: 2,
        attempt_count: 2,
      },
    ],
  );
});

test('getLeaderboard totals are scoped to the selected prompt version', () => {
  const db = makeDb();
  saveAttempt(db, {
    ...baseAttempt,
    runId: 'run-v1',
    model: 'openai/gpt-5.4',
    targetId: '1',
    promptVersion: 'v1',
    cost: 0.01,
  });
  saveAttempt(db, {
    ...baseAttempt,
    runId: 'run-v2',
    model: 'openai/gpt-5.4',
    targetId: '1',
    promptVersion: 'v2',
    cost: 0.25,
  });

  const board = getLeaderboard(db, 'v1');

  assert.equal(board.totalAttempts, 1);
  assert.equal(board.totalCost, 0.01);
  assert.deepEqual(board.promptVersions, ['v1', 'v2']);
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

test('insights separate model consistency and cost efficiency by reasoning effort', () => {
  const db = makeDb();
  saveAttempt(db, {
    ...baseAttempt,
    runId: 'run-low',
    targetId: '1',
    reasoningEffort: 'low',
    match: 80,
    score: 700,
    cost: 0.001,
  });
  saveAttempt(db, {
    ...baseAttempt,
    runId: 'run-high',
    targetId: '1',
    reasoningEffort: 'high',
    match: 95,
    score: 900,
    cost: 0.003,
  });

  const insights = getInsights(db, 'v1');

  assert.deepEqual(
    insights.consistency.map(row => ({
      model: row.model,
      reasoningEffort: row.reasoningEffort,
      label: row.label,
      avgMatch: row.avgMatch,
    })).sort((a, b) => String(a.reasoningEffort).localeCompare(String(b.reasoningEffort))),
    [
      { model: 'gpt-4o', reasoningEffort: 'high', label: 'gpt-4o [high]', avgMatch: 95 },
      { model: 'gpt-4o', reasoningEffort: 'low', label: 'gpt-4o [low]', avgMatch: 80 },
    ],
  );

  assert.deepEqual(
    insights.costEfficiency.map(row => ({
      model: row.model,
      reasoningEffort: row.reasoningEffort,
      label: row.label,
      avgScore: row.avgScore,
      avgCost: row.avgCost,
    })).sort((a, b) => String(a.reasoningEffort).localeCompare(String(b.reasoningEffort))),
    [
      { model: 'gpt-4o', reasoningEffort: 'high', label: 'gpt-4o [high]', avgScore: 900, avgCost: 0.003 },
      { model: 'gpt-4o', reasoningEffort: 'low', label: 'gpt-4o [low]', avgScore: 700, avgCost: 0.001 },
    ],
  );
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
