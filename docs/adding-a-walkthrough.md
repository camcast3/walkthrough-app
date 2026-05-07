# Adding a Walkthrough

## Overview

Walkthroughs are created through a **4-agent pipeline** that ensures quality and completeness. Each agent has a specific role and the walkthrough passes through all four before publication.

```
Writer  →  Reviewer  →  Gamer  →  Completionist
```

## The Pipeline

### Agent 1: Writer
**Agent:** `@walkthrough-writer`

The Writer creates the initial walkthrough draft from the user's **trusted source URL** (or raw pasted text). It does deep, multi-query research for each section and produces rich, detailed prose (8,000-25,000+ chars per section) with embedded checkpoints and granular steps.

```
@walkthrough-writer
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
**Agent:** `@walkthrough-reviewer`

The Reviewer audits the draft **against the original trusted source only**. It does not compare against other walkthroughs or its own knowledge — the user's chosen source is the single source of truth.

```
@walkthrough-reviewer
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
**Agent:** `@walkthrough-gamer`

The Gamer reads the walkthrough as if they're **actually playing the game**. They care about usability, clarity, and not missing fun stuff.

```
@walkthrough-gamer
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
**Agent:** `@walkthrough-completionist`

The Completionist cross-references the walkthrough against the **game's full achievement/trophy list** to ensure 100% completion is possible.

```
@walkthrough-completionist
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

Each section supports three content modes (mutually exclusive, in order of precedence):

| Field | Purpose |
|---|---|
| `blocks` | Typed content block array — structured UI components (preferred for new walkthroughs) |
| `content` | Full walkthrough prose in Markdown with embedded `<!-- checkpoint: id \| label -->` markers |
| `steps` | Granular checkable action items (classic checklist) |

Sections must have at least `blocks`, `content`, or `steps`. Legacy walkthroughs using `content` or `steps` continue to work unchanged.

---

### Blocks format (recommended)

The `blocks` array contains typed content blocks that render as specialized UI components. Each block has a `type` discriminator field.

#### 6 universal block types

| Type | Purpose | Key fields |
|---|---|---|
| `prose` | Narrative text (Markdown with inline markers) | `content`, `heading?` |
| `encounter` | Boss/enemy fight card | `name`, `stats?`, `strategy?`, `reward?`, `drops?` |
| `quest` | Quest task card | `name`, `quest_type`, `client?`, `content?`, `reward?` |
| `table` | Data grid (treasure, shops, items) | `columns`, `rows` |
| `checklist` | Interactive checkbox list | `items[]`, `style?` |
| `callout` | Alert/warning box | `content`, `severity?` |

#### Example section with blocks

```json
{
  "id": "act-1-part-1",
  "title": "Act 1 — Part 1",
  "blocks": [
    {
      "type": "prose",
      "heading": "Arriving in Town",
      "content": "Head to the central plaza and speak with the NPC.\n\n<!-- checkpoint: arrived-town | Arrived in Town -->"
    },
    {
      "type": "checklist",
      "heading": "Missable Items",
      "style": "missable",
      "items": [
        { "id": "buy-chronicle-1", "label": "Imperial Chronicle #1", "detail": "General Store — buy before leaving town" }
      ]
    },
    {
      "type": "encounter",
      "name": "Magic Knight Ortheim",
      "stats": { "HP": "12,500", "Weakness": "Earth" },
      "strategy": "Focus Arts on weakness. Keep HP above 50% for S-Craft.",
      "reward": "3000 Mira"
    },
    {
      "type": "quest",
      "quest_type": "side",
      "name": "Lost Cat Search",
      "client": "Old Lady Mabel",
      "content": "Find the cat on the west bridge.",
      "reward": "Recipe: Herb Sandwich"
    },
    {
      "type": "table",
      "heading": "Treasure Chests",
      "columns": ["Location", "Contents"],
      "rows": [
        ["NE corner of plaza", "Healing Balm x3"],
        ["Roof access ladder", "Gladius (Weapon)"]
      ]
    },
    {
      "type": "callout",
      "severity": "warning",
      "content": "Point of no return! Complete all side quests before entering the castle."
    }
  ],
  "checkpoints": [
    { "id": "arrived-town", "label": "Arrived in Town" }
  ]
}
```

#### Checklist styles

| Style | Icon | Use for |
|---|---|---|
| `collectible` | ◆ | Treasure chests, items, equipment |
| `missable` | ⚠ | Items that become unavailable |
| `npc` | 👤 | Character interactions, bonding events |
| `key` | 🔑 | Key items, quest progression items |
| `puzzle` | 🧩 | Puzzles, hidden areas |

#### Callout severities

| Severity | Colour | Use for |
|---|---|---|
| `info` | Blue | Tips, helpful info |
| `warning` | Yellow | Important cautions, timing-sensitive |
| `danger` | Red | Point of no return, missable content |

#### Quest types

| Type | Badge | Use for |
|---|---|---|
| `main` | ⭐ Main | Main story quests |
| `side` | 📋 Side | Optional side quests |
| `hidden` | 🔍 Hidden | Hidden/secret quests |
| `story` | 📖 Story | Story-linked character quests |

---

### Legacy: content mode

Inside the `content` markdown, embed milestones like:
```
<!-- checkpoint: boss-defeated | Defeated the First Boss -->
```

### Legacy: inline trackable item syntax

Embed individual checkable items (collectibles, missables, side quests) directly in the prose:

```
<!-- collectible: stone-brooch | Stone Brooch (Accessory) -->
<!-- missable: imperial-chronicle-1 | Buy Imperial Chronicle Issue #1 -->
<!-- side_quest: munch-no-more | Side Quest: Munch no More -->
```

These render as compact inline checkboxes the player can tick off without leaving the prose view. Each type has a distinct colour:

| Marker | Icon | Colour | Use for |
|---|---|---|---|
| `collectible` | ◆ | Green | Treasure chests, items, quartz |
| `missable` | ⚠ | Orange | Point-of-no-return items, missable content |
| `side_quest` | 📋 | Purple | Side quests and hidden quests |

### Subsection collapsing

In legacy `content` mode, the webapp automatically wraps every `###` heading and the content that follows it inside a collapsible `<details>` element. In `blocks` mode, each block is its own visual unit and encounters/quests are naturally collapsible.

### Step types

| Type | Icon | Meaning |
|---|---|---|
| `step` | ✓ | A checkable action the player takes |
| `note` | ℹ | Informational — not checkable |
| `warning` | ⚠ | Important warning — something to avoid or not miss |
| `collectible` | ◆ | A missable item, trophy, or achievement trigger |
| `boss` | ☠ | A boss fight |

---

## Gamepad / controller navigation

The webapp supports full gamepad navigation for couch play. Controls adapt based on the section's content mode.

### Common controls (all modes)

| Button | Action |
|---|---|
| Left stick | Analog scroll (quadratic curve) |
| LB / RB | Previous / next section |
| LT / RT | Zoom out / in (analog pressure) |
| A (South) | Toggle check on focused element |
| B (East) | Deselect focused item; go back when nothing focused |
| Y (North) | Cycle HLTB time mode |
| X (West) | Checkout / check-in (client mode only) |
| Back / Select | Go to walkthrough list (home) — always works |
| Start / ☰ | Open settings |

### Steps mode (classic checklist sections)

| Button | Action |
|---|---|
| D-pad Up/Down | Move focus between step cards (repeat on hold) |
| D-pad Left/Right | Previous / next section |
| A | Toggle check on focused step |

### Prose mode (markdown content with inline markers)

| Button | Action |
|---|---|
| D-pad Up/Down | Jump between checkpoints and inline checkable items |
| D-pad Left/Right | Previous / next section |
| A | Toggle the nearest/focused checkpoint or inline item |

### Blocks mode (typed block components)

| Button | Action |
|---|---|
| D-pad Down | Enter block items (focuses first interactive element) |
| D-pad Up/Down | Move focus between interactive elements; exits at top/bottom edges |
| D-pad Left/Right | Jump to first item in previous/next block; exits at first/last block |
| B | Deselect focused item; go back when nothing focused |
| LB / RB | Previous / next section (always, regardless of focus state) |
| A | Toggle check on focused checklist item or checkpoint |

In blocks mode, the focus ring highlights the current interactive element. Navigation is designed so you can always leave:

- **D-pad Up** past the first item clears focus (exits blocks)
- **D-pad Down** past the last item clears focus (exits blocks)
- **D-pad Left** at the first block clears focus (next Left press changes section)
- **D-pad Right** at the last block clears focus (next Right press changes section)
- **B** clears focus first; when unfocused, goes back
- **Back/Select** always navigates to the walkthrough list regardless of state

### Hint bar

A compact hint bar at the bottom of the screen shows context-sensitive button labels. It adapts to the current mode and tightens layout on small screens (Steam Deck, phones). Hints update automatically when switching modes, changing block focus, or when dialogs appear.
