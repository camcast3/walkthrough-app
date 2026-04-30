# Walkthrough Ingestion Skill

## Description
Converts any online game walkthrough into the standardized walkthrough JSON format used by the Walkthrough Checklist App. The output is a valid JSON file ready to commit to the `/walkthroughs/` directory.

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

### Output
A single valid JSON file matching the schema. Output the JSON in a code block with the suggested file path as a comment above it.

### Rules

1. **Always include attribution.** The `attribution` field MUST say something like:
   > "This walkthrough was pulled from [Author/Site] ([url]) and processed for a cleaner reading experience. All credit for the original content goes to [Author/Site]."

2. **Generate a slug ID** for the walkthrough using the pattern `<game-slug>-<type>`, e.g. `elden-ring-main`, `hollow-knight-achievements`. Use only lowercase letters, numbers, and hyphens.

3. **Break content into sections** that map to major game areas, chapters, or phases. Each section needs a unique slug `id` and a human-readable `title`.

4. **Classify each step** using the correct `type`:
   - `step` — a standard checkable action the player takes
   - `note` — informational text, tips, lore. NOT checkable.
   - `warning` — something the player must not miss or must be careful about
   - `collectible` — a missable item, trophy, achievement trigger
   - `boss` — a boss fight. Include the boss name in bold in the `text` field.

5. **Keep step text concise.** Each step should be one action or one piece of information. Split long paragraphs into multiple steps. Use **bold** for item names, boss names, and key locations.

6. **Add a `note` field** when the original walkthrough has important supplemental info for that step (tips, warnings, quantities, coordinates). Keep notes short.

7. **Suggested file path** format: `walkthroughs/<game-slug>/<walkthrough-slug>.json`
   - Example: `walkthroughs/elden-ring/main-walkthrough.json`

8. **`created_at`** should be today's date in `YYYY-MM-DD` format.

9. **Validate your output** mentally against the schema before presenting it:
   - All required fields present
   - All `id` fields are lowercase slugs with no spaces
   - `source_url` is a valid URI
   - `sections` array has at least one entry
   - Each `steps` array has at least one entry

### Example prompt
> "Please convert this walkthrough: https://example.com/game-walkthrough"

### Example output

```
// Suggested path: walkthroughs/example-game/main-walkthrough.json
{
  "$schema": "../../walkthrough.schema.json",
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
      "steps": [
        {
          "id": "step-001",
          "type": "step",
          "text": "Pick up the **Starting Item** from the chest."
        },
        {
          "id": "step-002",
          "type": "warning",
          "text": "Do NOT open the red door yet — it locks you out of a collectible.",
          "note": "Come back after completing the side quest."
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
