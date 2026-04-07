// One-time script: backfills run_meta for run_ids that exist in runs but not in run_meta.
// Summary (avgScore, perfectRate, targetCount) is computed from the runs table.
// Run with: node --env-file=.env scripts/backfill-run-meta.js

import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.env.SQLITE_PATH ?? './results/clawbattle.db');

const result = db.prepare(`
  INSERT OR IGNORE INTO run_meta
    (run_id, model, provider, prompt_version, temperature, attempts_per_target, started_at, finished_at, summary)
  SELECT
    run_id,
    model,
    provider,
    'v1',
    NULL,
    MAX(attempt),
    MIN(created_at),
    MAX(created_at),
    json_object(
      'avgScore', (
        SELECT AVG(best_score) FROM (
          SELECT MAX(score) AS best_score FROM runs r2
          WHERE r2.run_id = r1.run_id
          GROUP BY r2.target_id
        )
      ),
      'perfectRate', (
        SELECT SUM(CASE WHEN best_match >= 100 THEN 1.0 ELSE 0.0 END) / COUNT(*)
        FROM (
          SELECT MAX(match) AS best_match FROM runs r2
          WHERE r2.run_id = r1.run_id GROUP BY r2.target_id
        )
      ),
      'targetCount', COUNT(DISTINCT target_id)
    )
  FROM runs r1
  WHERE run_id NOT IN (SELECT run_id FROM run_meta)
  GROUP BY run_id, model, provider
`).run();

console.log(`Inserted ${result.changes} missing run_meta entries.`);
db.close();
