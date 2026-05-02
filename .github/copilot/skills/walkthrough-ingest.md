# Walkthrough Ingestion Skill

## Description
Converts any online game walkthrough into the standardized walkthrough JSON format used by the Walkthrough Checklist App. The output preserves the **full original prose** with embedded milestone checkpoints plus granular step checklists. The result is committed to the `/walkthroughs/` directory.

## When to use
Use this skill when you want to add a new walkthrough to the app. Provide either:
- A URL to an online walkthrough page, or
- Pasted raw text from a walkthrough

## Instructions

You are a walkthrough ingestion agent. Your job is to transform raw walkthrough content into a structured JSON file that matches the walkthrough schema at `/walkthroughs/walkthrough.schema.json`.

### Input
The user will provide one of:
1. A URL to an online walkthrough
2. Raw walkthrough text (pasted content)
3. Both

### Fetching content from URLs

Many walkthrough sites (Neoseeker, IGN, GameFAQs, etc.) are behind Cloudflare bot protection and will return 403 or a JavaScript challenge page. When a direct fetch fails:

1. **Use `web_search`** to find the walkthrough's table of contents and chapter structure. Search for: `"<site name> <game> walkthrough table of contents chapters"`
2. **Search each section** for detailed step-by-step content. Search for: `"<site name> <game> walkthrough <section name> steps boss items"`
3. **Combine the results** into a comprehensive walkthrough. Don't skip sections — make multiple search queries to cover the full game.
4. **For very long games** (60+ chapters), prioritize getting the structure right for all sections but focus detailed steps on the first major story arc. You can note remaining sections need expansion.

The goal is to produce a useful walkthrough even when the site can't be scraped directly. Use all available search results and cross-reference multiple sources if needed, but always attribute to the original source the user provided.

### Output

Create the JSON file directly in the repository at the correct path:
- Create the directory: `walkthroughs/<game-slug>/`
- Create the file: `walkthroughs/<game-slug>/main-walkthrough.json`
- Validate the JSON (correct IDs, types, structure)
- Commit with a descriptive message

Do NOT just output a code block — actually create the file and commit it.

### Rules

1. **Always include attribution.** The `attribution` field MUST say something like:
   > "This walkthrough was pulled from [Author/Site] ([url]) and processed for a cleaner reading experience. All credit for the original content goes to [Author/Site]."

2. **Generate a slug ID** for the walkthrough using the pattern `<game-slug>-<type>`, e.g. `elden-ring-main`, `hollow-knight-achievements`. Use only lowercase letters, numbers, and hyphens.

3. **Break content into sections** that map to major game areas, chapters, or phases. Each section needs a unique slug `id` and a human-readable `title`.

4. **Preserve full walkthrough prose in the `content` field.** Each section MUST have a `content` field containing the full original walkthrough text in **Markdown**. Do NOT abbreviate or summarize. Preserve:
   - Detailed descriptions of areas, enemies, and environment
   - Strategy tips, build advice, and combat guidance
   - Story context and lore notes
   - Navigation directions (go left, take the second door, etc.)
   - NPC dialogue triggers and quest conditions

   Use Markdown formatting: `**bold**` for item/boss/location names, `>` for tips/quotes, `##` / `###` for sub-headings within a section, `-` for lists.

5. **Embed checkpoint markers in the content.** At major milestones within the prose, insert an HTML comment marker:
   ```
   <!-- checkpoint: <id> | <label> -->
   ```
   - `<id>` is a unique slug (lowercase, hyphens, e.g. `asylum-demon-defeated`)
   - `<label>` is the human-readable milestone text (e.g. `Defeated the Asylum Demon`)
   - Place checkpoints after boss defeats, area transitions, major item acquisitions, and quest completions
   - Aim for 3-8 checkpoints per section depending on length

6. **List all checkpoints in the `checkpoints` array.** Every `<!-- checkpoint: id | label -->` marker in `content` MUST have a matching entry in the section's `checkpoints` array:
   ```json
   "checkpoints": [
     { "id": "asylum-demon-defeated", "label": "Defeated the Asylum Demon" }
   ]
   ```

7. **Also generate granular `steps` for detailed tracking.** The `steps` array provides a concise checklist alongside the prose. Classify each step using the correct `type`:

   | Icon | Type | Meaning |
   |------|------|---------|
   | `✓`  | `step` | A standard checkable action the player takes |
   | `ℹ`  | `note` | Informational text, tips, lore. **NOT checkable.** |
   | `⚠`  | `warning` | Something the player must not miss or must be careful about |
   | `◆`  | `collectible` | A missable item, trophy, or achievement trigger |
   | `☠`  | `boss` | A boss fight. Include the boss name in bold in the `text` field. |

   These icons are the canonical legend displayed in the webapp. Use only these five `type` values — no others are valid.

8. **Keep step text concise.** Each step should be one action or one piece of information. Split long paragraphs into multiple steps. Use **bold** for item names, boss names, and key locations.

9. **Add a `note` field** when the original walkthrough has important supplemental info for that step (tips, warnings, quantities, coordinates). Keep notes short.

10. **Suggested file path** format: `walkthroughs/<game-slug>/<walkthrough-slug>.json`
    - Example: `walkthroughs/elden-ring/main-walkthrough.json`

11. **`created_at`** should be today's date in `YYYY-MM-DD` format.

12. **Validate your output** against the schema before committing:
    - All required fields present (`id`, `game`, `title`, `author`, `source_url`, `attribution`, `created_at`, `sections`)
    - All `id` fields match pattern: `^[a-z0-9]+(-[a-z0-9]+)*$`
    - `source_url` is a valid URI
    - `sections` array has at least one entry
    - Each section has either `content` or `steps` (or both)
    - Every checkpoint `id` in the `checkpoints` array must appear in a `<!-- checkpoint: id | label -->` marker in `content`
    - Step `type` is one of: `step`, `note`, `warning`, `collectible`, `boss`
    - `$schema` is set to the correct relative path (e.g., `../walkthrough.schema.json`)

13. **Be thorough.** A good walkthrough has:
    - Rich prose `content` that reads like the original walkthrough
    - 3-8 milestone checkpoints per section
    - Granular `steps` array with 50+ steps for a full-length RPG
    - Boss fights called out with HP and strategy tips when available
    - Collectibles and missables clearly marked
    - Warnings before point-of-no-return moments

### Example prompt
> "Please convert this walkthrough: https://example.com/game-walkthrough"

### Example output structure

```json
// Created at: walkthroughs/example-game/main-walkthrough.json
{
  "$schema": "../walkthrough.schema.json",
  "id": "example-game-main",
  "game": "Example Game",
  "title": "Main Story Walkthrough",
  "author": "Example Author",
  "source_url": "https://example.com/game-walkthrough",
  "attribution": "This walkthrough was pulled from Example Author (example.com) and processed for a cleaner reading experience. All credit for the original content goes to Example Author.",
  "created_at": "2026-04-30",
  "sections": [
    {
      "id": "chapter-1",
      "title": "Chapter 1: The Beginning",
      "content": "You begin your journey in the **Village of Oakhaven**. The sun is setting and the village elder greets you at the gate. Take a moment to explore — there are several important items to pick up before heading out.\n\nHead to the **village square** and talk to the merchant near the fountain. He'll offer you a basic sword for free if you mention the elder sent you. Be sure to grab the **Starting Item** from the chest behind the merchant stall.\n\n<!-- checkpoint: village-explored | Explored Oakhaven Village -->\n\n## The Red Door\n\nOn the east side of town you'll notice a conspicuous red door. **Do NOT open it yet** — doing so triggers a cutscene that locks you out of a collectible in the western alley. Come back after completing the side quest \"Lost Heirloom\" which becomes available in Chapter 2.\n\nInstead, head west past the blacksmith. Behind the waterfall at the end of the alley, you'll find the **Missable Trophy Item** sitting on a pedestal. This is the only time you can grab it.\n\n<!-- checkpoint: collectibles-secured | Secured missable collectibles -->\n\n## Boss: The First Guardian\n\nWhen you're ready, head north to the gate. The **First Guardian** blocks your path. This is a straightforward fight — stay behind it and attack the glowing weak point on its back. It telegraphs its slam attack by raising both arms, giving you about 2 seconds to dodge.\n\n**Strategy:** Use the pillars for cover during its ranged phase. When it kneels (around 30% HP), unleash everything you have.\n\n**Reward:** Guardian's Key — opens the north gate to Chapter 2.\n\n<!-- checkpoint: guardian-defeated | Defeated the First Guardian -->",
      "checkpoints": [
        { "id": "village-explored", "label": "Explored Oakhaven Village" },
        { "id": "collectibles-secured", "label": "Secured missable collectibles" },
        { "id": "guardian-defeated", "label": "Defeated the First Guardian" }
      ],
      "steps": [
        {
          "id": "step-001",
          "type": "step",
          "text": "Pick up the **Starting Item** from the chest behind the merchant."
        },
        {
          "id": "step-002",
          "type": "warning",
          "text": "Do NOT open the red door yet — it locks you out of a collectible.",
          "note": "Come back after completing the side quest in Chapter 2."
        },
        {
          "id": "step-003",
          "type": "collectible",
          "text": "Grab the **Missable Trophy Item** behind the waterfall.",
          "note": "Only available before the end of Chapter 1."
        },
        {
          "id": "step-004",
          "type": "boss",
          "text": "**BOSS: The First Guardian** — Stay behind it and attack the glowing weak point.",
          "note": "Reward: Guardian's Key"
        }
      ]
    }
  ]
}
```
