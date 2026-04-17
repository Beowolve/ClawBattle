// Opens and initialises a SQLite database.
// Callers should use getDb() for the app singleton,
// or openDb(':memory:') to get an isolated instance for tests.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
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
      match REAL NOT NULL,
      score REAL,
      tokens_used INTEGER,
      code TEXT,
      code_length INTEGER,
      cost REAL,
      duration_ms INTEGER,
      reasoning_effort TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS run_state (
      run_id           TEXT PRIMARY KEY,
      model            TEXT NOT NULL,
      provider         TEXT NOT NULL,
      prompt_version   TEXT,
      reasoning_effort TEXT,
      started_at       TEXT NOT NULL,
      finished_at      TEXT,
      status           TEXT NOT NULL DEFAULT 'running'
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_unique
      ON runs(run_id, target_id, attempt);
    CREATE INDEX IF NOT EXISTS idx_runs_model
      ON runs(model);
    CREATE INDEX IF NOT EXISTS idx_runs_target
      ON runs(target_id, target_type);
    CREATE INDEX IF NOT EXISTS idx_runs_created_at
      ON runs(created_at);

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

  db.exec(`
    DROP VIEW IF EXISTS leaderboard;
    CREATE VIEW leaderboard AS
    WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY model, reasoning_effort, target_id, target_type
        ORDER BY score DESC NULLS LAST
      ) AS rn FROM runs
    ),
    best_per_target AS (SELECT * FROM ranked WHERE rn = 1),
    model_costs AS (
      SELECT model, reasoning_effort,
        SUM(cost) AS total_cost,
        COUNT(*) AS attempt_count,
        GROUP_CONCAT(DISTINCT prompt_version ORDER BY prompt_version) AS prompt_versions
      FROM runs GROUP BY model, reasoning_effort
    )
    SELECT
      b.model, b.reasoning_effort,
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
    JOIN model_costs c ON b.model = c.model AND b.reasoning_effort IS c.reasoning_effort
    GROUP BY b.model, b.reasoning_effort, c.prompt_versions, c.total_cost, c.attempt_count;

    DROP VIEW IF EXISTS leaderboard_by_version;
    CREATE VIEW leaderboard_by_version AS
    WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY model, reasoning_effort, target_id, target_type, prompt_version
        ORDER BY score DESC NULLS LAST
      ) AS rn FROM runs
    ),
    best_per_target AS (SELECT * FROM ranked WHERE rn = 1),
    model_version_costs AS (
      SELECT model, reasoning_effort, prompt_version,
        SUM(cost) AS total_cost,
        COUNT(*) AS attempt_count
      FROM runs GROUP BY model, reasoning_effort, prompt_version
    )
    SELECT
      b.model, b.reasoning_effort, b.prompt_version,
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
      AND b.prompt_version IS c.prompt_version
    GROUP BY b.model, b.reasoning_effort, b.prompt_version, c.total_cost, c.attempt_count;

    DROP VIEW IF EXISTS target_difficulty;
    CREATE VIEW target_difficulty AS
    WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY model, target_id, target_type, prompt_version
        ORDER BY match DESC NULLS LAST
      ) AS rn FROM runs
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
    FROM runs WHERE match IS NOT NULL
    GROUP BY model, prompt_version;

    DROP VIEW IF EXISTS cost_efficiency;
    CREATE VIEW cost_efficiency AS
    WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY model, target_id, target_type, prompt_version
        ORDER BY score DESC NULLS LAST
      ) AS rn FROM runs
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
    FROM runs WHERE match IS NOT NULL
    GROUP BY model, prompt_version, bucket;
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
