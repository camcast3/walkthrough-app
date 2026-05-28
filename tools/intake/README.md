# Intake System — CLI & Server

Local-first tool for converting walkthrough source material (markdown captured by the [intake browser extension](../intake-extension/README.md)) into the project's `main-walkthrough.json` format. Replaces the prior 4-agent AI pipeline with a deterministic, trainable rule engine plus an interactive CLI review loop.

## Install

```bash
cd tools/intake
npm install
```

Node 20+ recommended (developed against Node 24).

> **Windows users:** PowerShell aliases `curl` to `Invoke-WebRequest`. Use `curl.exe` instead (ships with Windows 10+), or use `Invoke-RestMethod`, or run commands in Git Bash / WSL.

## Quick start

```bash
# 1. Start an intake session for a new walkthrough
cd <repo-root>
npx tsx tools/intake/src/cli.ts start \
  --game "Trails of Cold Steel II" \
  --source "https://www.example.com/cold-steel-ii-walkthrough"

# 2. In Chrome/Edge, load tools/intake-extension/ as an unpacked extension
#    (see ../intake-extension/README.md), open the source walkthrough pages,
#    and click "Capture This Page" for each one.

# 3. Convert captured pages into classified sections
curl -X POST http://localhost:3847/api/convert

# 4. Review and approve sections (see "Review workflow" below)

# 5. Finalize — writes walkthroughs/<slug>/main-walkthrough.json
curl -X POST http://localhost:3847/api/finalize
```

## Running the CLI

The package's `bin` entry points at `./dist/cli.js`, but for development you can skip the build step with `tsx`:

| Want to... | Run this |
|---|---|
| Run the CLI without building | `npx tsx tools/intake/src/cli.ts <command> [args]` (from repo root) |
| Run the built CLI | `cd tools/intake && npm run build && node dist/cli.js <command>` |
| Install `intake` globally for this checkout | `cd tools/intake && npm run build && npm link` — then `intake <command>` works anywhere |
| Type-check without building | `cd tools/intake && npx tsc --noEmit` |
| Run tests | `cd tools/intake && npm test` |
| Watch tests | `cd tools/intake && npm run test:watch` |

> **Important:** the CLI resolves the training database at `<cwd>/tools/intake/training-data.json`, so `set-threshold`, `training-status`, and `graduate` must be run from the **repo root** (or any directory where that relative path resolves correctly).

## Commands

### `start --game <name> --source <url> [--port 3847]`

Boots the intake server on the given port and creates the working directory:

```
walkthroughs/<slug>/
└── .intake/
    ├── session.json
    └── pages/        # extension drops captured pages here
```

The `<slug>` is generated from the game name (e.g. `"Trails of Cold Steel II"` → `trails-of-cold-steel-ii`). The server stays in the foreground — Ctrl+C to stop.

### `convert [--dir <path>]`

Convenience wrapper that POSTs to `/api/convert` on the running server. Returns the section + block counts. Same as `curl -X POST http://localhost:3847/api/convert`.

### `finalize`

POSTs to `/api/finalize`. Writes the approved sections to `walkthroughs/<slug>/main-walkthrough.json`.

### `set-threshold <count>`

Persists a new graduation threshold to `tools/intake/training-data.json`. Default is 10; common overrides are 50 or 100 for serious training runs.

```bash
# From repo root
npx tsx tools/intake/src/cli.ts set-threshold 50
```

### `training-status`

Prints current graduation status, threshold, walkthroughs processed, and number of recorded corrections. Honors `INTAKE_GRADUATION_THRESHOLD` env var as a one-off override.

```bash
INTAKE_GRADUATION_THRESHOLD=100 npx tsx tools/intake/src/cli.ts training-status
```

### `graduate [--force]`

Graduates out of training mode (converter starts auto-approving high-confidence blocks). Refuses to run if not enough walkthroughs have been processed unless `--force` is passed.

## Graduation threshold precedence

When `RulesDB` resolves the effective threshold, it checks sources in this order:

1. Constructor option (`new RulesDB(path, { graduationThreshold: N })`)
2. `INTAKE_GRADUATION_THRESHOLD` env var
3. `graduation_threshold` field stored in `training-data.json`
4. `DEFAULT_GRADUATION_THRESHOLD` (10)

Invalid values (non-positive, non-integer, NaN) fall through to the next source instead of throwing.

## HTTP API

The server listens on `http://localhost:3847` by default. All endpoints return JSON.

| Method | Path | Purpose |
|---|---|---|
| `GET`    | `/api/session` | Current session info |
| `DELETE` | `/api/session` | Acknowledge reset (cleanup is caller-side) |
| `POST`   | `/api/intake` | Save a captured page (`{ title, url, markdown, page_number? }`) |
| `GET`    | `/api/pages` | List all captured pages (sorted by `page_number`) |
| `GET`    | `/api/pages/:num` | Fetch one page |
| `POST`   | `/api/convert` | Run the converter on all captured pages |
| `GET`    | `/api/sections` | List converted sections |
| `GET`    | `/api/sections/:id` | Fetch one section |
| `PUT`    | `/api/sections/:id/blocks/:index` | Update a block (`{ block?, approved? }`) |
| `POST`   | `/api/approve/:id` | Mark a whole section approved |
| `POST`   | `/api/finalize` | Write `main-walkthrough.json` |

## Review workflow

After `POST /api/convert`, every block has `approved: false` and a `confidence` score. A typical review session in `training` mode:

```bash
# List sections
curl -s http://localhost:3847/api/sections | jq '.[] | {id, title, blocks: (.blocks|length)}'

# Inspect a single section
curl -s http://localhost:3847/api/sections/prologue | jq .

# Correct a misclassified block (e.g. block index 2 should be a callout)
curl -X PUT http://localhost:3847/api/sections/prologue/blocks/2 \
  -H 'Content-Type: application/json' \
  -d '{
    "block": { "type": "callout", "severity": "warning", "content": "Missable!" },
    "approved": true
  }'

# Approve an entire section once you've reviewed it
curl -X POST http://localhost:3847/api/approve/prologue

# When all sections are approved, finalize
curl -X POST http://localhost:3847/api/finalize
```

A simple Svelte/curl-driven review UI is planned but not in scope here — for now, scripts or your editor + curl are fine.

## File layout

```
tools/intake/
├── src/
│   ├── cli.ts                       # Commander entry point (bin)
│   ├── server.ts                    # Express factory: createServer(workingDir)
│   ├── types.ts                     # All shared block / session / training types
│   ├── converter/
│   │   ├── index.ts                 # convertPages() orchestrator
│   │   ├── markdown-parser.ts       # parseMarkdown(), parseTable()
│   │   ├── detect-sections.ts       # H2 boundary splitter
│   │   ├── detect-checkpoints.ts    # H3 → checkpoint
│   │   └── detect-blocks.ts         # Rule-based block classifier
│   └── training/
│       └── rules-db.ts              # RulesDB persistence + threshold logic
├── tests/                            # Mirror layout, vitest specs
├── package.json
├── tsconfig.json
└── training-data.json                # Created on first run; ignored by git
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot connect to intake server` in extension popup | Start the server: `npx tsx tools/intake/src/cli.ts start --game ... --source ...` |
| Port 3847 already in use | Pass `--port <other>` to `start`; update `SERVER` in `tools/intake-extension/popup.js` to match |
| `set-threshold` errors with ENOENT | Run from the repo root, not from inside `tools/intake/` |
| Convert outputs zero sections | Source pages probably lack `##` headings — the section detector splits on H2 |
| Encounter table classified as plain table | Add `HP`, `Weakness`, `Level`, `EXP`, `Mira`, or `Drops` column header to the source — those are the encounter-stat triggers |
