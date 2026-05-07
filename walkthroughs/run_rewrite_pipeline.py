#!/usr/bin/env python3
"""
Generic section-by-section rewrite pipeline runner.

Works with ANY walkthrough that has a pipeline.json config file.

Usage (from any walkthrough directory):
  python run_rewrite_pipeline.py                   # Show overview & usage
  python run_rewrite_pipeline.py prologue          # Show prompt for section
  python run_rewrite_pipeline.py prologue --prompt # Print raw agent prompt
  python run_rewrite_pipeline.py --list            # List all sections
  python run_rewrite_pipeline.py --status          # Show rewrite progress
  python run_rewrite_pipeline.py --assemble        # Merge results back
  python run_rewrite_pipeline.py --init            # Create pipeline.json from existing walkthrough

Setup for a new walkthrough:
  1. Create a pipeline.json in the walkthrough directory (or use --init)
  2. Add source page*.md files
  3. Run sections through @section-rewrite agent individually
  4. Assemble results back into main-walkthrough.json
"""

import json
import os
import sys
import re
import argparse

BASE = os.getcwd()
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE, "pipeline.json")
OUTPUT_DIR = os.path.join(BASE, "rewritten-sections")


def load_config() -> dict:
    """Load pipeline.json config, or auto-detect from main-walkthrough.json."""
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)

    # Auto-detect from main-walkthrough.json
    wt_file = os.path.join(BASE, "main-walkthrough.json")
    if not os.path.exists(wt_file):
        print("❌ No pipeline.json or main-walkthrough.json found.")
        print(f"   Run from a walkthrough directory or use --init to create config.")
        sys.exit(1)

    with open(wt_file, "r", encoding="utf-8") as f:
        wt = json.load(f)

    # Build sections from the walkthrough JSON + any page*.md files present
    page_files = sorted(
        [f for f in os.listdir(BASE) if re.match(r"page\d+\.md$", f)],
        key=lambda x: int(re.search(r"\d+", x).group())
    )

    sections = []
    for i, section in enumerate(wt.get("sections", [])):
        page = page_files[i] if i < len(page_files) else None
        sid = section["id"]
        title = section["title"]
        # Generate prefix from section id (abbreviation)
        parts = sid.replace("-", " ").split()
        if len(parts) == 1:
            prefix = parts[0][:3]
        else:
            prefix = "".join(p[0] for p in parts[:4])
        sections.append({
            "page": page,
            "id": sid,
            "title": title,
            "prefix": prefix
        })

    return {
        "game": wt.get("game", "Unknown Game"),
        "source_url": wt.get("source_url", ""),
        "walkthrough_file": "main-walkthrough.json",
        "sections": sections
    }


def init_config() -> None:
    """Create a pipeline.json from existing main-walkthrough.json."""
    if os.path.exists(CONFIG_FILE):
        print(f"⚠️  pipeline.json already exists at {CONFIG_FILE}")
        print("   Delete it first if you want to regenerate.")
        return

    config = load_config()  # This auto-detects
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    print(f"✅ Created {CONFIG_FILE}")
    print(f"   Game: {config['game']}")
    print(f"   Sections: {len(config['sections'])}")
    print(f"\n   Edit pipeline.json to customize section mappings, prefixes, and source URL.")


def section_is_rewritten(section_id: str) -> bool:
    """Check if a section has already been rewritten."""
    path = os.path.join(OUTPUT_DIR, f"{section_id}.json")
    return os.path.exists(path)


def generate_prompt(config: dict, section: dict) -> str:
    """Generate the @section-rewrite agent prompt for a given section."""
    wt_file = os.path.join(BASE, config["walkthrough_file"])
    output_path = os.path.join(OUTPUT_DIR, f"{section['id']}.json")

    source_line = ""
    if section.get("page"):
        source_path = os.path.join(BASE, section["page"])
        source_line = f"**Source markdown:** `{source_path}`"
    else:
        source_line = "**Source markdown:** (no source page — rewrite from current JSON content)"

    return f"""Rewrite the **{section['title']}** section of {config['game']} walkthrough.

{source_line}
**Current section:** Extract "{section['id']}" from `{wt_file}`
**Output path:** `{output_path}`

**Section metadata:**
- id: `{section['id']}`
- title: `{section['title']}`
- id-prefix: `{section['prefix']}`

**Game:** {config['game']}
**Source URL:** {config['source_url']}

**Instructions:**
- Convert excessive numbered/bullet lists into flowing narrative prose
- Preserve ALL information (quests, items, NPCs, directions, strategies)
- Ensure every prose block has a descriptive heading
- Keep encounter/quest/table/checklist/callout blocks well-structured
- Target 80%+ headed prose blocks for progress tracking
- Write the output to `{output_path}`
"""


def assemble_rewritten(config: dict, dry_run: bool = False) -> None:
    """Assemble all rewritten sections back into main-walkthrough.json."""
    wt_file = os.path.join(BASE, config["walkthrough_file"])
    with open(wt_file, "r", encoding="utf-8") as f:
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
        with open(wt_file, "w", encoding="utf-8") as f:
            json.dump(wt, f, indent=2, ensure_ascii=False)
        print(f"\n✅ Assembled {updated} rewritten sections into {wt_file}")
    elif dry_run:
        print(f"\n[DRY RUN] Would assemble {updated} sections")
    else:
        print("\n⚠️  No rewritten sections found. Run the pipeline first.")


def main():
    parser = argparse.ArgumentParser(
        description="Generic section-by-section rewrite pipeline runner",
        epilog="Run from any walkthrough directory with page*.md files and main-walkthrough.json"
    )
    parser.add_argument("section", nargs="?", help="Section ID to process")
    parser.add_argument("--list", action="store_true", help="List all sections")
    parser.add_argument("--status", action="store_true", help="Show rewrite status")
    parser.add_argument("--prompt", action="store_true", help="Print raw agent prompt (for piping)")
    parser.add_argument("--assemble", action="store_true", help="Assemble rewritten sections into main JSON")
    parser.add_argument("--dry-run", action="store_true", help="Preview assembly without writing")
    parser.add_argument("--init", action="store_true", help="Create pipeline.json from existing walkthrough")
    args = parser.parse_args()

    if args.init:
        init_config()
        return

    config = load_config()
    sections = config["sections"]
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if args.list:
        print(f"\n{'ID':<20} {'Title':<25} {'Page':<12} {'Prefix'}")
        print("─" * 70)
        for s in sections:
            page = s.get("page") or "—"
            print(f"{s['id']:<20} {s['title']:<25} {page:<12} {s['prefix']}")
        return

    if args.status:
        print(f"\nSection Rewrite Status — {config['game']}")
        print("─" * 55)
        done = 0
        for s in sections:
            is_done = section_is_rewritten(s["id"])
            status = "✅ Done" if is_done else "⏳ Pending"
            if is_done:
                done += 1
            print(f"  {status}  {s['id']:<20} {s['title']}")
        print(f"\n  Progress: {done}/{len(sections)} sections rewritten")
        return

    if args.assemble:
        assemble_rewritten(config, dry_run=args.dry_run)
        return

    if args.section:
        # Find the matching section
        match = None
        for s in sections:
            if s["id"] == args.section:
                match = s
                break

        if not match:
            print(f"❌ Unknown section: {args.section}")
            print(f"   Valid sections: {', '.join(s['id'] for s in sections)}")
            sys.exit(1)

        prompt = generate_prompt(config, match)

        if args.prompt:
            print(prompt)
        else:
            print(f"\n📋 Agent prompt for @section-rewrite ({match['title']}):")
            print("═" * 60)
            print(prompt)
            print("═" * 60)
            print(f"\nTo run: invoke @section-rewrite with the above prompt")
            print(f"Output: {OUTPUT_DIR}/{match['id']}.json")
    else:
        # Show overview
        print(f"\n🔄 Section Rewrite Pipeline — {config['game']}")
        print(f"   Source: {config['source_url']}")
        print(f"   Sections: {len(sections)}")
        print(f"   Output: {OUTPUT_DIR}/")
        print()

        for s in sections:
            status = "✅" if section_is_rewritten(s["id"]) else "⏳"
            print(f"  {status} {s['id']:<20} {s['title']}")

        print(f"\nCommands:")
        print(f"  python {os.path.basename(__file__)} <section-id>            # Show agent prompt")
        print(f"  python {os.path.basename(__file__)} <section-id> --prompt   # Raw prompt (for piping)")
        print(f"  python {os.path.basename(__file__)} --status                # Check progress")
        print(f"  python {os.path.basename(__file__)} --assemble              # Merge results back")
        print(f"  python {os.path.basename(__file__)} --init                  # Create pipeline.json")


if __name__ == "__main__":
    main()
