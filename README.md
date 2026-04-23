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

The easiest way is the **+ Run** tab in the dashboard — pick a model, provider, and hit Start. You can launch multiple runs in parallel, and the model field autocompletes previously used models filtered by the selected provider.

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

## OpenRouter Provider Forcing

You can force OpenRouter provider routing per model via a local config file:

```bash
cp config/openrouter.providers.example.json config/openrouter.providers.json
```

Default lookup path: `./config/openrouter.providers.json`  
Optional override: `OPENROUTER_PROVIDER_CONFIG_PATH=...`

Config shape:

```json
{
  "modelProviderOverrides": {
    "openai/gpt-5-mini": "openai",
    "moonshotai/*": "io.net",
    "anthropic/claude-3.7-sonnet": {
      "order": ["anthropic"],
      "allow_fallbacks": false
    }
  }
}
```

Rules:
- `"<provider>"` forces a single provider (`allow_fallbacks: false`).
- `["a", "b"]` sets provider order (`allow_fallbacks: false`).
- `{ ... }` passes a raw OpenRouter `provider` object through unchanged.
- `"vendor/*"` applies to all models with that prefix (for example `moonshotai/*`).
- Matching priority is: exact model > longest `vendor/*` prefix.

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
  upload-results.js       Upload local SQLite results → Supabase (done rows only)
  download-results.js     Download results Supabase → local SQLite
  upload-targets.js       Seed battle/daily targets in Supabase
  sync-targets.js         Sync target definitions + images from Supabase
  export-human-stats.js   Export compact human baseline stats from Supabase leaderboard rows
  recalculate-scores.js   Recompute match% + scores for all stored runs
```

## Supabase Sync

Results can be synced bidirectionally between local SQLite and Supabase via the **⇅ Sync** tab or CLI scripts:

```bash
npm run upload          # local SQLite → Supabase (only rows with status='done')
npm run download        # Supabase → local SQLite
npm run upload-targets  # seed battle_targets / daily_targets in Supabase
npm run sync            # sync targets + images from Supabase locally
npm run export-human-stats  # export baselines/human_stats.json from Supabase leaderboard rows
```

### Export Human Baseline Stats

Generate `baselines/human_stats.json` from a Supabase leaderboard relation:

```bash
npm run export-human-stats
```

Optional overrides:

```bash
node --env-file=.env scripts/export-human-stats.js \
  --source=battle_target_leaderboard_current_entries \
  --output=baselines/human_stats.json \
  --max-per-target=100
```

Queue state (pending / running / waiting / paused / error attempts) never
leaves the local process — only completed `done` rows are synced.

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

## Run System

The benchmark runner is built around a single table (`runs`) that doubles as
a persistent attempt queue. Every `(run_id, target_id, attempt)` combination
is pre-inserted before any work starts and moves through these statuses:

`waiting` → `pending` → `running` → `done` | `error` | `paused`

- **`waiting`** — follow-up attempt (n ≥ 2), blocked until the previous
  attempt for the same target finishes `done`.
- **`pending`** — claim-ready. A worker may pick it up.
- **`running`** — claimed by a worker; protected with a `claim_token` so a
  pause or re-claim can't be overwritten by a stale worker.
- **`done`** — complete. Only `done` rows appear in the leaderboard
  (grouped by `model + reasoning_effort + reasoning_max_tokens`),
  insights, the History view and the Supabase upload.
- **`error`** — non-terminal. The row stays visible in the Queue view with
  a Retry button per attempt, plus Reset-all-errors per run.
- **`paused`** — set by Cancel. The original status is saved in
  `paused_from` so Resume restores the row exactly.

A `runs_summary` view aggregates per-run status with priority
`paused > running > error > queued > done` and powers the Queue / History
split in the dashboard.

Workers claim the next `pending` row atomically with `BEGIN IMMEDIATE` +
`UPDATE ... RETURNING`. Ordering is FIFO over `(enqueued_at, id)` across
all runs, so a resumed run re-enters at the back of the queue. Each active
worker pool is run-scoped and only claims rows for its own `run_id`.

On server startup, any leftover `running` rows (from a crashed process)
are flipped back to `pending` and their claim tokens are cleared.

**API surface**

- `POST /api/runs/start` — new run or fill-run. Pre-enqueues all attempts.
- `POST /api/runs/:runId/cancel` — pauses the run (abort + `paused_from`).
- `POST /api/runs/:runId/resume` — restores the pre-pause state and bumps
  `enqueued_at` to now; accepts optional JSON body `{ "concurrency": <n> }`.
- `POST /api/runs/attempts/:id/retry` — single `error` → `pending`.
- `POST /api/runs/:runId/reset-errors` — bulk `error` → `pending`.
- `GET /api/runs/queue` — everything not-yet-done, with attempts nested.
- `GET /api/runs/history` — done-only runs, newest finish first.
- `GET /api/runs/:runId/progress` — SSE, used by the Run tab.

Queue state is local to each runner process — only `done` rows are ever
synced to Supabase.

## Running Tests

```bash
# Single file
node --test packages/db/adapters/sqlite/runs.test.js

# All tests
node --test packages/**/*.test.js
```
