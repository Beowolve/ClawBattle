# Project Status

Last updated: 2026-04-21

## What's Done

### Core Pipeline
- [x] Benchmark runner (`packages/runner/`) — model → render → score → DB
- [x] Renderer (`packages/core/renderer.js`) — Puppeteer/Chromium, Quirks Mode
- [x] Renderer lifecycle hardened — launch race fixed, browser ownership moved to process entrypoints, no per-run global browser shutdown
- [x] Renderer lifecycle tests — concurrent launch, disconnect recovery, and parallel render integration coverage
- [x] Scorer (`packages/core/scorer.js`) — pixelmatch threshold 0.01, CSS Battle formula
- [x] SQLite adapter (`packages/db/`) — single `runs` table, acts as both attempt-log and persistent queue
- [x] LLM adapters — OpenRouter, OpenAI, Ollama (with AbortSignal support)
- [x] LLM error handling — API-level errors detected even on HTTP 200, empty response guard
- [x] Code safety guard — generated HTML/CSS is sanitized; JS, SVG, and external resources are rejected before render/score
- [x] Scorer API naming cleanup — `score()` renamed to `computeMatch()`; score math remains in `computeScore()`
- [x] Sanitizer blocks disallowed URL schemes (`data|blob|file|ftp`) across `src`/`href`, `srcset`, `url(...)`, and `@import`

### Parallelization & Resume
- [x] `--concurrency <n>` — run N targets in parallel (attempts per target stay sequential)
- [x] `--retries <n>` — retry a target from scratch if all attempts error
- [x] Run resume — `resumeRunId` skips already-completed targets from a prior run
- [x] Fill mode — new run fills only missing attempts per (model, prompt_version, reasoning_effort, target) up to the configured attempts; seeds follow-up context by re-rendering the last stored attempt's code
- [x] Fast cancel — `render()` and adapter `generate()` are raced against the abort signal; worker queue is drained on abort; Ollama adapter now forwards the signal. Cancel returns control within ~500ms instead of waiting for the current attempt
- [x] Resume button in Run History — pre-fills model/provider, shows resume banner in Start Run
- [x] `getCompletedTargetIds` DB helper — returns completed target IDs for a given run
- [x] Bugfix: node:sqlite stores Numbers as REAL ("1.0") — normalised to integer string on read

### API
- [x] REST endpoints — results, queue, history, target images
- [x] `POST /api/runs/start` — kicks off benchmark async, returns runId; accepts concurrency, retries, resumeRunId, fillMode, targetFrom/To, reasoningEffort
- [x] `POST /api/runs/:runId/cancel` — aborts the run and pauses the queue (`{ cancelled, paused }`)
- [x] `POST /api/runs/:runId/resume` — restores the pre-pause state (`paused_from`) and bumps `enqueued_at`
- [x] `POST /api/runs/attempts/:id/retry` — single `error` → `pending`
- [x] `POST /api/runs/:runId/reset-errors` — bulk `error` → `pending` per run
- [x] `GET /api/runs/queue` — all non-done runs, attempts nested
- [x] `GET /api/runs/history` — done-only runs, newest finish first
- [x] `GET /api/runs/:runId/progress` — SSE stream with event replay

### Dashboard
- [x] Leaderboard — avg score, 100% rate, 100% count, avg cost, sortable
- [x] Run tab — live queue with per-attempt status badges (waiting/pending/running/paused/error/done), Retry + Reset-errors + Resume buttons
- [x] Run History — clickable list of completed runs only; click filters the attempt table
- [x] Target Grid — thumbnails, colors, best match per target
- [x] Target Detail — sticky code/preview/target layout, Quirks Mode iframe, solutions table
- [x] Start Run tab — model, provider, attempts, concurrency, retries, target range, Fill toggle, cancel button
- [x] Leaderboard delete flow targets a single leaderboard entry (`model + reasoning_effort`) and can limit deletion to selected prompt versions
- [x] Target-grid progress view — live cards per target (pending/running/done/error/skipped)
  - Names visible immediately from start event
  - Pulsing dot on running cards
  - "Attempt N…" status text before first score arrives
  - Log lines prefixed with [targetId] for readable parallel output
- [x] Active run indicator (pulsing dot on tab)
- [x] Resume banner with Clear button
- [x] About box "How it works" now states that attempts 2-3 include previous render + previous code as follow-up context
- [x] About box "Prompt" now shows both the selected base prompt (attempt 1) and the shared follow-up appendix (attempts 2-3)
- [x] Scoring wording now consistently uses "code length" (About + README) instead of "brevity"
- [x] About intro now explicitly states the benchmark also aims for short solutions
- [x] Start Run log now shows policy violations as "attempt rejected by policy" with structured error typing

### Prompts
- [x] v1 — original prompt
- [x] v2 — improved color accuracy rules (≤2 per channel safe, match³ scoring explained)
  - Status: created, not yet used in benchmark runs

### Scripts
- [x] `scripts/recalculate-scores.js` — re-renders all stored runs with current scorer
- [x] `scripts/upload-results.js` — uploads done-only runs to Supabase (queue state stays local)
- [x] `scripts/download-results.js` — downloads runs from Supabase into local SQLite
- [x] `scripts/upload-targets.js` — seeds battle_targets / daily_targets in Supabase
- [x] `scripts/sync-targets.js` — syncs targets + images from Supabase into local SQLite
- [x] Supabase DB adapter — `packages/db/adapters/supabase.js` (read-only for the public dashboard; writes are local-only by design)
- [x] Supabase schema (`packages/db/schema.sql`) — idempotent, RLS, `run_state` dropped
- [x] Bidirectional sync UI (Sync tab) — Upload Targets, Upload Results, Download from Supabase
- [x] Persistent DB-backed attempt queue — one row per `(run_id, target_id, attempt)` with status `waiting | pending | running | done | error | paused`; survives process restarts, `runs_summary` view aggregates per-run status
- [x] localStorage persistence for active runId + mount reconnect via `GET /api/runs/active`
- [x] Public dashboard mode — `VITE_PUBLIC_MODE=true` builds a read-only variant (Leaderboard/Targets/Insights only, no delete buttons, data fetched from Supabase via anon key)

### Baselines
- [x] `baselines/human.json` — top1 scores for battle targets 1–12

## Next TODOs

- [x] First git commit + push to remote
- [x] Run benchmarks with v2 prompt, compare results vs v1
- [ ] Expand baselines/human.json beyond target 12
- [ ] Compare benchmark results against the human baseline (`baselines/human.json`)

### Run-System (DB-backed queue, single `runs` table)

The runner is built around a single SQLite table that doubles as a
persistent attempt queue. The README has the user-facing summary; this
section captures the design invariants that tests and future work depend
on.

**Schema (one row per `(run_id, target_id, attempt)`):**

- `status` ∈ `waiting | pending | running | done | error | paused`
- `claim_token` + `claimed_at` — atomic claim protection; any abort/pause
  invalidates the token so a stale worker can't overwrite a restored row
- `enqueued_at` — FIFO ordering key (resumed runs are re-enqueued at `now()`)
- `paused_from` — original status captured when the user pauses, so
  resume restores `pending`/`waiting`/`error` exactly
- `error_message` — set on the final (after internal-retry) failure
- Unique index on `(run_id, target_id, attempt)`; partial queue index on
  `(status, enqueued_at, id)` for non-done statuses

**Views:**

- `attempt_results` = `SELECT * FROM runs WHERE status = 'done'` — the
  single source of truth for leaderboard, insights, history, REST
  `/results`, and Supabase upload
- `runs_summary` — one row per `run_id` with aggregated status
  (priority `paused > running > error > queued > done`), total/done/
  pending/waiting/running/paused/error counts, and run-level metadata
  (model, provider, prompt_version, reasoning_effort, started_at,
  finished_at)

**Core DB API** (`packages/db/adapters/sqlite/queue.js`):

- `enqueueRun` — pre-inserts attempt 1 as `pending`, 2..N as `waiting`
- `claimNextPending` — `BEGIN IMMEDIATE` + `UPDATE ... RETURNING`; claims
  the oldest `pending` row and stamps a fresh `claim_token`
- `completeAttempt` / `failAttempt` — token-protected finalization;
  `complete` promotes the next `waiting` attempt of the same target
- `retryAttempt` / `resetErrors` — manual error recovery, single or bulk
- `pauseRun` / `resumeRun` — precise pause with `paused_from`, precise
  restore
- `requeueStaleRunningAttempts` — one-shot startup recovery for crashed
  processes (`running` → `pending`, token cleared)
- `getRunQueue` / `getRunHistory` — the two dashboard reads

**Runner** (`packages/runner/benchmark.js`):

- No in-process queue array. `enqueueRun` pre-inserts all attempts, then
  a pool of `workerLoop` workers claim rows atomically from the DB.
- Follow-up context (attempts 2+) comes from the previous `done` row of
  the same `(run_id, target_id)`.
- Resume skips already-completed targets (reuses `resumeRunId`).
- Fill mode seeds `done` rows with the prior attempt's `lastCode`, then
  flips the target attempt from `waiting` → `pending`.
- `processClaim` does a short internal retry for transient adapter
  errors (default 2, 300ms backoff). `AbortError` and
  `PolicyViolationError` bypass the retry.

**API** — endpoints listed in the API section above. `POST /cancel`
always pauses (abort + `pauseRun`); `POST /resume` is the only way a
run returns to the queue with the same `run_id`.

**Sync** — Supabase only stores `done` rows. `uploadToSupabase` filters
to `status='done'` and strips the queue-only columns (`status`,
`claim_token`, `enqueued_at`, `claimed_at`, `paused_from`,
`error_message`) before upload. `downloadFromSupabase` round-trips them
back in with `status='done'` as the column default.

**Dashboard** — React Query hooks `useRunQueue` (2s refetch) and
`useRunHistory`. The Run tab renders the queue with per-attempt status
badges, Retry / Reset-errors / Resume buttons. The History tab lists
only done runs; clicking a row filters the attempt table below.

Full original design notes live in
`C:\Users\Andy\.claude\plans\berlege-dir-eine-vereinfachung-luminous-nebula.md`.

## Ideas / Backlog

- **Richer baselines** — scrape top 100 scores per target (top10avg, min, max, percentile bands) for more meaningful model comparison.
- **Daily targets** — code paths exist but untested end-to-end.
- **Linting + CI** — no ESLint or GitHub Actions yet.
