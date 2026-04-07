# Prompts

## Versioning

Prompt versions are immutable once benchmark results referencing them exist in the database.
Until then, the current version can be freely modified. Only create a new version directory
when existing DB rows must stay reproducible.

## Structure

```
prompts/
├── followup.md       # version-independent follow-up appendix (see below)
└── v1/
    └── prompt.md     # base prompt for version v1
```

## Base prompt (`vN/prompt.md`)

Used for the first attempt of each target. Placeholders:

| Placeholder | Value |
|---|---|
| `{{CHROME_VERSION}}` | Chromium version used for rendering |
| `{{WIDTH}}` | Canvas width in px (currently 400) |
| `{{HEIGHT}}` | Canvas height in px (currently 300) |
| `{{COLORS}}` | Comma-separated list of allowed colors |

## Follow-up appendix (`followup.md`)

For attempts 2 and beyond, `followup.md` is appended to the base prompt.
The model also receives two images: image 1 is the target, image 2 is its previous render.

Additional placeholder:

| Placeholder | Value |
|---|---|
| `{{PREVIOUS_CODE}}` | Code submitted in the previous attempt |

The resulting prompt for attempt N > 1 is:

```
{base prompt with all placeholders resolved}
---
{followup.md with {{PREVIOUS_CODE}} resolved}
```
