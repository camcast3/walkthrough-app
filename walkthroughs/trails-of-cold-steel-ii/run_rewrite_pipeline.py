#!/usr/bin/env python3
"""
Section-by-section rewrite pipeline runner.

Usage:
  python run_rewrite_pipeline.py                   # Process all sections
  python run_rewrite_pipeline.py prologue          # Process single section by ID
  python run_rewrite_pipeline.py --list            # List all sections
  python run_rewrite_pipeline.py --status          # Show which sections have been rewritten

This script generates the prompt for the @section-rewrite agent for each section.
You can then invoke the agent manually or in batch.

Each section is processed independently, allowing parallel runs and incremental progress.
"""

import json
import os
import sys
import argparse

BASE = os.path.dirname(os.path.abspath(__file__))
WALKTHROUGH_FILE = os.path.join(BASE, "main-walkthrough.json")
OUTPUT_DIR = os.path.join(BASE, "rewritten-sections")
SOURCE_URL = "https://www.neoseeker.com/the-legend-of-heroes-trails-of-cold-steel-ii/walkthrough"
GAME_NAME = "The Legend of Heroes: Trails of Cold Steel II"

# Section mapping: (page_file, section_id, title, id_prefix)
SECTIONS = [
    ("page1.md",  "prologue",        "Prologue",              "pro"),
    ("page2.md",  "act-1-part-1",    "Act 1 - Part 1",        "a1p1"),
    ("page3.md",  "act-1-part-2",    "Act 1 - Part 2",        "a1p2"),
    ("page4.md",  "act-1-part-3",    "Act 1 - Part 3",        "a1p3"),
    ("page5.md",  "intermission",    "Intermission Chapter",   "int"),
    ("page6.md",  "act-2-part-1",    "Act 2 - Part 1",        "a2p1"),
    ("page7.md",  "act-2-part-2",    "Act 2 - Part 2",        "a2p2"),
    ("page8.md",  "act-2-part-3",    "Act 2 - Part 3",        "a2p3"),
    ("page9.md",  "act-2-part-4",    "Act 2 - Part 4",        "a2p4"),
    ("page10.md", "finale",          "Finale",                 "fin"),
    ("page11.md", "geofront",        "Geofront E",             "geo"),
    ("page12.md", "epilogue",        "Epilogue",               "epi"),
]


def get_section_json(section_id: str) -> dict | None:
    """Extract a section from the main walkthrough JSON."""
    with open(WALKTHROUGH_FILE, "r", encoding="utf-8") as f:
        wt = json.load(f)
    for section in wt["sections"]:
        if section["id"] == section_id:
            return section
    return None


def section_is_rewritten(section_id: str) -> bool:
    """Check if a section has already been rewritten."""
    path = os.path.join(OUTPUT_DIR, f"{section_id}.json")
    return os.path.exists(path)


def generate_prompt(page_file: str, section_id: str, title: str, prefix: str) -> str:
    """Generate the @section-rewrite agent prompt for a given section."""
    source_path = os.path.join(BASE, page_file)
    output_path = os.path.join(OUTPUT_DIR, f"{section_id}.json")

    return f"""Rewrite the **{title}** section of {GAME_NAME} walkthrough.

**Source markdown:** `{source_path}`
**Current section:** Extract "{section_id}" from `{WALKTHROUGH_FILE}`
**Output path:** `{output_path}`

**Section metadata:**
- id: `{section_id}`
- title: `{title}`
- id-prefix: `{prefix}`

**Game:** {GAME_NAME}
**Source URL:** {SOURCE_URL}

**Instructions:**
- Convert excessive numbered/bullet lists into flowing narrative prose
- Preserve ALL information (quests, items, NPCs, directions, strategies)
- Ensure every prose block has a descriptive heading
- Keep encounter/quest/table/checklist/callout blocks well-structured
- Target 80%+ headed prose blocks for progress tracking
- Write the output to `{output_path}`
"""


def assemble_rewritten(dry_run: bool = False) -> None:
    """Assemble all rewritten sections back into main-walkthrough.json."""
    with open(WALKTHROUGH_FILE, "r", encoding="utf-8") as f:
        wt = json.load(f)

    updated = 0
    for i, section in enumerate(wt["sections"]):
        rewritten_path = os.path.join(OUTPUT_DIR, f"{section['id']}.json")
        if os.path.exists(rewritten_path):
            with open(rewritten_path, "r", encoding="utf-8") as f:
                new_section = json.load(f)
            if not dry_run:
                wt["sections"][i] = new_section
            updated += 1
            print(f"  ✅ {section['id']} — replaced with rewritten version")
        else:
            print(f"  ⏳ {section['id']} — not yet rewritten, keeping original")

    if not dry_run and updated > 0:
        with open(WALKTHROUGH_FILE, "w", encoding="utf-8") as f:
            json.dump(wt, f, indent=2, ensure_ascii=False)
        print(f"\n✅ Assembled {updated} rewritten sections into {WALKTHROUGH_FILE}")
    elif dry_run:
        print(f"\n[DRY RUN] Would assemble {updated} sections")
    else:
        print("\n⚠️  No rewritten sections found. Run the pipeline first.")


def main():
    parser = argparse.ArgumentParser(description="Section rewrite pipeline runner")
    parser.add_argument("section", nargs="?", help="Section ID to process (or 'all')")
    parser.add_argument("--list", action="store_true", help="List all sections")
    parser.add_argument("--status", action="store_true", help="Show rewrite status")
    parser.add_argument("--prompt", action="store_true", help="Print the agent prompt for a section")
    parser.add_argument("--assemble", action="store_true", help="Assemble rewritten sections into main JSON")
    parser.add_argument("--dry-run", action="store_true", help="Preview assembly without writing")
    args = parser.parse_args()

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if args.list:
        print(f"\n{'ID':<20} {'Title':<25} {'Page':<12} {'Prefix'}")
        print("─" * 70)
        for page, sid, title, prefix in SECTIONS:
            print(f"{sid:<20} {title:<25} {page:<12} {prefix}")
        return

    if args.status:
        print(f"\nSection Rewrite Status:")
        print("─" * 50)
        done = 0
        for page, sid, title, prefix in SECTIONS:
            status = "✅ Done" if section_is_rewritten(sid) else "⏳ Pending"
            if section_is_rewritten(sid):
                done += 1
            print(f"  {status}  {sid:<20} {title}")
        print(f"\n  Progress: {done}/{len(SECTIONS)} sections rewritten")
        return

    if args.assemble:
        assemble_rewritten(dry_run=args.dry_run)
        return

    if args.section:
        # Find the matching section
        match = None
        for page, sid, title, prefix in SECTIONS:
            if sid == args.section:
                match = (page, sid, title, prefix)
                break

        if not match:
            print(f"❌ Unknown section: {args.section}")
            print(f"   Valid sections: {', '.join(s[1] for s in SECTIONS)}")
            sys.exit(1)

        page, sid, title, prefix = match
        prompt = generate_prompt(page, sid, title, prefix)

        if args.prompt:
            print(prompt)
        else:
            print(f"\n📋 Agent prompt for @section-rewrite ({title}):")
            print("═" * 60)
            print(prompt)
            print("═" * 60)
            print(f"\nTo run: invoke @section-rewrite with the above prompt")
            print(f"Output will be written to: {OUTPUT_DIR}/{sid}.json")
    else:
        # Show all prompts
        print(f"\n🔄 Section Rewrite Pipeline — {GAME_NAME}")
        print(f"   Source: {SOURCE_URL}")
        print(f"   Sections: {len(SECTIONS)}")
        print(f"   Output dir: {OUTPUT_DIR}/")
        print()

        for page, sid, title, prefix in SECTIONS:
            status = "✅" if section_is_rewritten(sid) else "⏳"
            print(f"  {status} {sid:<20} {title}")

        print(f"\nUsage:")
        print(f"  python {os.path.basename(__file__)} <section-id> --prompt   # Get agent prompt")
        print(f"  python {os.path.basename(__file__)} --status                # Check progress")
        print(f"  python {os.path.basename(__file__)} --assemble              # Merge results back")


if __name__ == "__main__":
    main()
