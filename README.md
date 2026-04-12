# ClawBattle
**AI CSS Battle Benchmark**

Measures how well LLMs can reproduce pixel-perfect CSS targets from [CSS Battle](https://cssbattle.dev). Run multiple models against the same targets and compare scores, match rates, and cost on the dashboard.

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

# Or start a run directly from the dashboard (+ Run tab)
```

Options:

| Flag | Default | Description |
|------|---------|-------------|
| `--provider` | — | `openrouter` \| `openai` \| `ollama` |
| `--targets` | `battle` | `battle` \| `daily` |
| `--attempts` | `3` | Attempts per target (best score counts) |
| `--prompt` | `v2` | Prompt version (`v1`, `v2`, …) |
| `--concurrency` | `1` | Run N targets in parallel |
| `--retries` | `0` | Retry a target from scratch if all attempts error |
| `--reasoning` | — | Reasoning effort for o-series models: `low` \| `medium` \| `high` \| `xhigh` |
| `--target-from` / `--target-to` | — | Limit to a target range (e.g. `1`–`25`) |
| `--resume` | — | Resume an existing run ID (skips completed targets) |

## How it Works

1. The model receives the target image + canvas size + colors as context
2. It generates an HTML/CSS solution (no JS, SVG, or external resources)
3. The solution is rendered in headless Chromium at the exact canvas size (Quirks Mode)
4. The render is pixel-diffed against the target using pixelmatch (threshold 0.01)
5. A score is calculated from pixel match rate and code length

## Scoring

Score formula (CSS Battle): `399.99725 × 0.9905144^charCount + 599.9987`

For imperfect matches the score is multiplied by `match³`:

| Match | Multiplier |
|-------|-----------|
| 100 % | 1.000× — full score |
| 99 %  | 0.970× |
| 95 %  | 0.857× |
| 80 %  | 0.512× |
| 50 %  | 0.125× |

Color accuracy matters far more than code brevity. Only 100 % pixel matches count as perfect.

## Project Structure

```
packages/
  core/        Renderer (Puppeteer) + Scorer (pixelmatch) + LLM adapters
  runner/      CLI benchmark orchestrator
  api/         Express REST API + SSE progress stream
  dashboard/   React + Vite dashboard (local + public build)
  db/          SQLite adapter (built-in node:sqlite) + Supabase sync
targets/
  images/      PNG reference images (battle + daily)
  definitions/ Target metadata (colors, dimensions)
baselines/
  human.json   Human expert top scores (reference baseline)
prompts/
  v1/          Original benchmark prompt
  v2/          Improved prompt (better color accuracy guidance)
scripts/
  migrate-runs.js         Migrate DB schema to latest version
  upload-results.js       Upload local SQLite results → Supabase
  download-results.js     Download results Supabase → local SQLite
  upload-targets.js       Seed battle/daily targets in Supabase
  sync-targets.js         Sync target definitions + images from Supabase
  recalculate-scores.js   Recompute match% + scores for all stored runs
```

## Supabase Sync

Results can be synced bidirectionally between local SQLite and Supabase via the **⇅ Sync** tab or CLI scripts:

```bash
npm run upload          # local SQLite → Supabase (runs + run_state)
npm run download        # Supabase → local SQLite
npm run upload-targets  # seed battle_targets / daily_targets in Supabase
node scripts/sync-targets.js  # sync targets + images from Supabase locally
```

Configure `SUPABASE_RESULTS_URL` and `SUPABASE_RESULTS_KEY` in `.env`. Run `packages/db/schema.sql` once in your Supabase project to set up the schema.

## Public Dashboard

A read-only public variant of the dashboard (Leaderboard, Targets, Insights, About) can be built and deployed as a static site — no server required, data is read directly from Supabase via the anon key.

```bash
cd packages/dashboard

# 1. Add credentials to .env.public.local (gitignored)
#    VITE_SUPABASE_URL=https://xxx.supabase.co
#    VITE_SUPABASE_ANON_KEY=eyJ...

# 2. Build
npm run build:public   # output → dist-public/
```

Deploy `dist-public/` to any static host (Netlify, GitHub Pages, etc.). Works on root paths and subfolders alike.

## Local API Development

```bash
cd packages/api
npm start   # node --env-file=../../.env server.js
```

## Running Tests

```bash
# Single file
node --test packages/db/adapters/sqlite/runs.test.js

# All tests
node --test packages/**/*.test.js
```
