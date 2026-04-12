import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './connection.js';
import { saveAttempt, getResults, getRunMeta, saveRunStart, saveRunEnd } from './runs.js';

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

test('getRunMeta returns rows from run_state', () => {
  const db = makeDb();
  saveRunStart(db, { runId: 'run-1', model: 'gpt-4o', provider: 'openrouter', promptVersion: 'v1', reasoningEffort: null, startedAt: '2024-01-01T00:00:00Z' });
  saveRunStart(db, { runId: 'run-2', model: 'gpt-4o', provider: 'openrouter', promptVersion: 'v1', reasoningEffort: null, startedAt: '2024-01-01T01:00:00Z' });
  const meta = getRunMeta(db);
  assert.equal(meta.length, 2);
  assert.equal(meta.find(r => r.run_id === 'run-1').model, 'gpt-4o');
});

test('saveRunEnd sets finished_at and status on run_state and runs', () => {
  const db = makeDb();
  saveRunStart(db, { runId: 'run-1', model: 'gpt-4o', provider: 'openrouter', promptVersion: 'v1', reasoningEffort: null, startedAt: '2024-01-01T00:00:00Z' });
  saveAttempt(db, { ...baseAttempt, attempt: 1 });
  saveRunEnd(db, { runId: 'run-1', finishedAt: '2024-01-01T01:00:00Z', status: 'done' });
  const [meta] = getRunMeta(db);
  assert.equal(meta.finished_at, '2024-01-01T01:00:00Z');
  assert.equal(meta.status, 'done');
  const [row] = getResults(db);
  assert.equal(row.finished_at, '2024-01-01T01:00:00Z');
});

test('saveRunEnd is a no-op when finishedAt is null', () => {
  const db = makeDb();
  saveRunStart(db, { runId: 'run-1', model: 'gpt-4o', provider: 'openrouter', promptVersion: 'v1', reasoningEffort: null, startedAt: '2024-01-01T00:00:00Z' });
  saveRunEnd(db, { runId: 'run-1', finishedAt: null });
  const [row] = getRunMeta(db);
  assert.equal(row.finished_at, null);
  assert.equal(row.status, 'running');
});
