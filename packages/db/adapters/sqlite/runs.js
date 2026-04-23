// Row reads + analytical helpers for the `runs` table.
// Writes during a benchmark flow through packages/db/adapters/sqlite/queue.js
// (enqueueRun / claimNextPending / completeAttempt / failAttempt).
// `saveAttempt` below is a test-only shortcut that inserts a done row directly.

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

const VALID_SORT = new Set([
  'created_at', 'model', 'target_id', 'target_type', 'score',
  'match', 'attempt', 'cost', 'duration_ms', 'run_id',
]);

// Reads from attempt_results so in-progress rows (pending/running/waiting/
// paused/error) never leak into the history UI, analytics, or sync uploads.
export function getResults(db, { limit, offset, sort = 'created_at', dir = 'desc', runId, model } = {}) {
  const col = VALID_SORT.has(sort) ? sort : 'created_at';
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  const params = [];
  const where = [];
  if (runId) { where.push('run_id = ?'); params.push(runId); }
  if (model) { where.push('model = ?'); params.push(model); }
  let sql = 'SELECT * FROM attempt_results';
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ` ORDER BY ${col} ${direction}`;
  if (limit != null) {
    sql += ' LIMIT ?';
    params.push(Number(limit));
    if (offset != null) {
      sql += ' OFFSET ?';
      params.push(Number(offset));
    }
  }
  return db.prepare(sql).all(...params);
}

export function getResultsCount(db, { runId, model } = {}) {
  const params = [];
  const where = [];
  if (runId) { where.push('run_id = ?'); params.push(runId); }
  if (model) { where.push('model = ?'); params.push(model); }
  const sql = 'SELECT COUNT(*) as count FROM attempt_results' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '');
  return db.prepare(sql).get(...params).count;
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export function getLeaderboard(db, promptVersion) {
  const rows = promptVersion
    ? db.prepare('SELECT * FROM leaderboard_by_version WHERE prompt_version = ?').all(promptVersion)
    : db.prepare('SELECT * FROM leaderboard').all();

  const allRows = promptVersion
    ? db.prepare('SELECT * FROM leaderboard').all()
    : rows;

  const promptVersions = db.prepare(
    'SELECT DISTINCT prompt_version FROM attempt_results WHERE prompt_version IS NOT NULL ORDER BY prompt_version'
  ).all().map(r => r.prompt_version);

  return {
    rows: rows.map(r => ({
      model: r.model,
      reasoningEffort: r.reasoning_effort ?? null,
      provider: r.provider,
      promptVersions: r.prompt_versions ? r.prompt_versions.split(',') : [],
      targets: Number(r.targets),
      avgScore: r.avg_score != null ? Number(r.avg_score) : null,
      avgMatch: r.avg_match != null ? Number(r.avg_match) : null,
      totalCost: r.total_cost != null ? Number(r.total_cost) : null,
      avgCost: r.avg_cost != null ? Number(r.avg_cost) : null,
      avgDuration: r.avg_duration_ms != null ? Number(r.avg_duration_ms) : null,
      perfectCount: Number(r.perfect_count),
      perfectRate: r.perfect_rate != null ? Number(r.perfect_rate) : null,
    })),
    totalAttempts: allRows.reduce((a, r) => a + Number(r.attempt_count ?? 0), 0),
    totalCost: allRows.reduce((a, r) => a + Number(r.total_cost ?? 0), 0),
    models: rows.length,
    promptVersions,
  };
}

// ─── Insights ─────────────────────────────────────────────────────────────────

const DIST_BUCKETS = [
  '0\u20139', '10\u201319', '20\u201329', '30\u201339', '40\u201349',
  '50\u201359', '60\u201369', '70\u201379', '80\u201389', '90\u201399', '100',
];

function modelConfigLabel(model, reasoningEffort) {
  return reasoningEffort ? `${model} [${reasoningEffort}]` : model;
}

function mapDifficulty(rows) {
  return rows
    .map(r => {
      const type = r.target_type;
      const rawId = type === 'battle'
        ? String(Math.round(Number(r.target_id)))
        : r.target_id;
      return {
        key: `${type}__${r.target_id}`,
        label: `#${rawId}`,
        name: r.name,
        avgMatch: +Number(r.avg_match).toFixed(1),
        targetType: type,
        rawId,
        imgUrl: `/api/targets/${type}/${rawId}/image`,
      };
    })
    .sort((a, b) => a.avgMatch - b.avgMatch);
}

function mapConsistency(rows) {
  return rows
    .map(r => ({
      model: r.model,
      reasoningEffort: r.reasoning_effort ?? null,
      label: modelConfigLabel(r.model, r.reasoning_effort),
      avgMatch: +Number(r.avg_match).toFixed(1),
      stdDev: +Number(r.std_dev).toFixed(1),
      n: Number(r.n),
    }))
    .sort((a, b) => a.stdDev - b.stdDev);
}

function mapCostEfficiency(rows) {
  return rows
    .map(r => {
      const avgScore = Number(r.avg_score);
      const avgCost = r.avg_cost != null ? Number(r.avg_cost) : 0;
      const ratio = avgCost > 0 ? avgScore / (avgCost * 1000) : null;
      return {
        model: r.model,
        reasoningEffort: r.reasoning_effort ?? null,
        label: modelConfigLabel(r.model, r.reasoning_effort),
        avgScore: +avgScore.toFixed(1),
        avgCost,
        ratio,
      };
    })
    .sort((a, b) => (b.ratio ?? -Infinity) - (a.ratio ?? -Infinity));
}

function buildDistributionMap(distRows, allDistRows) {
  const allByBucket = {};
  for (const r of allDistRows) allByBucket[r.bucket] = Number(r.count);

  const byModel = {};
  for (const r of distRows) {
    if (!byModel[r.model]) byModel[r.model] = {};
    byModel[r.model][r.bucket] = Number(r.count);
  }

  const result = { '': DIST_BUCKETS.map(range => ({ range, count: allByBucket[range] ?? 0 })) };
  for (const [model, byBucket] of Object.entries(byModel)) {
    result[model] = DIST_BUCKETS.map(range => ({ range, count: byBucket[range] ?? 0 }));
  }
  return result;
}

export function getInsights(db, promptVersion) {
  const diffRows = promptVersion
    ? db.prepare('SELECT * FROM target_difficulty WHERE prompt_version = ?').all(promptVersion)
    : db.prepare(`
        SELECT target_id, target_type, AVG(avg_match) AS avg_match,
               MAX(name) AS name, MAX(image_url) AS image_url
        FROM target_difficulty GROUP BY target_id, target_type
      `).all();

  const consistRows = promptVersion
    ? db.prepare('SELECT model, reasoning_effort, avg_match, std_dev, n FROM model_consistency WHERE prompt_version = ?').all(promptVersion)
    : db.prepare(`
        SELECT model, reasoning_effort, AVG(avg_match) AS avg_match, AVG(std_dev) AS std_dev, SUM(n) AS n
        FROM model_consistency GROUP BY model, reasoning_effort
      `).all();

  const costRows = promptVersion
    ? db.prepare('SELECT model, reasoning_effort, avg_score, avg_cost FROM cost_efficiency WHERE prompt_version = ?').all(promptVersion)
    : db.prepare(`
        SELECT model, reasoning_effort, AVG(avg_score) AS avg_score, AVG(avg_cost) AS avg_cost
        FROM cost_efficiency GROUP BY model, reasoning_effort
      `).all();

  const distRows = promptVersion
    ? db.prepare('SELECT model, bucket, count FROM match_distribution WHERE prompt_version = ?').all(promptVersion)
    : db.prepare('SELECT model, bucket, count FROM match_distribution').all();

  const allDistRows = promptVersion
    ? db.prepare('SELECT bucket, SUM(count) AS count FROM match_distribution WHERE prompt_version = ? GROUP BY bucket').all(promptVersion)
    : db.prepare('SELECT bucket, SUM(count) AS count FROM match_distribution GROUP BY bucket').all();

  const models = [...new Set(distRows.map(r => r.model))].sort();

  return {
    difficulty: mapDifficulty(diffRows),
    consistency: mapConsistency(consistRows),
    costEfficiency: mapCostEfficiency(costRows),
    distributions: buildDistributionMap(distRows, allDistRows),
    models,
  };
}

// ─── Fill / resume helpers ────────────────────────────────────────────────────

/**
 * For a (model, promptVersion, reasoningEffort, targetType) tuple, return the
 * highest stored attempt number per target and the code of that attempt.
 * Used for fill-mode to know how many more attempts are needed per target
 * and to seed follow-up context from the last stored attempt.
 */
export function getExistingAttempts(db, { model, promptVersion, reasoningEffort, targetType, targetIds }) {
  if (!targetIds?.length) return new Map();
  const placeholders = targetIds.map(() => '?').join(',');
  // target_id is TEXT but may contain "1.0" from node:sqlite Number coercion;
  // normalise on both sides via CAST to real then ROUND for matching.
  const rows = db.prepare(`
    SELECT CAST(ROUND(CAST(target_id AS REAL)) AS INTEGER) AS tid_norm,
           attempt, code
    FROM runs
    WHERE model = ?
      AND (prompt_version IS ? OR prompt_version = ?)
      AND (reasoning_effort IS ? OR reasoning_effort = ?)
      AND target_type = ?
      AND status = 'done'
      AND CAST(ROUND(CAST(target_id AS REAL)) AS INTEGER) IN (${placeholders})
    ORDER BY attempt DESC
  `).all(
    model,
    promptVersion ?? null, promptVersion ?? null,
    reasoningEffort ?? null, reasoningEffort ?? null,
    targetType,
    ...targetIds.map(id => Math.round(Number(id))),
  );
  const map = new Map();
  for (const r of rows) {
    const key = String(r.tid_norm);
    const existing = map.get(key);
    if (!existing || r.attempt > existing.maxAttempt) {
      map.set(key, { maxAttempt: r.attempt, lastCode: r.code });
    }
  }
  return map;
}

export function getCompletedTargetIds(db, runId) {
  const rows = db.prepare(
    "SELECT DISTINCT target_id FROM runs WHERE run_id = ? AND status = 'done'"
  ).all(runId);
  // node:sqlite stores JS Numbers as REAL, so target_id TEXT may contain "1.0" instead of "1".
  // Normalise to integer string to match String(def.id) comparisons in benchmark.js.
  return new Set(rows.map(r => String(Math.round(Number(r.target_id)))));
}

// Upsert rows downloaded from Supabase — skips rows already present locally.
// Supabase only stores done attempts; locally they land with status='done'
// (default column value), no queue-state columns required.
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

// Deletes every row (done + queue state) that matches the (model,
// reasoningEffort, promptVersions) filter. Targets the `runs` table
// directly — `run_state` was removed in the slice 4.3 cleanup.
export function deleteRunGroup(db, { model, reasoningEffort = null, promptVersions } = {}) {
  if (!model) {
    throw new Error('model is required');
  }

  const selectedPromptVersions = Array.isArray(promptVersions)
    ? [...new Set(promptVersions.filter(Boolean))]
    : [];

  const where = ['model = ?'];
  const params = [model];

  if (reasoningEffort == null) {
    where.push('reasoning_effort IS NULL');
  } else {
    where.push('reasoning_effort = ?');
    params.push(reasoningEffort);
  }

  if (selectedPromptVersions.length) {
    const placeholders = selectedPromptVersions.map(() => '?').join(',');
    where.push(`prompt_version IN (${placeholders})`);
    params.push(...selectedPromptVersions);
  }

  const selectSql = `SELECT DISTINCT run_id FROM runs WHERE ${where.join(' AND ')}`;

  db.exec('BEGIN');
  try {
    const runIds = db.prepare(selectSql).all(...params).map(r => r.run_id);
    if (!runIds.length) {
      db.exec('COMMIT');
      return { deletedRuns: 0, deletedAttempts: 0 };
    }

    const placeholders = runIds.map(() => '?').join(',');
    const deleteAttempts = db.prepare(`DELETE FROM runs WHERE run_id IN (${placeholders})`).run(...runIds);

    db.exec('COMMIT');
    return { deletedRuns: runIds.length, deletedAttempts: deleteAttempts.changes };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
