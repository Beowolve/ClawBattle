export function saveAttempt(db, data) {
  db.prepare(`
    INSERT INTO runs
      (run_id, benchmark_version, model, provider,
       prompt_version, temperature, attempts_per_target, started_at,
       target_id, target_type, attempt, match, score, tokens_used, code, code_length, cost, duration_ms, reasoning_effort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.runId, data.benchmarkVersion, data.model, data.provider,
    data.promptVersion ?? null, data.temperature ?? null,
    data.attemptsPerTarget ?? null, data.startedAt ?? null,
    data.targetId, data.targetType, data.attempt,
    data.match ?? null, data.score ?? null,
    data.tokensUsed ?? null, data.code ?? null, data.codeLength ?? null,
    data.cost ?? null, data.durationMs ?? null,
    data.reasoningEffort ?? null,
  );
}

export function getResults(db) {
  return db.prepare('SELECT * FROM runs ORDER BY created_at DESC').all();
}

export function saveRunStart(db, data) {
  db.prepare(`
    INSERT OR IGNORE INTO run_state (run_id, model, provider, prompt_version, reasoning_effort, started_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    data.runId, data.model, data.provider,
    data.promptVersion ?? null, data.reasoningEffort ?? null,
    data.startedAt,
  );
}

export function saveRunEnd(db, data) {
  if (!data.finishedAt) return;
  const finishedAt = data.finishedAt;
  const status = data.status ?? 'done';
  db.prepare(
    'UPDATE run_state SET finished_at = ?, status = ? WHERE run_id = ?'
  ).run(finishedAt, status, data.runId);
  // Also stamp finished_at on all attempt rows so started_at→finished_at spans the full run
  db.prepare(
    'UPDATE runs SET finished_at = ? WHERE run_id = ?'
  ).run(finishedAt, data.runId);
}

export function getRunMeta(db) {
  return db.prepare(`
    SELECT run_id, model, provider, prompt_version, reasoning_effort,
           started_at, finished_at, status
    FROM run_state
    ORDER BY started_at DESC
  `).all();
}

export function getCompletedTargetIds(db, runId) {
  const rows = db.prepare(
    'SELECT DISTINCT target_id FROM runs WHERE run_id = ?'
  ).all(runId);
  // node:sqlite stores JS Numbers as REAL, so target_id TEXT may contain "1.0" instead of "1".
  // Normalise to integer string to match String(def.id) comparisons in benchmark.js.
  return new Set(rows.map(r => String(Math.round(Number(r.target_id)))));
}

// Upsert rows downloaded from Supabase — skips rows already present locally.
export function upsertRuns(db, rows) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO runs
      (run_id, benchmark_version, model, provider,
       prompt_version, temperature, attempts_per_target, started_at, finished_at,
       target_id, target_type, attempt, match, score,
       tokens_used, code, code_length, cost, duration_ms, reasoning_effort, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  let inserted = 0;
  for (const r of rows) {
    const { changes } = stmt.run(
      r.run_id, r.benchmark_version, r.model, r.provider,
      r.prompt_version ?? null, r.temperature ?? null, r.attempts_per_target ?? null,
      r.started_at ?? null, r.finished_at ?? null,
      r.target_id, r.target_type, r.attempt,
      r.match ?? null, r.score ?? null,
      r.tokens_used ?? null, r.code ?? null, r.code_length ?? null,
      r.cost ?? null, r.duration_ms ?? null, r.reasoning_effort ?? null,
      r.created_at ?? null,
    );
    inserted += changes;
  }
  return inserted;
}

export function upsertRunStates(db, rows) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO run_state
      (run_id, model, provider, prompt_version, reasoning_effort, started_at, finished_at, status)
    VALUES (?,?,?,?,?,?,?,?)
  `);
  let inserted = 0;
  for (const r of rows) {
    const { changes } = stmt.run(
      r.run_id, r.model, r.provider,
      r.prompt_version ?? null, r.reasoning_effort ?? null,
      r.started_at, r.finished_at ?? null, r.status ?? 'done',
    );
    inserted += changes;
  }
  return inserted;
}

export function deleteRunsByModel(db, model) {
  const runIds = db.prepare('SELECT DISTINCT run_id FROM runs WHERE model = ?').all(model).map(r => r.run_id);
  db.prepare('DELETE FROM runs WHERE model = ?').run(model);
  if (runIds.length) {
    const placeholders = runIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM run_state WHERE run_id IN (${placeholders})`).run(...runIds);
  }
  return { deleted: runIds.length };
}
