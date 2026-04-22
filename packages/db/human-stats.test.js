import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHumanStats } from './human-stats.js';

test('buildHumanStats: computes compact stats per target with deterministic sorting', () => {
  const rows = [
    { target_id: '1', score: 800, char_count: 80 },
    { target_id: '1', score: 840, char_count: 50 },
    { target_id: '1', score: 820, char_count: 70 },
    { target_id: '1', score: 835, char_count: 60 },
    { target_id: '1', score: 780, char_count: 90 },
  ];

  const out = buildHumanStats(rows, {
    updatedAt: '2026-04-23T00:00:00.000Z',
    topN: 10,
    maxPerTarget: 100,
  });

  assert.equal(out.schemaVersion, '2.1.0');
  assert.equal(out.updatedAt, '2026-04-23T00:00:00.000Z');
  assert.deepEqual(out.targets['1'], {
    n: 5,
    top1: { score: 840, charCount: 50 },
    top10Avg: { score: 815, charCount: 70 },
    p50: { score: 820, charCount: 70 },
    p90: { score: 840, charCount: 50 },
  });
});

test('buildHumanStats: keeps only top rows per target when maxPerTarget is smaller than source sample', () => {
  const rows = [];
  for (let i = 0; i < 120; i++) {
    rows.push({ target_id: '2', score: 900 - i, char_count: 50 + i });
  }

  const out = buildHumanStats(rows, { maxPerTarget: 100, topN: 10 });
  assert.equal(out.targets['2'].n, 100);
  assert.deepEqual(out.targets['2'].top1, { score: 900, charCount: 50 });
  assert.equal(out.targets['2'].top10Avg.score, 895.5);
  assert.equal(out.targets['2'].top10Avg.charCount, 54.5);
});

test('buildHumanStats: skips rows missing required numeric fields', () => {
  const rows = [
    { target_id: '3', score: 700, char_count: 120 },
    { target_id: '3', score: 'bad', char_count: 110 },
    { target_id: '3', score: 710, char_count: null },
    { target_id: '', score: 730, char_count: 90 },
  ];

  const out = buildHumanStats(rows);
  assert.equal(out.targets['3'].n, 1);
  assert.deepEqual(out.targets['3'].top1, { score: 700, charCount: 120 });
});
