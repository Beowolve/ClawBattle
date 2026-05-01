# Security Policy

## Reporting a Vulnerability

Please do not open a public issue for secrets, credential leaks, or exploitable vulnerabilities.

Report security issues by email at `beowolve@gmail.com`, by Discord at `beo007`, or by opening a private GitHub security advisory if that is available for this repository. Include:

- Affected component or file path.
- Steps to reproduce.
- Expected impact.
- Any safe proof-of-concept details.

## Scope

Security-sensitive areas include:

- Provider API keys and local `.env` files.
- Supabase credentials and row-level security policies.
- Public dashboard data exposed through the Supabase anon key.
- Generated HTML/CSS sanitization before rendering.
- Benchmark result upload/download paths.

## Supported Versions

Only the current `main` branch is actively maintained. Fixes are released through normal version tags.

## Secrets

Never commit API keys, Supabase service keys, local `.env` files, generated credentials, or private provider configuration. If a secret is committed, rotate it immediately.
