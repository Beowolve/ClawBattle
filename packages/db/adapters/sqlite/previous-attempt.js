// Loads the prior done attempt for follow-up context when running attempt N (N > 1).
// Returns null if N == 1 or if the direct predecessor is not yet in status='done'.

export function getPreviousAttempt(db, runId, targetId, attempt) {
  if (attempt <= 1) return null;
  const row = db.prepare(`
    SELECT attempt, code, match, score
    FROM runs
    WHERE run_id = ? AND target_id = ? AND attempt = ? AND status = 'done'
  `).get(runId, String(targetId), attempt - 1);
  return row
    ? { attempt: row.attempt, code: row.code, match: row.match, score: row.score }
    : null;
}
