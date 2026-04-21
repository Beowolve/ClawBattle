// DB-backed run queue: attempt rows are pre-inserted and transition through
// waiting → pending → running → done|error, with pause/resume handled via
// `paused_from`. This replaces the in-memory queue in packages/runner/benchmark.js.

import { randomUUID } from 'node:crypto';

export function enqueueRun(db, opts) {
  const {
    runId,
    benchmarkVersion,
    model,
    provider,
    promptVersion = null,
    reasoningEffort = null,
    attemptsPerTarget,
    startedAt = null,
    targets,
  } = opts;

  if (!runId) throw new Error('enqueueRun: runId is required');
  if (!benchmarkVersion) throw new Error('enqueueRun: benchmarkVersion is required');
  if (!model) throw new Error('enqueueRun: model is required');
  if (!provider) throw new Error('enqueueRun: provider is required');
  if (!Number.isInteger(attemptsPerTarget) || attemptsPerTarget < 1) {
    throw new Error('enqueueRun: attemptsPerTarget must be a positive integer');
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error('enqueueRun: targets must be a non-empty array');
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO runs
      (run_id, benchmark_version, model, provider,
       prompt_version, reasoning_effort, attempts_per_target, started_at,
       target_id, target_type, attempt, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN');
  try {
    let inserted = 0;
    for (const target of targets) {
      const targetId = String(target.id);
      const targetType = target.type;
      for (let attempt = 1; attempt <= attemptsPerTarget; attempt++) {
        const status = attempt === 1 ? 'pending' : 'waiting';
        const { changes } = stmt.run(
          runId, benchmarkVersion, model, provider,
          promptVersion, reasoningEffort, attemptsPerTarget, startedAt,
          targetId, targetType, attempt, status,
        );
        inserted += changes;
      }
    }
    db.exec('COMMIT');
    return inserted;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function completeAttempt(db, id, claimToken, result) {
  const {
    match = null,
    score = null,
    code = null,
    codeLength = null,
    tokensUsed = null,
    cost = null,
    durationMs = null,
    finishedAt = null,
  } = result ?? {};

  db.exec('BEGIN');
  try {
    const { changes } = db.prepare(`
      UPDATE runs
      SET status = 'done',
          match = ?, score = ?, code = ?, code_length = ?,
          tokens_used = ?, cost = ?, duration_ms = ?, finished_at = ?,
          error_message = NULL
      WHERE id = ? AND status = 'running' AND claim_token = ?
    `).run(match, score, code, codeLength, tokensUsed, cost, durationMs, finishedAt, id, claimToken);

    if (changes === 0) {
      db.exec('ROLLBACK');
      return false;
    }

    db.prepare(`
      UPDATE runs
      SET status = 'pending'
      WHERE status = 'waiting'
        AND (run_id, target_id, attempt) = (
          SELECT run_id, target_id, attempt + 1 FROM runs WHERE id = ?
        )
    `).run(id);

    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function failAttempt(db, id, claimToken, errorMessage) {
  const finishedAt = new Date().toISOString();
  const { changes } = db.prepare(`
    UPDATE runs
    SET status = 'error',
        error_message = ?,
        finished_at = ?
    WHERE id = ? AND status = 'running' AND claim_token = ?
  `).run(errorMessage ?? null, finishedAt, id, claimToken);
  return changes > 0;
}

function toPlain(row) {
  return row ? { ...row } : row;
}

export function getRunQueue(db) {
  const summaries = db.prepare(`
    SELECT * FROM runs_summary
    WHERE status != 'done'
    ORDER BY started_at DESC, run_id DESC
  `).all().map(toPlain);
  if (summaries.length === 0) return [];
  const attemptsStmt = db.prepare(`
    SELECT * FROM runs WHERE run_id = ? ORDER BY target_id, attempt
  `);
  return summaries.map(s => ({ ...s, attempts: attemptsStmt.all(s.run_id).map(toPlain) }));
}

export function getRunHistory(db) {
  return db.prepare(`
    SELECT * FROM runs_summary
    WHERE status = 'done'
    ORDER BY finished_at DESC, run_id DESC
  `).all().map(toPlain);
}

export function requeueStaleRunningAttempts(db) {
  const { changes } = db.prepare(`
    UPDATE runs
    SET status = 'pending',
        claim_token = NULL,
        claimed_at = NULL
    WHERE status = 'running'
  `).run();
  return changes;
}

export function pauseRun(db, runId) {
  db.exec('BEGIN');
  try {
    // Running rows: discard any partial worker state first, then treat as pending on resume.
    db.prepare(`
      UPDATE runs
      SET match = NULL, score = NULL, code = NULL, code_length = NULL,
          tokens_used = NULL, cost = NULL, duration_ms = NULL, finished_at = NULL,
          claim_token = NULL, claimed_at = NULL
      WHERE run_id = ? AND status = 'running'
    `).run(runId);

    const { changes } = db.prepare(`
      UPDATE runs
      SET paused_from = CASE WHEN status = 'running' THEN 'pending' ELSE status END,
          status = 'paused'
      WHERE run_id = ? AND status IN ('pending', 'running', 'waiting', 'error')
    `).run(runId);

    db.exec('COMMIT');
    return changes;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function resumeRun(db, runId) {
  const { changes } = db.prepare(`
    UPDATE runs
    SET status = paused_from,
        paused_from = NULL,
        enqueued_at = datetime('now')
    WHERE run_id = ? AND status = 'paused'
  `).run(runId);
  return changes;
}

export function retryAttempt(db, id) {
  const { changes } = db.prepare(`
    UPDATE runs
    SET status = 'pending',
        error_message = NULL,
        finished_at = NULL,
        claimed_at = NULL,
        claim_token = NULL
    WHERE id = ? AND status = 'error'
  `).run(id);
  return changes > 0;
}

export function resetErrors(db, runId = null) {
  const sql = `
    UPDATE runs
    SET status = 'pending',
        error_message = NULL,
        finished_at = NULL,
        claimed_at = NULL,
        claim_token = NULL
    WHERE status = 'error'${runId ? ' AND run_id = ?' : ''}
  `;
  const { changes } = runId ? db.prepare(sql).run(runId) : db.prepare(sql).run();
  return changes;
}

export function claimNextPending(db) {
  const token = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare(`
      UPDATE runs
      SET status = 'running',
          claimed_at = datetime('now'),
          claim_token = ?
      WHERE id = (
        SELECT id FROM runs
        WHERE status = 'pending'
        ORDER BY enqueued_at, id
        LIMIT 1
      )
      RETURNING *
    `).get(token);
    db.exec('COMMIT');
    return row ?? null;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
