# Prompts

## Versioning

Prompt versions are immutable once benchmark results referencing them exist in the database.
Until then, the current version can be freely modified. Only create a new version directory
when existing DB rows must stay reproducible.

## Structure

```
prompts/
├── v1/
│   ├── prompt.md     # base prompt for attempt 1
│   └── followup.md   # follow-up appendix for attempts 2+
├── v2/
│   ├── prompt.md     # improved color accuracy guidance
│   └── followup.md
└── v3/               # current default
    ├── prompt.md     # same as v2
    └── followup.md   # adds {{PREVIOUS_MATCH}} and {{PREVIOUS_SCORE}}
```

## Base prompt (`vN/prompt.md`)

Used for the first attempt of each target. Placeholders:

| Placeholder | Value |
|---|---|
| `{{CHROME_VERSION}}` | Chromium version used for rendering |
| `{{WIDTH}}` | Canvas width in px (currently 400) |
| `{{HEIGHT}}` | Canvas height in px (currently 300) |
| `{{COLORS}}` | Comma-separated list of allowed colors |

## Follow-up appendix (`vN/followup.md`)

For attempts 2 and beyond, `followup.md` from the same version directory is appended to the
base prompt. The model also receives two images: image 1 is the target, image 2 is its
previous render.

Additional placeholder:

| Placeholder | Value |
|---|---|
| `{{PREVIOUS_CODE}}` | Code submitted in the previous attempt |
| `{{PREVIOUS_MATCH}}` | Pixel match % of the previous attempt (e.g. `87.50%`) — v3+ |
| `{{PREVIOUS_SCORE}}` | CSS Battle score of the previous attempt (e.g. `742.35`) — v3+ |

Placeholders not present in a given `followup.md` are simply ignored.

The resulting prompt for attempt N > 1 is:

```
{base prompt with all placeholders resolved}
---
{followup.md with all placeholders resolved}
```
