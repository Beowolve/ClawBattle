// Recalculates match% and score for all runs with stored code,
// using the current scorer threshold (0.01 instead of previous 0.1).
// Also updates run_meta summaries to reflect the new values.
//
// Run with: node --env-file=.env scripts/recalculate-scores.js

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { render, closeBrowser } from '../packages/core/renderer.js';
import { score, computeScore } from '../packages/core/scorer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS_DIR = path.join(ROOT, 'targets', 'images');
const db = new DatabaseSync(process.env.SQLITE_PATH ?? './results/clawbattle.db');

const runs = db.prepare(
  'SELECT id, run_id, target_id, target_type, code, code_length FROM runs WHERE code IS NOT NULL ORDER BY id',
).all();

console.log(`Recalculating ${runs.length} runs...\n`);

const updateRun = db.prepare('UPDATE runs SET match = ?, score = ? WHERE id = ?');

let updated = 0;
let skipped = 0;
let errors = 0;

for (const run of runs) {
  const targetId = run.target_type === 'battle' ? parseInt(run.target_id) : run.target_id;
  const imagePath = path.join(TARGETS_DIR, run.target_type, `${targetId}.png`);

  if (!fs.existsSync(imagePath)) {
    console.warn(`[skip] Run ${run.id}: target image not found (${imagePath})`);
    skipped++;
    continue;
  }

  try {
    const targetBuffer = fs.readFileSync(imagePath);
    const rendered = await render(run.code);
    const { match, matchPercent } = score(rendered, targetBuffer);
    const newScore = computeScore(run.code_length ?? run.code?.length ?? 0, match);

    updateRun.run(matchPercent, newScore, run.id);
    updated++;

    if (updated % 25 === 0) {
      console.log(`  ${updated}/${runs.length} updated...`);
    }
  } catch (err) {
    console.error(`[error] Run ${run.id}: ${err.message}`);
    errors++;
  }
}

await closeBrowser();
console.log(`\nRuns done. Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);

// Recalculate run_meta summaries from the updated runs table
console.log('\nRecalculating run_meta summaries...');

const metaResult = db.prepare(`
  UPDATE run_meta SET summary = (
    SELECT json_object(
      'avgScore', (
        SELECT AVG(best_score) FROM (
          SELECT MAX(score) AS best_score FROM runs r
          WHERE r.run_id = run_meta.run_id GROUP BY r.target_id
        )
      ),
      'perfectRate', (
        SELECT SUM(CASE WHEN best_match >= 100 THEN 1.0 ELSE 0.0 END) / COUNT(*)
        FROM (
          SELECT MAX(match) AS best_match FROM runs r
          WHERE r.run_id = run_meta.run_id GROUP BY r.target_id
        )
      ),
      'targetCount', (
        SELECT COUNT(DISTINCT target_id) FROM runs r WHERE r.run_id = run_meta.run_id
      )
    )
  )
`).run();

console.log(`run_meta summaries updated: ${metaResult.changes} rows`);

db.close();
console.log('\nDone.');
