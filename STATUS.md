# Project Status

Last updated: 2026-04-12

## What's Done

### Core Pipeline
- [x] Benchmark runner (`packages/runner/`) — model → render → score → DB
- [x] Renderer (`packages/core/renderer.js`) — Puppeteer/Chromium, Quirks Mode
- [x] Scorer (`packages/core/scorer.js`) — pixelmatch threshold 0.01, CSS Battle formula
- [x] SQLite adapter (`packages/db/`) — runs, run_meta tables
- [x] LLM adapters — OpenRouter, OpenAI, Ollama (with AbortSignal support)
- [x] LLM error handling — API-level errors detected even on HTTP 200, empty response guard

### Parallelization & Resume
- [x] `--concurrency <n>` — run N targets in parallel (attempts per target stay sequential)
- [x] `--retries <n>` — retry a target from scratch if all attempts error
- [x] Run resume — `resumeRunId` skips already-completed targets from a prior run
- [x] Resume button in Run History — pre-fills model/provider, shows resume banner in Start Run
- [x] `getCompletedTargetIds` DB helper — returns completed target IDs for a given run
- [x] Bugfix: node:sqlite stores Numbers as REAL ("1.0") — normalised to integer string on read

### API
- [x] REST endpoints — results, runs, target images
- [x] `POST /api/runs/start` — kicks off benchmark async, returns runId; accepts concurrency, retries, resumeRunId
- [x] `DELETE /api/runs/:runId` — cancels via AbortController
- [x] `GET /api/runs/:runId/progress` — SSE stream with event replay
- [x] run_meta always written (on start, after each target, on cancel/done)

### Dashboard
- [x] Leaderboard — avg score, 100% rate, 100% count, avg cost, sortable
- [x] Run History — sortable table with all runs, Resume button
- [x] Target Grid — thumbnails, colors, best match per target
- [x] Target Detail — sticky code/preview/target layout, Quirks Mode iframe, solutions table
- [x] Start Run tab — model, provider, attempts, concurrency, retries, target range, cancel button
- [x] Target-grid progress view — live cards per target (pending/running/done/error/skipped)
  - Names visible immediately from start event
  - Pulsing dot on running cards
  - "Attempt N…" status text before first score arrives
  - Log lines prefixed with [targetId] for readable parallel output
- [x] Active run indicator (pulsing dot on tab)
- [x] Resume banner with Clear button

### Prompts
- [x] v1 — original prompt
- [x] v2 — improved color accuracy rules (≤2 per channel safe, match³ scoring explained)
  - Status: created, not yet used in benchmark runs

### Scripts
- [x] `scripts/recalculate-scores.js` — re-renders all stored runs with current scorer
- [x] `scripts/backfill-run-meta.js` — fills missing run_meta rows
- [x] Unified `runs` table — meta fields (prompt_version, temperature, etc.) denormalized into runs; `run_meta` table removed
- [x] Supabase DB adapter — `packages/db/adapters/supabase.js` fully implemented (results: runs table)
- [x] `scripts/migrate-runs.js` — migrates existing SQLite DB to unified schema
- [x] `scripts/upload-results.js` — batch-uploads local SQLite runs to Supabase

### Baselines
- [x] `baselines/human.json` — top1 scores for battle targets 1–12

## Next TODOs

- [ ] First git commit + push to remote  ← in progress
- [ ] Run benchmarks with v2 prompt, compare results vs v1
- [ ] Expand baselines/human.json beyond target 12

## Ideas / Backlog

- **Richer baselines** — scrape top 100 scores per target (top10avg, min, max, percentile bands) for more meaningful model comparison.
- **Daily targets** — code paths exist but untested end-to-end.
- **Linting + CI** — no ESLint or GitHub Actions yet.
