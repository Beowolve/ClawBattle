# Project Status

Last updated: 2026-04-23

## What's Done

### Core Pipeline
- [x] Benchmark runner (`packages/runner/`) — model → render → score → DB
- [x] Renderer (`packages/core/renderer.js`) — Puppeteer/Chromium, Quirks Mode; hardened launch (no launch race), browser ownership held by the process entrypoints (no per-run global shutdown), survives disconnect
- [x] Renderer integration tests — concurrent launch, disconnect recovery, parallel render coverage
- [x] Scorer (`packages/core/scorer.js`) — pixelmatch threshold 0.01, CSS Battle formula; `computeMatch()` for match %, `computeScore()` for the scoring math
- [x] SQLite adapter (`packages/db/`) — single `runs` table, acts as both attempt-log and persistent queue; uses Node 22's `node:sqlite`
- [x] LLM adapters — OpenRouter, OpenAI, Ollama (all with AbortSignal support)
- [x] OpenRouter provider routing overrides — model-specific provider forcing via local JSON config (`config/openrouter.providers.json` or `OPENROUTER_PROVIDER_CONFIG_PATH`)
- [x] Reasoning-token cap — optional `reasoningMaxTokens` limits thinking-budget tokens via OpenRouter's unified `reasoning` parameter (applies to any reasoning model, e.g. Kimi K2, o-series); persisted per-row so resumes honour it
- [x] LLM error handling — API-level errors detected even on HTTP 200, empty-response guard
- [x] Code safety guard — generated HTML/CSS is sanitized; JS, SVG, external resources, and disallowed URL schemes (`data|blob|file|ftp`) rejected across `src`/`href`, `srcset`, `url(...)`, `@import` before render/score

### Parallelization & Resume
- [x] `--concurrency <n>` — run N targets in parallel (attempts per target stay sequential)
- [x] `--retries <n>` — retry a target from scratch if all attempts error
- [x] Run resume — `resumeRunId` skips already-completed targets from a prior run
- [x] Fill mode — new run fills only missing attempts per (model, prompt_version, reasoning_effort, target) up to the configured attempts; seeds follow-up context by re-rendering the last stored attempt's code
- [x] Fast cancel — `render()` and adapter `generate()` are raced against the abort signal; worker queue is drained on abort; cancel returns control within ~500ms instead of waiting for the current attempt
- [x] Unified Resume — works on any non-done run with outstanding work (paused, credits-out, or server-restart recovery); re-kicks the worker pool against existing DB rows without re-enqueueing targets; endpoint guards against double-start via `isJobActive`
- [x] Run-scoped workers — benchmark/resume workers only claim `pending` rows of their own `run_id` (no cross-run queue stealing)
- [x] In-queue Cancel button — cancels any run whose worker pool is live; aborts in-flight calls and pauses remaining rows
- [x] In-queue Resume concurrency — each queued run can be resumed with a user-selected worker-thread count from the Queue UI
- [x] Authoritative run-activity signal — `/api/runs/queue` exposes `worker_active` per run (derived from the in-memory job registry), so the dashboard shows correct Resume/Cancel controls even when DB status and worker state diverge (crash, orphaned rows)
- [x] Startup recovery — stale `running` rows left over from a crashed process are requeued to `pending` on server start, with claim tokens invalidated

### API
- [x] REST endpoints — results, queue, history, target images
- [x] `POST /api/runs/start` — kicks off benchmark async, returns runId; accepts concurrency, retries, resumeRunId, fillMode, targetFrom/To, reasoningEffort; logs run metadata on start
- [x] `POST /api/runs/:runId/cancel` — aborts the run and pauses the queue (`{ cancelled, paused }`)
- [x] `POST /api/runs/:runId/resume` — unified resume for paused and orphaned runs, with configurable resume concurrency
- [x] `POST /api/runs/attempts/:id/retry` — single `error` → `pending`
- [x] `POST /api/runs/:runId/reset-errors` — bulk `error` → `pending` per run
- [x] `DELETE /api/runs/:runId` — removes all attempt rows for a run (aborts live workers first); `DELETE /api/runs/attempts/:id` — removes a single attempt row
- [x] `GET /api/runs/queue` — all non-done runs, attempts nested, `worker_active` flag included
- [x] `GET /api/runs/history` — done-only runs, newest finish first
- [x] `GET /api/runs/:runId/progress` — SSE stream with event replay
- [x] Per-attempt logging — server logs `attempt_start`, completion, and error events with `[targetId]` prefix

### Dashboard
- [x] Leaderboard — avg score, 100% rate, 100% count, avg cost, sortable
- [x] Run tab — live queue with per-attempt status badges (waiting/pending/running/paused/error/done); Resume, Cancel, Retry, Reset-errors, Delete-run, and per-attempt Delete buttons (with confirmation)
- [x] Run Queue sorting — target numbers sorted numerically
- [x] Run History — clickable list of completed runs only; click filters the attempt table
- [x] Target Grid — thumbnails, colors, best match per target
- [x] Target Detail — sticky code/preview/target layout, Quirks Mode iframe, solutions table
- [x] Start Run tab — model, provider, reasoning effort + max-tokens, attempts, concurrency, retries, target range, Fill toggle, cancel button; supports launching multiple runs in parallel and provider-scoped model autocomplete from existing runs
- [x] Leaderboard delete flow — targets a single leaderboard entry (`model + reasoning_effort + reasoning_max_tokens`) and can limit deletion to selected prompt versions
- [x] Active run indicator (pulsing dot on tab)
- [x] Resume banner with Clear button
- [x] About box "How it works" states that attempts 2-3 include previous render + previous code as follow-up context
- [x] About box "Prompt" shows both the selected base prompt (attempt 1) and the shared follow-up appendix (attempts 2-3)
- [x] Scoring wording consistently uses "code length" (About + README) and the About intro states the benchmark also aims for short solutions
- [x] Start Run log shows policy violations as "attempt rejected by policy" with structured error typing

### Prompts
- [x] v1 — original prompt
- [x] v2 — improved color accuracy rules (≤2 per channel safe, match³ scoring explained)

### Scripts
- [x] `scripts/recalculate-scores.js` — re-renders all stored runs with current scorer
- [x] `scripts/upload-results.js` — uploads done-only runs to Supabase (queue state stays local)
- [x] `scripts/download-results.js` — downloads runs from Supabase into local SQLite
- [x] `scripts/upload-targets.js` — seeds battle_targets / daily_targets in Supabase
- [x] `scripts/sync-targets.js` — syncs targets + images from Supabase into local SQLite
- [x] `scripts/export-human-stats.js` — exports compact `baselines/human_stats.json` from Supabase target leaderboard rows (`top1`, `top10Avg`, `p50`, `p90`, each as score+charCount pairs)
- [x] Supabase DB adapter — `packages/db/adapters/supabase.js` (read-only for the public dashboard; writes are local-only by design)
- [x] Supabase schema (`packages/db/schema.sql`) — idempotent, RLS, `run_state` dropped
- [x] Bidirectional sync UI (Sync tab) — Upload Targets, Upload Results, Download from Supabase
- [x] Persistent DB-backed attempt queue — one row per `(run_id, target_id, attempt)` with status `waiting | pending | running | done | error | paused`; survives process restarts, `runs_summary` view aggregates per-run status
- [x] localStorage persistence for active run IDs + mount reconnect via `GET /api/runs/active`
- [x] Public dashboard mode — `VITE_PUBLIC_MODE=true` builds a read-only variant (Leaderboard/Targets/Insights only, no delete buttons, data fetched from Supabase via anon key)

### Baselines
- [x] `baselines/human.json` — top1 scores for battle targets 1–12
- [x] `baselines/human_stats.json` — enriched per-target human leaderboard stats from scraped Supabase data (`n`, `top1`, `top10Avg`, `p50`, `p90` with score+charCount pairs)

## Backlog / TODOs

- [ ] Compare benchmark results against the enriched human baseline (`baselines/human_stats.json`)
- [ ] Daily targets — code paths exist but untested end-to-end.
- [ ] Linting + CI — no ESLint or GitHub Actions yet.

## Architecture Notes

### Run-System (DB-backed queue, single `runs` table)

The runner is built around a single SQLite table (`runs`) that doubles as a
persistent attempt queue. One row per `(run_id, target_id, attempt)`.

**Schema columns of note:**

- `status` ∈ `waiting | pending | running | done | error | paused`
- `claim_token` + `claimed_at` — atomic claim protection; pause/abort
  invalidates the token so a stale worker cannot overwrite a restored row
- `enqueued_at` — FIFO ordering key; resumed runs are re-enqueued at `now()`
- `paused_from` — original status saved on pause so resume restores it exactly
- `error_message` — set on the final failure (after internal retries exhausted)
- Unique index on `(run_id, target_id, attempt)`; partial queue index on
  `(status, enqueued_at, id)` covering non-done statuses

**Views (`packages/db/adapters/sqlite/connection.js`):**

- `attempt_results` — `SELECT * FROM runs WHERE status = 'done'`; single
  source of truth for leaderboard, insights, history, and Supabase upload
- `runs_summary` — one row per `run_id`; aggregated status with priority
  `paused > running > error > queued > done`; counts per status; run-level
  metadata (model, provider, prompt_version, reasoning_effort, started_at,
  finished_at)

**Core DB API (`packages/db/adapters/sqlite/queue.js`):**

- `enqueueRun` — pre-inserts attempt 1 as `pending`, attempts 2..N as `waiting`
- `claimNextPending` — `BEGIN IMMEDIATE` + `UPDATE ... RETURNING`; claims the
  oldest `pending` row and stamps a fresh `claim_token`
- `completeAttempt` / `failAttempt` — token-protected finalization; `complete`
  promotes the next `waiting` attempt of the same target to `pending`
- `retryAttempt` / `resetErrors` — manual error recovery, single or bulk
- `pauseRun` / `resumeRun` — saves `paused_from` on pause; restores exact
  prior status on resume and bumps `enqueued_at` to re-enter the queue fairly
- `hasRunPendingWork` — reports whether a run has outstanding rows
  (`pending|waiting|running`); used by Resume to distinguish stuck runs
  from truly idle ones
- `requeueStaleRunningAttempts` — startup recovery: `running` → `pending`,
  claim token cleared
- `getRunQueue` / `getRunHistory` — queue (non-done, target-id numeric sort)
  and history (done-only)

**Runner (`packages/runner/benchmark.js`):**

- No in-process queue array; `enqueueRun` pre-inserts all attempts, then a
  pool of `workerLoop` workers claim rows atomically from the DB
- `resumeWorkers` entrypoint re-kicks the pool against existing DB rows
  without touching `enqueueRun`, so resumes never expand the target set
- `workerLoop.hasMoreWork` only counts `pending`/`running` (not `waiting`),
  so orphaned waiting rows after errors don't keep workers spinning
- Follow-up context (attempts 2+) is loaded from the previous `done` row of
  the same `(run_id, target_id)`
- `processClaim` does a short internal retry for transient errors (default 2,
  300 ms backoff); `AbortError` and `PolicyViolationError` bypass the retry
- Progress events (`attempt_start`, `attempt`, `attempt_error`, `target_done`)
  flow through a shared `createProgressShim` so CLI logs and SSE stay in sync

**In-memory job registry (`packages/api/jobs.js`):**

- Tracks which run IDs have a live worker pool in this process
- `isJobActive(runId)` is surfaced via `worker_active` on `/api/runs/queue`
  so the dashboard reflects true worker state, independent of DB row status
