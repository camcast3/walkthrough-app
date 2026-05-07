#!/usr/bin/env python3
"""Assemble section JSON files into the final main-walkthrough.json."""
import json, sys
from pathlib import Path

BASE = Path("walkthroughs/trails-of-cold-steel-ii")
OUTPUT = BASE / "main-walkthrough.json"

SECTIONS_ORDER = [
    "section-prologue.json",
    "section-act-1-part-1.json",
    "section-act-1-part-2.json",
    "section-act-1-part-3.json",
    "section-act-1-part-4.json",
    "section-act-1-finale.json",
    "section-act-2-part-1.json",
    "section-act-2-part-2.json",
    "section-act-2-part-3.json",
    "section-act-2-finale.json",
    "section-finale.json",
    "section-epilogue.json",
]

walkthrough = {
    "$schema": "../walkthrough.schema.json",
    "id": "trails-of-cold-steel-ii-main",
    "game": "The Legend of Heroes: Trails of Cold Steel II",
    "title": "Main Story Walkthrough",
    "author": "Neoseeker",
    "source_url": "https://www.neoseeker.com/the-legend-of-heroes-trails-of-cold-steel-ii/walkthrough",
    "attribution": "This walkthrough was pulled from Neoseeker (neoseeker.com) and processed for a cleaner reading experience. All credit for the original content goes to the Neoseeker community.",
    "created_at": "2026-05-06",
    "cover_image": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1v85.jpg",
    "hltb": {"main_story": 46.5, "main_story_sides": 71.5, "completionist": 101.0},
    "sections": []
}

missing = []
total_cp = total_steps = total_coll = total_miss = total_sq = 0

for fname in SECTIONS_ORDER:
    path = BASE / fname
    if not path.exists():
        missing.append(fname)
        print(f"  MISSING: {fname}", file=sys.stderr)
        continue
    section = json.loads(path.read_text(encoding="utf-8"))
    walkthrough["sections"].append(section)
    content = section.get("content", "")
    cp = len(section.get("checkpoints", []))
    st = len(section.get("steps", []))
    co = content.count("<!-- collectible:")
    mi = content.count("<!-- missable:")
    sq = content.count("<!-- side_quest:")
    total_cp += cp; total_steps += st; total_coll += co; total_miss += mi; total_sq += sq
    print(f"  {section['id']}: {cp} cp, {st} steps, {co} coll, {mi} miss, {sq} sq", file=sys.stderr)

if missing:
    print(f"\n⚠ Missing {len(missing)} section files: {missing}", file=sys.stderr)
    sys.exit(1)

OUTPUT.write_text(json.dumps(walkthrough, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"\n{'='*50}", file=sys.stderr)
print(f"  Sections: {len(walkthrough['sections'])}", file=sys.stderr)
print(f"  Checkpoints: {total_cp}", file=sys.stderr)
print(f"  Steps: {total_steps}", file=sys.stderr)
print(f"  Collectibles: {total_coll}", file=sys.stderr)
print(f"  Missables: {total_miss}", file=sys.stderr)
print(f"  Side quests: {total_sq}", file=sys.stderr)
print(f"  Output: {OUTPUT}", file=sys.stderr)
print(f"{'='*50}", file=sys.stderr)
