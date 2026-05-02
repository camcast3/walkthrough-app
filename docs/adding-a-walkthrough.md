# Adding a Walkthrough

## Overview

Walkthroughs are created through a **4-agent pipeline** that ensures quality and completeness. Each agent has a specific role and the walkthrough passes through all four before publication.

```
Writer  →  Reviewer  →  Gamer  →  Completionist
```

## The Pipeline

### Agent 1: Writer
**Skill:** `walkthrough-writer`

The Writer creates the initial walkthrough draft from the user's **trusted source URL**. It does deep, multi-query research for each section and produces rich, detailed prose (8,000-25,000+ chars per section) with embedded checkpoints and granular steps.

```
@copilot Use the walkthrough-writer skill.
Source: https://www.neoseeker.com/game-name/walkthrough
Game: Example Game
```

The Writer will:
- Map out all sections from the source
- Do multiple web searches per section for comprehensive detail
- Write full prose with day-by-day breakdowns, NPC visit order, chest locations, boss strategies, etc.
- Embed `<!-- checkpoint: id | label -->` markers at milestones
- Generate a detailed `steps` array for checklist tracking
- Validate against the schema and save the file

**Output:** A walkthrough JSON file in `walkthroughs/<game-slug>/main-walkthrough.json`

---

### Agent 2: Reviewer
**Skill:** `walkthrough-reviewer`

The Reviewer audits the draft **against the original trusted source only**. It does not compare against other walkthroughs or its own knowledge — the user's chosen source is the single source of truth.

```
@copilot Use the walkthrough-reviewer skill.
Draft: walkthroughs/game-name/main-walkthrough.json
Trusted source: https://www.neoseeker.com/game-name/walkthrough
```

The Reviewer checks:
- Are ALL quests from the source present (main + side)?
- Are NPC interactions and visit order correct?
- Are item/chest locations preserved?
- Are boss strategies complete?
- Are missables and point-of-no-return warnings present?
- Are character events and bonding content covered?

**Output:** A section-by-section review with ✅ PASS / ⚠️ MINOR / ❌ MAJOR verdicts. Returns to Writer if major gaps found.

---

### Agent 3: Gamer
**Skill:** `walkthrough-gamer`

The Gamer reads the walkthrough as if they're **actually playing the game**. They care about usability, clarity, and not missing fun stuff.

```
@copilot Use the walkthrough-gamer skill.
Walkthrough: walkthroughs/game-name/main-walkthrough.json
```

The Gamer checks:
- Can I follow these directions without getting lost?
- Do I know about all available side content right now?
- Do boss strategies give me enough info to win?
- Am I warned before every point of no return?
- Does the guide flow well or is it overwhelming/sparse?

**Output:** A review with 🔴 Blocker / 🟡 Annoyance / 🟢 Nice-to-have ratings. Returns to Writer if blockers found.

---

### Agent 4: Completionist
**Skill:** `walkthrough-completionist`

The Completionist cross-references the walkthrough against the **game's full achievement/trophy list** to ensure 100% completion is possible.

```
@copilot Use the walkthrough-completionist skill.
Walkthrough: walkthroughs/game-name/main-walkthrough.json
Game: Example Game
```

The Completionist checks:
- Is every achievement/trophy addressed by the walkthrough?
- Are missable achievements explicitly warned about with timing?
- Are collectible achievements backed by individual item locations?
- Are combat/challenge achievements supported by strategy tips?
- Are NG+ or post-game achievements noted?

**Output:** An achievement coverage report with ✅/⚠️/❌/🔒 ratings. Returns to Writer if missable achievements lack warnings.

---

## Quick single-pass alternative

For simple walkthroughs or quick drafts, you can use the legacy single-pass ingest:

```
@copilot Use the walkthrough-ingest skill.
Please convert this walkthrough: https://example.com/game-walkthrough
```

This skips the review pipeline. Best for short games or when you plan to manually review.

## After the pipeline

Once all four agents pass, commit and push:

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

### Section content format

Each section supports two complementary content modes:

| Field | Purpose |
|---|---|
| `content` | Full walkthrough prose in Markdown with embedded `<!-- checkpoint: id \| label -->` markers |
| `checkpoints` | Array of `{ id, label }` objects matching each checkpoint marker in content |
| `steps` | Granular checkable action items (classic checklist) |

Sections must have at least `content` or `steps` (or both). When both are present, the webapp shows the full prose as the primary view with steps in a collapsible panel.

### Checkpoint syntax

Inside the `content` markdown, embed milestones like:
```
<!-- checkpoint: boss-defeated | Defeated the First Boss -->
```

### Step types

| Type | Icon | Meaning |
|---|---|---|
| `step` | ✓ | A checkable action the player takes |
| `note` | ℹ | Informational — not checkable |
| `warning` | ⚠ | Important warning — something to avoid or not miss |
| `collectible` | ◆ | A missable item, trophy, or achievement trigger |
| `boss` | ☠ | A boss fight |
