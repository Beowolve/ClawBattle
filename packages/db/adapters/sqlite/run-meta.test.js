import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './connection.js';
import { saveRunMeta, getRunMeta } from './run-meta.js';

function makeDb() {
  return openDb(':memory:');
}

const baseMeta = {
  runId: 'run-1',
  model: 'gpt-4o',
  provider: 'openrouter',
  promptVersion: 'v1',
  temperature: 0.7,
  attemptsPerTarget: 3,
  startedAt: '2024-01-01T00:00:00Z',
  finishedAt: '2024-01-01T00:01:00Z',
  summary: { totalTargets: 2, avgScore: 88.5 },
};

test('saveRunMeta persists a run_meta row', () => {
  const db = makeDb();
  saveRunMeta(db, baseMeta);
  const rows = getRunMeta(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].run_id, 'run-1');
  assert.equal(rows[0].model, 'gpt-4o');
});

test('saveRunMeta serialises summary as JSON', () => {
  const db = makeDb();
  saveRunMeta(db, baseMeta);
  const [row] = getRunMeta(db);
  const parsed = JSON.parse(row.summary);
  assert.deepEqual(parsed, baseMeta.summary);
});

test('saveRunMeta replaces existing row for same run_id', () => {
  const db = makeDb();
  saveRunMeta(db, baseMeta);
  saveRunMeta(db, { ...baseMeta, model: 'claude-3' });
  const rows = getRunMeta(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].model, 'claude-3');
});
