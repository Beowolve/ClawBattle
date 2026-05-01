# Contributing

Thanks for taking the time to improve ClawBattle. Keep contributions focused and easy to review.

## Setup

1. Install Docker Desktop and Node.js 22 or newer.
2. Copy `.env.example` to `.env` and add any provider keys needed for local runs.
3. Start the local stack:

```bash
npm run dev
```

Open `http://localhost:5173` for the dashboard.

## Development Rules

- Write code, comments, commit messages, and documentation in English.
- Keep source files as ES modules (`import` / `export`), not CommonJS.
- Keep changes scoped. Avoid unrelated refactors in feature or bug-fix pull requests.
- Do not edit an existing prompt version. Create a new `prompts/vN/` directory instead.
- Only completed `done` rows should be synced to Supabase. Queue state stays local.
- If you change Supabase-backed data shape or public dashboard queries, update `packages/db/schema.sql`.
- The project owner's Supabase backend is not shared with contributors. Do not ask for production Supabase keys, and do not expect access to the production backend. Contributors may run their own Supabase project for testing; applying schema changes to the production backend is handled only by the project owner.
- Keep `README.md` and `STATUS.md` aligned with current behavior.

## Checks

Run the test suite before submitting:

```bash
npm test
```

For public dashboard changes, also build the public bundle:

```bash
npm --prefix packages/dashboard run build:public
```

## Pull Requests

Include a short summary, the tests you ran, and any schema or environment changes reviewers must apply.
