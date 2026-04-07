# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session Continuity

**Always keep `STATUS.md` up to date.** After completing a TODO item, mark it done. When a new idea comes up that won't be implemented immediately, add it to the Backlog section. Update the "Last updated" date. This ensures any session can be picked up without losing context.

## Overview

ClawBattle is an AI CSS Battle Benchmark — it measures how well LLMs can reproduce pixel-perfect CSS targets. The project is a Docker-based monorepo. A root-level `package.json` exists only for convenience scripts (`npm run sync`, `npm test`); each package has its own `package.json`.

## Running the Project

```bash
# Start API (port 3000) and Dashboard (port 5173)
docker compose up api dashboard

# Run a benchmark (all options shown)
docker compose run runner node cli.js \
  --model openai/gpt-4o \
  --provider openrouter \   # openrouter | openai | ollama
  --targets battle \
  --attempts 3 \
  --concurrency 3 \         # run N targets in parallel (default 1 = sequential)
  --retries 1 \             # retry target from scratch if all attempts error (default 0)
  --prompt v1
```

Copy `.env.example` to `.env` and fill in the required API keys before running.

## Architecture

The project lives in `packages/`:

| Package | Role |
|---------|------|
| `core/` | Rendering engine (Puppeteer) and pixel scorer (pixelmatch) |
| `runner/` | CLI benchmark orchestrator — wires LLM → render → score → DB |
| `api/` | Express REST server — results, runs, SSE progress stream, target images |
| `dashboard/` | React + Vite frontend — leaderboard, run history, target grid + detail view, start/cancel runs |
| `db/` | Database adapters — SQLite is implemented; Supabase is a stub |

### Benchmark Flow

1. `runner/cli.js` parses args and calls `benchmark.js`
2. `benchmark.js` loads target definitions from `targets/definitions/*.json` and versioned prompts from `prompts/v1/{system,user}.md`
3. Prompt templates use `{{WIDTH}}`, `{{HEIGHT}}`, `{{COLORS}}` substitutions
4. LLM adapter (`core/llm/`) generates CSS; adapters extract CSS from fenced code blocks via regex
5. `core/renderer.js` renders CSS to PNG via headless Chromium
6. `core/scorer.js` pixel-diffs the render against the target image (pixelmatch threshold 0.01); score follows the CSS Battle formula (see scorer.js for details)
7. Results are persisted to `db/sqlite.js` using Node 22's built-in `DatabaseSync` API (tables: `runs`, `run_meta`)

**Parallelization & Resume:** `benchmark.js` runs targets via a concurrency-limited worker pool. Each worker processes one target at a time (sequential attempts). When `resumeRunId` is provided, `getCompletedTargetIds()` is queried and matching targets are skipped. Note: `node:sqlite` stores JS Numbers as REAL (`1.0`), so stored `target_id` values are normalised via `Math.round(Number(...))` on read.

### Key Design Rules

- **Prompts are versioned and immutable** — never edit an existing prompt version; create a new directory (e.g., `prompts/v2/`) instead.
- **Only Score = 100%** is considered a perfect match.
- All source files use ES modules (`import`/`export`); no CommonJS.
- The SQLite adapter uses Node 22's built-in `node:sqlite` — no external sqlite3 dependency.

## Environment Variables

Configured via `.env` (see `.env.example`):

```
DB_ADAPTER=sqlite          # sqlite | supabase
SQLITE_PATH=./results/clawbattle.db
OPENROUTER_API_KEY=
OPENAI_API_KEY=
OLLAMA_BASE_URL=http://localhost:11434
```

## Code Style

- **Strong modularization** — modules must be loosely coupled and independently usable. One responsibility per file. If a file is getting long, split it.
- **Testable by design** — functions take their dependencies as parameters (e.g. `saveAttempt(db, data)`). Singletons are wired in a dedicated `index.js`; never inside the logic modules themselves.
- **Test-driven development** — write tests alongside or before implementation. Use Node's built-in `node:test` runner; no external test framework.
- **No large files** — keep functions short and focused.

### Running tests

```bash
# Single file
node --test packages/db/adapters/sqlite/runs.test.js

# All tests
node --test packages/**/*.test.js
```

## Local Development (without Docker)

The API can be started directly for testing:

```bash
cd packages/api
npm start   # runs: node --env-file=../../.env server.js
```

## What Is Not Yet Implemented

- Supabase DB adapter (`packages/db/supabase.js` is a stub)
- No linting or CI/CD configuration
