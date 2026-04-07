export function saveAttempt(db, data) {
  db.prepare(`
    INSERT INTO runs
      (run_id, benchmark_version, model, provider, target_id, target_type, attempt, match, score, tokens_used, code, code_length, cost, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.runId, data.benchmarkVersion, data.model, data.provider,
    data.targetId, data.targetType, data.attempt,
    data.match ?? null, data.score ?? null,
    data.tokensUsed ?? null, data.code ?? null, data.codeLength ?? null,
    data.cost ?? null, data.durationMs ?? null,
  );
}

export function getResults(db) {
  return db.prepare('SELECT * FROM runs ORDER BY created_at DESC').all();
}

export function getCompletedTargetIds(db, runId) {
  const rows = db.prepare(
    'SELECT DISTINCT target_id FROM runs WHERE run_id = ?'
  ).all(runId);
  // node:sqlite stores JS Numbers as REAL, so target_id TEXT may contain "1.0" instead of "1".
  // Normalise to integer string to match String(def.id) comparisons in benchmark.js.
  return new Set(rows.map(r => String(Math.round(Number(r.target_id)))));
}

export function deleteRunsByModel(db, model) {
  const runIds = db.prepare('SELECT DISTINCT run_id FROM runs WHERE model = ?').all(model).map(r => r.run_id);
  db.prepare('DELETE FROM runs WHERE model = ?').run(model);
  if (runIds.length) {
    const placeholders = runIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM run_meta WHERE run_id IN (${placeholders})`).run(...runIds);
  }
  return { deleted: runIds.length };
}
