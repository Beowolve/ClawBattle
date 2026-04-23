// Opens and initialises a SQLite database.
// Callers should use getDb() for the app singleton,
// or openDb(':memory:') to get an isolated instance for tests.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const RUNS_COLUMNS_SQL = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  benchmark_version TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  prompt_version TEXT,
  temperature REAL,
  attempts_per_target INTEGER,
  started_at TEXT,
  finished_at TEXT,
  target_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  match REAL,
  score REAL,
  tokens_used INTEGER,
  code TEXT,
  prompt_text TEXT,
  code_length INTEGER,
  cost REAL,
  duration_ms INTEGER,
  reasoning_effort TEXT,
  reasoning_max_tokens INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'done',
  error_message TEXT,
  enqueued_at TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at TEXT,
  claim_token TEXT,
  paused_from TEXT
`;

const LEGACY_REUSABLE_COLUMNS = [
  'id', 'run_id', 'benchmark_version', 'model', 'provider',
  'prompt_version', 'temperature', 'attempts_per_target', 'started_at', 'finished_at',
  'target_id', 'target_type', 'attempt', 'match', 'score', 'tokens_used',
  'code', 'prompt_text', 'code_length', 'cost', 'duration_ms', 'reasoning_effort', 'reasoning_max_tokens',
  'created_at', 'status', 'error_message', 'enqueued_at', 'claimed_at', 'claim_token', 'paused_from',
];

// Views that reference 'runs' — must be dropped before the table can be dropped.
// initSchema recreates them unconditionally after migration.
const RUNS_VIEWS = [
  'attempt_results', 'leaderboard', 'leaderboard_by_version',
  'target_difficulty', 'model_consistency', 'cost_efficiency',
  'match_distribution', 'runs_summary',
];

// Must be called before CREATE TABLE IF NOT EXISTS runs so that an orphaned
// runs_new from a previous interrupted migration is not shadowed by a fresh
// empty runs table.
function recoverOrphanedRunsNew(db) {
  const runsNewExists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runs_new'",
  ).get();
  if (!runsNewExists) return;

  const runsExists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runs'",
  ).get();
  if (!runsExists) {
    // Interrupted mid-migration: runs was dropped but the rename never ran.
    // Complete the rename now.
    db.exec('ALTER TABLE runs_new RENAME TO runs');
  } else {
    // Both tables exist — runs_new is a stale leftover from a previously
    // completed migration that was not cleaned up.
    db.exec('DROP TABLE runs_new');
  }
}

function migrateRunsTable(db) {
  const cols = db.prepare('PRAGMA table_info(runs)').all();
  if (cols.length === 0) return;

  const names = new Set(cols.map(c => c.name));
  const matchCol = cols.find(c => c.name === 'match');
  const matchIsNotNull = matchCol && matchCol.notnull === 1;
  const missingNewColumns = ['status', 'enqueued_at', 'paused_from'].some(n => !names.has(n));

  if (!matchIsNotNull && !missingNewColumns) return;

  // Drop any views that reference 'runs' so the subsequent DROP TABLE succeeds.
  // Use individual exec() calls — node:sqlite has quirks with multi-statement
  // DDL sequences that mix DROP TABLE and ALTER TABLE in a single exec() call.
  for (const v of RUNS_VIEWS) db.exec(`DROP VIEW IF EXISTS ${v}`);

  const carryOver = LEGACY_REUSABLE_COLUMNS.filter(n => names.has(n));
  const carryList = carryOver.join(', ');
  db.exec(`CREATE TABLE runs_new (${RUNS_COLUMNS_SQL})`);
  db.exec(`INSERT INTO runs_new (${carryList}) SELECT ${carryList} FROM runs`);
  db.exec('DROP TABLE runs');
  db.exec('ALTER TABLE runs_new RENAME TO runs');
}

export function initSchema(db) {
  // Must run before CREATE TABLE IF NOT EXISTS runs to avoid shadowing an
  // orphaned runs_new with a fresh empty runs table.
  recoverOrphanedRunsNew(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (${RUNS_COLUMNS_SQL});

    -- run_state was removed in the queue refactor (slice 4.3). The runs_summary
    -- view aggregates status + metadata directly from the runs table.
    DROP TABLE IF EXISTS run_state;

    CREATE TABLE IF NOT EXISTS battle_targets (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT NOT NULL,
      colors TEXT NOT NULL DEFAULT '[]',
      battle_number INTEGER NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_targets (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT NOT NULL,
      colors TEXT NOT NULL DEFAULT '[]',
      date TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  migrateRunsTable(db);

  // Additive column migrations for existing DBs (no rebuild needed).
  const currentCols = new Set(db.prepare('PRAGMA table_info(runs)').all().map(c => c.name));
  if (!currentCols.has('reasoning_max_tokens')) {
    db.exec('ALTER TABLE runs ADD COLUMN reasoning_max_tokens INTEGER');
  }
  if (!currentCols.has('prompt_text')) {
    db.exec('ALTER TABLE runs ADD COLUMN prompt_text TEXT');
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_unique
      ON runs(run_id, target_id, attempt);
    CREATE INDEX IF NOT EXISTS idx_runs_model
      ON runs(model);
    CREATE INDEX IF NOT EXISTS idx_runs_target
      ON runs(target_id, target_type);
    CREATE INDEX IF NOT EXISTS idx_runs_created_at
      ON runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_queue
      ON runs(status, enqueued_at, id)
      WHERE status IN ('pending', 'running', 'paused', 'waiting', 'error');
  `);

  db.exec(`
    DROP VIEW IF EXISTS attempt_results;
    CREATE VIEW attempt_results AS
    SELECT * FROM runs WHERE status = 'done';

    DROP VIEW IF EXISTS leaderboard;
    CREATE VIEW leaderboard AS
    WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY model, reasoning_effort, reasoning_max_tokens, target_id, target_type
        ORDER BY score DESC NULLS LAST
      ) AS rn FROM attempt_results
    ),
    best_per_target AS (SELECT * FROM ranked WHERE rn = 1),
    model_costs AS (
      SELECT model, reasoning_effort, reasoning_max_tokens,
        SUM(cost) AS total_cost,
        COUNT(*) AS attempt_count,
        GROUP_CONCAT(DISTINCT prompt_version ORDER BY prompt_version) AS prompt_versions
      FROM attempt_results GROUP BY model, reasoning_effort, reasoning_max_tokens
    )
    SELECT
      b.model, b.reasoning_effort, b.reasoning_max_tokens,
      MAX(b.provider) AS provider,
      c.prompt_versions,
      COUNT(*) AS targets,
      AVG(b.score) AS avg_score,
      AVG(b.match) AS avg_match,
      AVG(b.duration_ms) AS avg_duration_ms,
      SUM(CASE WHEN b.match >= 100 THEN 1 ELSE 0 END) AS perfect_count,
      CASE WHEN COUNT(*) > 0
        THEN CAST(SUM(CASE WHEN b.match >= 100 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)
        ELSE NULL END AS perfect_rate,
      c.total_cost,
      CASE WHEN c.attempt_count > 0 THEN c.total_cost / c.attempt_count ELSE NULL END AS avg_cost,
      c.attempt_count
    FROM best_per_target b
    JOIN model_costs c
      ON b.model = c.model
      AND b.reasoning_effort IS c.reasoning_effort
      AND b.reasoning_max_tokens IS c.reasoning_max_tokens
    GROUP BY b.model, b.reasoning_effort, b.reasoning_max_tokens, c.prompt_versions, c.total_cost, c.attempt_count;

    DROP VIEW IF EXISTS leaderboard_by_version;
    CREATE VIEW leaderboard_by_version AS
    WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY model, reasoning_effort, reasoning_max_tokens, target_id, target_type, prompt_version
        ORDER BY score DESC NULLS LAST
      ) AS rn FROM attempt_results
    ),
    best_per_target AS (SELECT * FROM ranked WHERE rn = 1),
    model_version_costs AS (
      SELECT model, reasoning_effort, reasoning_max_tokens, prompt_version,
        SUM(cost) AS total_cost,
        COUNT(*) AS attempt_count
      FROM attempt_results GROUP BY model, reasoning_effort, reasoning_max_tokens, prompt_version
    )
    SELECT
      b.model, b.reasoning_effort, b.reasoning_max_tokens, b.prompt_version,
      MAX(b.provider) AS provider,
      COUNT(*) AS targets,
      AVG(b.score) AS avg_score,
      AVG(b.match) AS avg_match,
      AVG(b.duration_ms) AS avg_duration_ms,
      SUM(CASE WHEN b.match >= 100 THEN 1 ELSE 0 END) AS perfect_count,
      CASE WHEN COUNT(*) > 0
        THEN CAST(SUM(CASE WHEN b.match >= 100 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)
        ELSE NULL END AS perfect_rate,
      c.total_cost,
      CASE WHEN c.attempt_count > 0 THEN c.total_cost / c.attempt_count ELSE NULL END AS avg_cost,
      c.attempt_count
    FROM best_per_target b
    JOIN model_version_costs c
      ON b.model = c.model
      AND b.reasoning_effort IS c.reasoning_effort
      AND b.reasoning_max_tokens IS c.reasoning_max_tokens
      AND b.prompt_version IS c.prompt_version
    GROUP BY b.model, b.reasoning_effort, b.reasoning_max_tokens, b.prompt_version, c.total_cost, c.attempt_count;

    DROP VIEW IF EXISTS target_difficulty;
    CREATE VIEW target_difficulty AS
    WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY model, target_id, target_type, prompt_version
        ORDER BY match DESC NULLS LAST
      ) AS rn FROM attempt_results
    ),
    best_per_model AS (SELECT * FROM ranked WHERE rn = 1)
    SELECT
      d.target_id, d.target_type, d.prompt_version,
      AVG(d.match) AS avg_match,
      COALESCE(bt.name, dt.name, d.target_id) AS name,
      COALESCE(bt.image_url, dt.image_url) AS image_url
    FROM best_per_model d
    LEFT JOIN battle_targets bt
      ON d.target_type = 'battle'
      AND CAST(ROUND(CAST(d.target_id AS REAL)) AS INTEGER) = bt.id
    LEFT JOIN daily_targets dt
      ON d.target_type = 'daily' AND d.target_id = dt.key
    GROUP BY d.target_id, d.target_type, d.prompt_version,
             bt.name, bt.image_url, dt.name, dt.image_url;

    DROP VIEW IF EXISTS model_consistency;
    CREATE VIEW model_consistency AS
    SELECT model, prompt_version,
      AVG(match) AS avg_match,
      SQRT(AVG(match * match) - AVG(match) * AVG(match)) AS std_dev,
      COUNT(*) AS n
    FROM attempt_results WHERE match IS NOT NULL
    GROUP BY model, prompt_version;

    DROP VIEW IF EXISTS cost_efficiency;
    CREATE VIEW cost_efficiency AS
    WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY model, target_id, target_type, prompt_version
        ORDER BY score DESC NULLS LAST
      ) AS rn FROM attempt_results
    ),
    best_per_target AS (SELECT * FROM ranked WHERE rn = 1)
    SELECT model, prompt_version,
      AVG(score) AS avg_score,
      AVG(CASE WHEN cost IS NOT NULL THEN cost END) AS avg_cost
    FROM best_per_target GROUP BY model, prompt_version;

    DROP VIEW IF EXISTS match_distribution;
    CREATE VIEW match_distribution AS
    SELECT model, prompt_version,
      CASE
        WHEN match >= 100 THEN '100'
        WHEN match >=  90 THEN '90\u201399'
        WHEN match >=  80 THEN '80\u201389'
        WHEN match >=  70 THEN '70\u201379'
        WHEN match >=  60 THEN '60\u201369'
        WHEN match >=  50 THEN '50\u201359'
        WHEN match >=  40 THEN '40\u201349'
        WHEN match >=  30 THEN '30\u201339'
        WHEN match >=  20 THEN '20\u201329'
        WHEN match >=  10 THEN '10\u201319'
        ELSE                   '0\u20139'
      END AS bucket,
      COUNT(*) AS count
    FROM attempt_results WHERE match IS NOT NULL
    GROUP BY model, prompt_version, bucket;

    DROP VIEW IF EXISTS runs_summary;
    CREATE VIEW runs_summary AS
    SELECT
      run_id,
      MAX(benchmark_version) AS benchmark_version,
      MAX(model) AS model,
      MAX(provider) AS provider,
      MAX(prompt_version) AS prompt_version,
      MAX(reasoning_effort) AS reasoning_effort,
      MAX(reasoning_max_tokens) AS reasoning_max_tokens,
      MAX(attempts_per_target) AS attempts_per_target,
      MIN(started_at) AS started_at,
      CASE
        WHEN SUM(CASE WHEN status IN ('pending','running','waiting','paused','error') THEN 1 ELSE 0 END) = 0
        THEN MAX(finished_at)
        ELSE NULL
      END AS finished_at,
      CASE
        WHEN SUM(CASE WHEN status = 'paused'  THEN 1 ELSE 0 END) > 0 THEN 'paused'
        WHEN SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) > 0 THEN 'running'
        WHEN SUM(CASE WHEN status = 'error'   THEN 1 ELSE 0 END) > 0 THEN 'error'
        WHEN SUM(CASE WHEN status IN ('pending','waiting') THEN 1 ELSE 0 END) > 0 THEN 'queued'
        ELSE 'done'
      END AS status,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'done'    THEN 1 ELSE 0 END) AS done_count,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting_count,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_count,
      SUM(CASE WHEN status = 'paused'  THEN 1 ELSE 0 END) AS paused_count,
      SUM(CASE WHEN status = 'error'   THEN 1 ELSE 0 END) AS error_count
    FROM runs
    GROUP BY run_id;
  `);
}

export function openDb(path) {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new DatabaseSync(path);
  initSchema(db);
  return db;
}

let singleton;

export function getDb() {
  if (!singleton) {
    const raw = process.env.SQLITE_PATH ?? 'results/clawbattle.db';
    singleton = openDb(resolve(ROOT, raw));
  }
  return singleton;
}
