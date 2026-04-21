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

## Run-System Refactor (work in progress)

The run orchestrator is being migrated from an in-memory queue + split `runs`/`run_state` schema to a single DB-backed attempt queue. Phase 1 (DB primitives) is complete; Phases 2–4 are open.

**Target behaviour when done:**

- Queue is persistent — restart the process and work continues. Every `(target, attempt)` combination is pre-inserted with status `waiting | pending | running | done | error | paused`.
- Attempt 2/3 only runs after attempt 1 finishes `done`. If attempt 1 ends in `error`, successors stay `waiting` — no automatic skip.
- Errors are non-terminal. A run stays visible in the queue with a **Retry** button per errored attempt plus **Reset all errors** per run, until every attempt is `done`.
- Pause/Resume is precise: the pre-pause status is stored per row and fully restored on resume; resumed runs are re-enqueued at the back of the queue.
- Dashboard splits into a **Queue** view (everything not-yet-done, with live attempt rows) and a **History** view (only fully-completed runs).

**Open work:**

- **Phase 2 — Runner & API**
  - Replace the in-process queue/worker pool in `packages/runner/benchmark.js` with DB-claim workers (`claimNextPending` → run → `completeAttempt` / `failAttempt`).
  - Keep the internal transient-error retry inside a claim; only promote to `status='error'` after it's exhausted.
  - API surface: `POST /api/runs/start`, `POST /api/runs/:runId/cancel` (now pauses), `POST /api/runs/:runId/resume`, `POST /api/runs/attempts/:id/retry`, `POST /api/runs/:runId/reset-errors`, `GET /api/runs/queue`, `GET /api/runs/history`. The unified `GET /api/runs` endpoint goes away.
  - Run `requeueStaleRunningAttempts` once on server start to recover from crashes.
- **Phase 3 — Dashboard**
  - New hooks `useRunQueue` / `useRunHistory`, old `useRuns` removed.
  - Run tab shows the queue as a table (per-attempt status badges incl. `waiting for prev. result`), with Retry / Reset-errors / Resume buttons.
  - Run History only shows `done` runs; the active-run dropdown is removed.
- **Phase 4 — Cleanup**
  - Leaderboard and insight views read from `attempt_results` (only `status='done'`) instead of raw `runs`.
  - Supabase sync only uploads `done` rows; queue state stays local. `run_state` sync removed.
  - Drop the legacy `saveAttempt` / `saveRunStart` / `saveRunEnd` shims and the `run_state` table.
  - Finalise [STATUS.md](STATUS.md) and this section.

Full design notes live in the plan file referenced from [STATUS.md](STATUS.md).

## Running Tests

```bash
# Single file
node --test packages/db/adapters/sqlite/runs.test.js

# All tests
node --test packages/**/*.test.js
```
