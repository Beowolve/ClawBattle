import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './connection.js';
import { saveAttempt, getResults } from './runs.js';

function makeDb() {
  return openDb(':memory:');
}

const baseAttempt = {
  runId: 'run-1',
  benchmarkVersion: '1.0',
  model: 'gpt-4o',
  provider: 'openrouter',
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
