export function saveRunMeta(db, data) {
  db.prepare(`
    INSERT OR REPLACE INTO run_meta
      (run_id, model, provider, prompt_version, temperature, attempts_per_target, started_at, finished_at, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.runId, data.model, data.provider, data.promptVersion,
    data.temperature, data.attemptsPerTarget,
    data.startedAt, data.finishedAt,
    JSON.stringify(data.summary),
  );
}

export function getRunMeta(db) {
  return db.prepare('SELECT * FROM run_meta ORDER BY started_at DESC').all();
}
