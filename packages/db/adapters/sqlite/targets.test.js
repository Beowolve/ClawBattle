import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './connection.js';
import {
  upsertBattleTarget, getBattleTargets,
  upsertDailyTarget, getDailyTargets,
} from './targets.js';

function makeDb() {
  return openDb(':memory:');
}

const battleTarget = {
  id: 1,
  name: 'Battle 001',
  image_url: 'https://example.com/battle-001.png',
  colors: ['#5d3a3a', '#b5e0ba'],
  battle_number: 1,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const dailyTarget = {
  key: '2024-01-15',
  name: 'Daily Jan 15',
  image_url: 'https://example.com/daily-2024-01-15.png',
  colors: ['#ff0000', '#0000ff'],
  date: '2024-01-15',
  created_at: '2024-01-15T00:00:00Z',
  updated_at: '2024-01-15T00:00:00Z',
};

test('upsertBattleTarget inserts a new row', () => {
  const db = makeDb();
  upsertBattleTarget(db, battleTarget);
  const rows = getBattleTargets(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].name, 'Battle 001');
});

test('getBattleTargets deserialises colors to array', () => {
  const db = makeDb();
  upsertBattleTarget(db, battleTarget);
  const [row] = getBattleTargets(db);
  assert.deepEqual(row.colors, ['#5d3a3a', '#b5e0ba']);
});

test('upsertBattleTarget updates existing row on conflict', () => {
  const db = makeDb();
  upsertBattleTarget(db, battleTarget);
  upsertBattleTarget(db, { ...battleTarget, name: 'Updated', updated_at: '2024-02-01T00:00:00Z' });
  const rows = getBattleTargets(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Updated');
});

test('getBattleTargets orders by battle_number ascending', () => {
  const db = makeDb();
  upsertBattleTarget(db, { ...battleTarget, id: 3, battle_number: 3 });
  upsertBattleTarget(db, { ...battleTarget, id: 1, battle_number: 1 });
  upsertBattleTarget(db, { ...battleTarget, id: 2, battle_number: 2 });
  const rows = getBattleTargets(db);
  assert.deepEqual(rows.map(r => r.battle_number), [1, 2, 3]);
});

test('upsertDailyTarget inserts a new row', () => {
  const db = makeDb();
  upsertDailyTarget(db, dailyTarget);
  const rows = getDailyTargets(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, '2024-01-15');
});

test('getDailyTargets deserialises colors to array', () => {
  const db = makeDb();
  upsertDailyTarget(db, dailyTarget);
  const [row] = getDailyTargets(db);
  assert.deepEqual(row.colors, ['#ff0000', '#0000ff']);
});

test('upsertDailyTarget updates existing row on conflict', () => {
  const db = makeDb();
  upsertDailyTarget(db, dailyTarget);
  upsertDailyTarget(db, { ...dailyTarget, name: 'Updated Daily' });
  const rows = getDailyTargets(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Updated Daily');
});

test('getDailyTargets orders by date descending', () => {
  const db = makeDb();
  upsertDailyTarget(db, { ...dailyTarget, key: 'a', date: '2024-01-10' });
  upsertDailyTarget(db, { ...dailyTarget, key: 'c', date: '2024-01-30' });
  upsertDailyTarget(db, { ...dailyTarget, key: 'b', date: '2024-01-20' });
  const rows = getDailyTargets(db);
  assert.deepEqual(rows.map(r => r.date), ['2024-01-30', '2024-01-20', '2024-01-10']);
});

test('upsertBattleTarget handles missing colors gracefully', () => {
  const db = makeDb();
  upsertBattleTarget(db, { ...battleTarget, colors: undefined });
  const [row] = getBattleTargets(db);
  assert.deepEqual(row.colors, []);
});
