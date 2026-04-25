import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  auditReasoningGroups,
  applySafeCorrections,
  getReasoningGroups,
} from '../../scripts/audit-reasoning-runs.js';

function openTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE runs (
      run_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      reasoning_effort TEXT
    )
  `);
  return db;
}

function insertRun(db, { runId, provider, model, reasoningEffort }) {
  db.prepare(`
    INSERT INTO runs (run_id, provider, model, reasoning_effort)
    VALUES (?, ?, ?, ?)
  `).run(runId, provider, model, reasoningEffort ?? null);
}

test('reasoning audit reports invalid and legacy groups without mutating rows', () => {
  const db = openTestDb();
  try {
    insertRun(db, {
      runId: 'r1',
      provider: 'openrouter',
      model: 'qwen/qwen3.6-plus',
      reasoningEffort: 'medium',
    });
    insertRun(db, {
      runId: 'r2',
      provider: 'openrouter',
      model: 'openai/gpt-5.4',
      reasoningEffort: 'high',
    });
    insertRun(db, {
      runId: 'r3',
      provider: 'openrouter',
      model: 'amazon/nova-lite-v1',
      reasoningEffort: null,
    });

    const audit = auditReasoningGroups(getReasoningGroups(db));
    assert.equal(audit.find(r => r.model === 'qwen/qwen3.6-plus').status, 'invalid');
    assert.equal(audit.find(r => r.model === 'qwen/qwen3.6-plus').correction, 'default');
    assert.equal(audit.find(r => r.model === 'openai/gpt-5.4').status, 'valid');
    assert.equal(audit.find(r => r.model === 'amazon/nova-lite-v1').status, 'legacy-default');

    const row = db.prepare('SELECT reasoning_effort FROM runs WHERE run_id = ?').get('r1');
    assert.equal(row.reasoning_effort, 'medium');
  } finally {
    db.close();
  }
});

test('reasoning audit apply corrects only safe groups', () => {
  const db = openTestDb();
  try {
    insertRun(db, {
      runId: 'safe-openrouter',
      provider: 'openrouter',
      model: 'z-ai/glm-5v-turbo',
      reasoningEffort: 'medium',
    });
    insertRun(db, {
      runId: 'safe-ollama',
      provider: 'ollama',
      model: 'gemma4:31b-cloud',
      reasoningEffort: 'medium',
    });
    insertRun(db, {
      runId: 'unsafe-openrouter',
      provider: 'openrouter',
      model: 'google/gemma-4-31b-it',
      reasoningEffort: 'high',
    });
    insertRun(db, {
      runId: 'legacy-null',
      provider: 'openrouter',
      model: 'qwen/qwen3.6-plus',
      reasoningEffort: null,
    });

    const audit = auditReasoningGroups(getReasoningGroups(db));
    const result = applySafeCorrections(db, audit);
    assert.deepEqual(result, { updatedRows: 2, updatedGroups: 2 });

    const rows = db.prepare('SELECT run_id, reasoning_effort FROM runs ORDER BY run_id')
      .all()
      .map(row => ({ ...row }));
    assert.deepEqual(rows, [
      { run_id: 'legacy-null', reasoning_effort: null },
      { run_id: 'safe-ollama', reasoning_effort: 'default' },
      { run_id: 'safe-openrouter', reasoning_effort: 'default' },
      { run_id: 'unsafe-openrouter', reasoning_effort: 'high' },
    ]);
  } finally {
    db.close();
  }
});
