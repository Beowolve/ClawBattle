# ClawBattle
**AI Model Benchmark**

Measures how well LLMs can reproduce pixel-perfect CSS targets. Run multiple models against the same targets and compare scores, match rates, and cost on the dashboard.

## Quick Start

```bash
cp .env.example .env
# Add your API keys to .env

docker compose up api dashboard
```

Open `http://localhost:5173` for the dashboard.

## Running a Benchmark

```bash
# Via Docker (recommended)
docker compose run runner node cli.js \
  --model openai/gpt-4o \
  --provider openrouter \
  --targets battle \
  --attempts 3 \
  --prompt v2

# Or start a run directly from the dashboard (Run tab)
```

Options:
- `--provider` — `openrouter` | `openai` | `ollama`
- `--targets` — `battle` | `daily`
- `--attempts` — attempts per target (best score counts)
- `--prompt` — prompt version (`v1`, `v2`, …)
- `--concurrency` — run N targets in parallel (default: `1`)
- `--retries` — retry a target from scratch if all attempts error (default: `0`)
- `--reasoning` — reasoning effort for o-series models: `low` | `medium` | `high` | `xhigh`
- `--target-from` / `--target-to` — limit to a target range (e.g. 1–25)

## Structure

```
packages/
  core/        Renderer (Puppeteer) + Scorer (pixelmatch) + LLM adapters
  runner/      CLI benchmark orchestrator
  api/         Express REST API + SSE progress stream
  dashboard/   React + Vite dashboard
  db/          Database adapters (SQLite built-in; Supabase for upload)
targets/
  images/      PNG reference images (battle + daily)
  definitions/ Target metadata (colors, dimensions)
baselines/
  human.json   Human expert top scores (reference baseline)
prompts/
  v1/          Original benchmark prompt
  v2/          Improved color accuracy rules
scripts/
  migrate-runs.js         Migrate DB schema to latest version (run once after update)
  upload-results.js       Upload local SQLite results to Supabase
  sync-targets.js         Sync target definitions/images from remote source
  recalculate-scores.js   Recompute match% + scores for all stored runs
```

## Scoring

- Pixel comparison via pixelmatch (threshold 0.01, matching CSS Battle)
- Score formula: `399.99725 × 0.9905144^charCount + 599.9987` (100% match only)
- Imperfect matches are penalized by `match³` — color accuracy matters far more than code brevity
- Results stored in SQLite (`results/clawbattle.db`) or Supabase

## Local API Development

```bash
cd packages/api
npm start   # node --env-file=../../.env server.js
```
