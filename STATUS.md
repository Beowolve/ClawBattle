# Project Status

Last updated: 2026-04-20

## What's Done

### Core Pipeline
- [x] Benchmark runner (`packages/runner/`) — model → render → score → DB
- [x] Renderer (`packages/core/renderer.js`) — Puppeteer/Chromium, Quirks Mode
- [x] Renderer lifecycle hardened — launch race fixed, browser ownership moved to process entrypoints, no per-run global browser shutdown
- [x] Renderer lifecycle tests — concurrent launch, disconnect recovery, and parallel render integration coverage
- [x] Scorer (`packages/core/scorer.js`) — pixelmatch threshold 0.01, CSS Battle formula
- [x] SQLite adapter (`packages/db/`) — runs, run_meta tables
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
- [x] REST endpoints — results, runs, target images
- [x] `POST /api/runs/start` — kicks off benchmark async, returns runId; accepts concurrency, retries, resumeRunId
- [x] `POST /api/runs/:runId/cancel` — cancels via AbortController
- [x] `DELETE /api/runs/:runId` — deletes an empty run (no attempts saved); rejects when run is still running or has attempts
- [x] `GET /api/runs/:runId/progress` — SSE stream with event replay
- [x] run_meta always written (on start, after each target, on cancel/done)

### Dashboard
- [x] Leaderboard — avg score, 100% rate, 100% count, avg cost, sortable
- [x] Run History — sortable table with all runs, Resume button
- [x] Target Grid — thumbnails, colors, best match per target
- [x] Target Detail — sticky code/preview/target layout, Quirks Mode iframe, solutions table
- [x] Start Run tab — model, provider, attempts, concurrency, retries, target range, Fill toggle, cancel button
- [x] Run History — Delete button for empty runs (no attempts saved)
- [x] Leaderboard delete flow now targets a single leaderboard entry (`model + reasoning_effort`) and can limit deletion to selected prompt versions
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
- [x] `scripts/backfill-run-meta.js` — fills missing run_meta rows
- [x] Unified `runs` table — meta fields (prompt_version, temperature, etc.) denormalized into runs; `run_meta` table removed
- [x] Supabase DB adapter — `packages/db/adapters/supabase.js` fully implemented (results: runs table)
- [x] `scripts/migrate-runs.js` — migrates existing SQLite DB to unified schema
- [x] `scripts/upload-results.js` — batch-uploads local SQLite runs to Supabase
- [x] `scripts/download-results.js` — downloads runs from Supabase into local SQLite
- [x] `scripts/upload-targets.js` — seeds battle_targets / daily_targets in Supabase
- [x] `scripts/sync-targets.js` — syncs targets + images from Supabase into local SQLite
- [x] Supabase schema (`packages/db/schema.sql`) — idempotent, RLS, run_state table
- [x] Bidirectional sync UI (Sync tab) — Upload Targets, Upload Results, Download from Supabase
- [x] Run lifecycle tracking — `run_state` table, `saveRunStart` / `saveRunEnd`; run visible in history immediately after start
- [x] Run statuses: `running` | `done` | `incomplete` | `cancelled` | `error`; ⏳/⚠️ indicators in Run History
- [x] localStorage persistence for active runId + mount reconnect via `GET /api/runs/active`
- [x] Public dashboard mode — `VITE_PUBLIC_MODE=true` builds a read-only variant (Leaderboard/Targets/Insights only, no delete buttons, data fetched from Supabase via anon key)

### Baselines
- [x] `baselines/human.json` — top1 scores for battle targets 1–12

## Next TODOs

- [x] First git commit + push to remote
- [x] Run benchmarks with v2 prompt, compare results vs v1
- [ ] Expand baselines/human.json beyond target 12
- [ ] Compare benchmark results against the human baseline (`baselines/human.json`)

### Run-System-Refactor (DB-Queue, eine Tabelle)

Plan: `C:\Users\Andy\.claude\plans\berlege-dir-eine-vereinfachung-luminous-nebula.md`

Phase 1 — DB-Grundlage:
- [x] 1.1 Schema-Migration (status, error_message, enqueued_at, claimed_at, claim_token, paused_from; match nullable; idx_runs_queue)
- [x] 1.2 Views runs_summary + attempt_results (Status-Priorität paused > running > error > queued > done)
- [x] 1.3 enqueueRun (Pre-Insert pending/waiting, idempotent via INSERT OR IGNORE)
- [x] 1.4 claimNextPending (atomic FIFO claim via BEGIN IMMEDIATE + UPDATE...RETURNING, unique claim_token per call)
- [x] 1.5 completeAttempt / failAttempt (claim_token-protected; complete promotes next waiting→pending, fail leaves successors on waiting)
- [x] 1.6 retryAttempt / resetErrors (single error→pending; bulk reset scoped by runId or global, clears error/claim fields)
- [x] 1.7 pauseRun / resumeRun (pause wipes partial results + claim fields, stores original status in paused_from; resume restores exactly and bumps enqueued_at)
- [x] 1.8 requeueStaleRunningAttempts (server-restart recovery: running → pending, claim fields cleared, stale tokens invalidated)
- [x] 1.9 getRunQueue / getRunHistory (queue returns non-done runs with attempts[] nested; history returns done-only summaries, newest first)

Phase 1 komplett (109 DB-Tests grün).

Phase 2 — Runner & API:
- [x] 2.1 Runner-Worker auf DB-Queue umstellen (claim → run → complete/fail; kein lokales queue-Array mehr; Follow-up-Kontext aus Attempt n-1 mit status='done')
  - [x] 2.1a `getPreviousAttempt(db, runId, targetId, attempt)` — DB-Helper für Follow-up-Kontext
  - [x] 2.1b `processClaim()` — Orchestrierung: Prompt → Adapter → Render → Score → complete/fail
  - [x] 2.1c `workerLoop(db, deps, signal)` — claim + process im Kreis; emittiert `target_done` wenn letzter offener Attempt eines Targets abschließt
  - [x] 2.1d `runBenchmark` verdrahten: `enqueueRun` + Worker-Pool; Resume skippt completed Targets, Fill pre-seedet `done`-Rows mit `lastCode` auf Attempt `startAttempt-1`
- [x] 2.2 Interner Worker-Retry innerhalb eines Claims (transient Netz-/Rate-Fehler); endgültiger Fehler → status='error' + error_message — `processClaim` retried `adapter.generate` bis zu `internalRetries` mal (Default 2, 300ms Backoff); `AbortError` und `PolicyViolationError` umgehen den Retry
- [x] 2.3 API Queue/History splitten — `GET /api/runs/queue`, `GET /api/runs/history`, `POST /api/runs/:runId/resume`, `POST /api/runs/attempts/:id/retry`, `POST /api/runs/:runId/reset-errors` via `packages/api/routes/runs-queue.js` (8 HTTP-Tests grün); altes `GET /api/runs` bleibt vorerst als deprecated Alias bis UI-Migration in Phase 3, finale Entfernung in Phase 4
- [x] 2.4 Cancel-Endpoint auf Pause umstellen — `POST /api/runs/:runId/cancel` bricht AbortController ab **und** ruft `pauseRun`, Response: `{ cancelled, paused }`
- [x] 2.5 Startup-Recovery verdrahten — `requeueStaleRunningAttempts` läuft beim API-Start; geloggt falls > 0 Rows requeued

Phase 3 — UI:
- [x] 3.1 React-Query-Hooks `useRunQueue` / `useRunHistory` angelegt (useData.js); `useRuns` bleibt als deprecated alias bis 3.5
- [x] 3.2 Queue-Tabelle im Run-Tab — `RunQueue.jsx` zeigt alle nicht-`done` Runs mit nested Attempts, pollt alle 2s via `useRunQueue`; Status-Badges für `pending`/`waiting`/`running`/`paused`/`error`/`queued`/`done` inkl. pulsierender Dot auf `running` und `waiting` als "waiting for prev. result"
- [ ] 3.3 Retry-Button pro `error`-Zeile + "Alle Fehler zurücksetzen"-Button pro Run
- [ ] 3.4 Resume-Button für `paused`-Runs (ersetzt bestehenden Resume-Pfad per neuer run_id)
- [ ] 3.5 History-Ansicht auf nur `done` umstellen; Run-Dropdown entfernen

Phase 4 — Cleanup:
- [ ] 4.1 Leaderboard + Insight-Views (`leaderboard`, `leaderboard_by_version`, `target_difficulty`, `model_consistency`, `cost_efficiency`, `match_distribution`) auf `attempt_results` umstellen statt roher `runs`
- [ ] 4.2 Sync-Policy: nur `status='done'` syncen; `run_state`-Sync aus `packages/db/sync.js` entfernen
- [ ] 4.3 Alte Shims entfernen (`saveAttempt`, `saveRunStart`, `saveRunEnd`); `run_state`-Tabelle droppen
- [ ] 4.4 STATUS.md + README.md finalisieren (Refactor-Abschnitt durch Ist-Zustand ersetzen)

## Ideas / Backlog

- **Richer baselines** — scrape top 100 scores per target (top10avg, min, max, percentile bands) for more meaningful model comparison.
- **Daily targets** — code paths exist but untested end-to-end.
- **Linting + CI** — no ESLint or GitHub Actions yet.
