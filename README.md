# ClawBattle
**AI CSS Battle Benchmark**

Measures how well LLMs can reproduce pixel-perfect CSS targets from [CSS Battle](https://cssbattle.dev). Run multiple models against the same targets and compare scores, match rates, and cost on the dashboard.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop) (running, Linux containers mode)
- API key for at least one provider (OpenRouter, OpenAI, or Ollama)

## Quick Start

```bash
cp .env.example .env
# Add your API key(s) to .env

npm run dev
```

Open `http://localhost:5173` for the dashboard.

## Running a Benchmark

The easiest way is the **+ Run** tab in the dashboard — pick a model, provider, and hit Start.

Alternatively via CLI:

```bash
docker compose run runner \
  --model openai/gpt-4o \
  --provider openrouter \
  --attempts 3
```

CLI options:

| Flag | Default | Description |
|------|---------|-------------|
| `--model` | — | Model ID (required), e.g. `openai/gpt-4o` |
| `--provider` | `openrouter` | `openrouter` \| `openai` \| `ollama` |
| `--targets` | `battle` | `battle` \| `daily` |
| `--target-id` | — | Run a single target by ID |
| `--attempts` | `3` | Attempts per target (best score counts) |
| `--prompt` | `v1`* | Prompt version (`v1`, `v2`, …) |
| `--concurrency` | `1` | Run N targets in parallel |
| `--retries` | `0` | Retry a target if all attempts error |
| `--reasoning` | — | Reasoning effort for o-series models: `low` \| `medium` \| `high` |

*Set `PROMPT_VERSION=v2` in `.env` to change the default.

Resume and target-range controls are available in the dashboard (+ Run tab).

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

Color accuracy matters far more than code length. Only 100 % pixel matches count as perfect.

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
npm run sync            # sync targets + images from Supabase locally
```

Configure `SUPABASE_RESULTS_URL` and `SUPABASE_RESULTS_KEY` in `.env`. Run `packages/db/schema.sql` once in your Supabase project to set up the schema.

## Public Dashboard

A read-only public variant (Leaderboard, Targets, Insights, About) is automatically built and deployed to **GitHub Pages** on every version tag (`v*.*.*`).

To trigger a deployment, push a tag:

```bash
git tag v1.0.0
git push --tags
```

Required GitHub Secrets: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
GitHub Pages source must be set to **GitHub Actions** (repo Settings → Pages).

To build locally:

```bash
cd packages/dashboard
# Add to .env.public.local:
#   VITE_SUPABASE_URL=https://xxx.supabase.co
#   VITE_SUPABASE_ANON_KEY=eyJ...
npm run build:public   # output → dist-public/
```

## Running Tests

```bash
# Single file
node --test packages/db/adapters/sqlite/runs.test.js

# All tests
node --test packages/**/*.test.js
```
