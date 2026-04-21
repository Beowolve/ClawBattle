# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language
* Always use English, both for the code, comments and documentation.

## Session Continuity

* **Always keep [STATUS.md](STATUS.md) up to date.** After completing a TODO item, mark it done. When a new idea comes up that won't be implemented immediately, add it to the Backlog section. Update the "Last updated" date. This ensures any session can be picked up without losing context.
* **Always keep [README.md](README.md) up to date as well.**

### Key Design Rules

- **Prompts are versioned and immutable** — never edit an existing prompt version; create a new directory (e.g., `prompts/v2/`) instead.
- **Only Score = 100%** is considered a perfect match.
- All source files use ES modules (`import`/`export`); no CommonJS.
- The SQLite adapter uses Node 22's built-in `node:sqlite` — no external sqlite3 dependency.

## Code Style

- **Strong modularization** — modules must be loosely coupled and independently usable. One responsibility per file. If a file is getting long, split it.
- **Testable by design** — functions take their dependencies as parameters (e.g. `saveAttempt(db, data)`). Singletons are wired in a dedicated `index.js`; never inside the logic modules themselves.
- **Test-driven development** — for bug fixes and new features, write or update the failing test first, then implement the smallest change that makes it pass, then refactor. Follow `red -> green -> refactor`. Use Node's built-in `node:test` runner; no external test framework.
- **No large files** — keep functions short and focused.
- **Avoid code duplication** — prefer composition over inheritance. Use higher-order functions and functional programming techniques.
