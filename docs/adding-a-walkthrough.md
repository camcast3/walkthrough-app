# Adding a Walkthrough

## Step 1: Use the Copilot skill

Open GitHub Copilot (in VS Code, GitHub.com, or the CLI) and use the walkthrough-ingest skill:

```
@copilot Use the walkthrough-ingest skill. 
Please convert this walkthrough: https://example.com/game-walkthrough
```

Or paste raw text:

```
@copilot Use the walkthrough-ingest skill.
Here is the walkthrough text: [paste the text]
```

Copilot will output a JSON file matching the schema.

## Step 2: Save the file

Save the output to:
```
walkthroughs/<game-slug>/<walkthrough-name>.json
```

Example: `walkthroughs/elden-ring/main-walkthrough.json`

## Step 3: Review

Check that:
- `attribution` field credits the original source
- `id` is a unique slug (lowercase, hyphens only)
- Sections and steps make sense
- `type` values are correct (`step`, `note`, `warning`, `collectible`, `boss`)

## Step 4: Commit and push

```bash
git add walkthroughs/
git commit -m "Add walkthrough: <Game Name>"
git push origin main
```

The CI pipeline will:
1. Validate the JSON schema (on PR)
2. On merge to `main`: build and deploy the updated server to k8s

All devices will get the new walkthrough on their next sync.

## Schema reference

See [walkthrough.schema.json](../walkthroughs/walkthrough.schema.json) for the full schema.

### Step types

| Type | Icon | Meaning |
|---|---|---|
| `step` | ✓ | A checkable action the player takes |
| `note` | ℹ | Informational — not checkable |
| `warning` | ⚠ | Important warning — something to avoid or not miss |
| `collectible` | ◆ | A missable item, trophy, or achievement trigger |
| `boss` | ☠ | A boss fight |
