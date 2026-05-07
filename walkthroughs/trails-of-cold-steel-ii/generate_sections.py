#!/usr/bin/env python3
"""Convert page*.md files to section JSON files using blocks format, then assemble."""
import json
import re
import os

BASE = os.path.dirname(os.path.abspath(__file__))

# Section mapping: (filename, section_id, title, id_prefix)
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


def slugify(text):
    """Convert text to a valid ID slug."""
    text = text.lower().strip()
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    text = re.sub(r'[\s]+', '-', text)
    text = re.sub(r'-+', '-', text)
    text = text.strip('-')
    return text


def parse_md_table(lines):
    """Parse markdown table lines into (columns, rows)."""
    if len(lines) < 2:
        return None, None
    header_line = lines[0].strip().strip('|')
    cols = [c.strip() for c in header_line.split('|')]
    cols = [c for c in cols if c]
    
    rows = []
    for line in lines[2:]:  # skip header and separator
        line = line.strip().strip('|')
        if not line:
            continue
        cells = [c.strip() for c in line.split('|')]
        cells = [c for c in cells if c != '']
        # Pad or trim to match columns
        while len(cells) < len(cols):
            cells.append('')
        cells = cells[:len(cols)]
        rows.append(cells)
    return cols, rows


def extract_boss_stats(lines):
    """Try to extract boss stats from a markdown table."""
    stats = {}
    for line in lines:
        line = line.strip().strip('|')
        if not line or line.startswith(':') or line.startswith('---'):
            continue
        # Skip separator lines
        if is_separator_line('|' + line + '|'):
            continue
        parts = [p.strip() for p in line.split('|')]
        parts = [p for p in parts if p]
        if len(parts) >= 2:
            key = parts[0].strip('*').strip()
            val = parts[1].strip('*').strip()
            # Skip header rows and non-stat rows
            if key.lower() in ('stat', 'boss', 'enemy', 'stance', 'difficulty', '#', 'name', 'module',
                               'rean\'s level', 'rean\'s rank', 'carry over / bonus', 'activity',
                               'character', 'item', 'item/quest', 'achievement'):
                continue
            # Skip separator-like keys
            if re.match(r'^[\s:|-]+$', key):
                continue
            stats[key] = val
    return stats


def is_table_line(line):
    return line.strip().startswith('|') and '|' in line.strip()[1:]


def is_separator_line(line):
    stripped = line.strip().strip('|').strip()
    return bool(re.match(r'^[\s:|-]+$', stripped)) and '---' in stripped


class SectionBuilder:
    def __init__(self, section_id, title, prefix):
        self.section_id = section_id
        self.title = title
        self.prefix = prefix
        self.blocks = []
        self.checkpoints = []
        self.checkpoint_counter = 0

    def add_checkpoint(self, label):
        self.checkpoint_counter += 1
        cp_id = f"{self.prefix}-cp-{self.checkpoint_counter}"
        self.checkpoints.append({"id": cp_id, "label": label})
        return cp_id

    def add_prose(self, heading, content):
        if not content.strip():
            return
        block = {"type": "prose", "content": content.strip()}
        if heading:
            block["heading"] = heading
        self.blocks.append(block)

    def add_encounter(self, name, stats=None, strategy=None, reward=None, drops=None, heading=None):
        block = {"type": "encounter", "name": name}
        if heading:
            block["heading"] = heading
        if stats:
            block["stats"] = stats
        if strategy:
            block["strategy"] = strategy
        if reward:
            block["reward"] = reward
        if drops:
            block["drops"] = drops
        self.blocks.append(block)

    def add_quest(self, name, quest_type="side", client=None, content=None, reward=None):
        block = {"type": "quest", "quest_type": quest_type, "name": name}
        if client:
            block["client"] = client
        if content:
            block["content"] = content
        if reward:
            block["reward"] = reward
        self.blocks.append(block)

    def add_table(self, heading, columns, rows):
        if not columns or not rows:
            return
        self.blocks.append({
            "type": "table",
            "heading": heading,
            "columns": columns,
            "rows": rows
        })

    def add_checklist(self, heading, style, items):
        if not items:
            return
        self.blocks.append({
            "type": "checklist",
            "heading": heading,
            "style": style,
            "items": items
        })

    def add_callout(self, content, severity="info"):
        if not content.strip():
            return
        self.blocks.append({
            "type": "callout",
            "severity": severity,
            "content": content.strip()
        })

    def build(self):
        result = {
            "id": self.section_id,
            "title": self.title,
            "blocks": self.blocks,
        }
        if self.checkpoints:
            result["checkpoints"] = self.checkpoints
        return result


def parse_markdown_to_blocks(md_text, builder):
    """Parse markdown text and populate builder with blocks."""
    lines = md_text.split('\n')
    i = 0
    n = len(lines)

    current_heading = None
    prose_buffer = []

    def flush_prose():
        nonlocal prose_buffer, current_heading
        text = '\n'.join(prose_buffer).strip()
        if text:
            builder.add_prose(current_heading, text)
            current_heading = None
        prose_buffer = []

    def collect_table_lines(start):
        """Collect consecutive table lines starting from index start."""
        tlines = []
        j = start
        while j < n and is_table_line(lines[j]):
            tlines.append(lines[j])
            j += 1
        return tlines, j

    while i < n:
        line = lines[i]
        stripped = line.strip()

        # Skip the top-level title lines
        if stripped.startswith('# ') and 'Trails of Cold Steel' in stripped:
            i += 1
            continue
        if stripped.startswith('## ') and i < 3:
            # Section subtitle at top
            i += 1
            continue

        # --- Horizontal rules (section dividers)
        if stripped == '---':
            flush_prose()
            i += 1
            continue

        # --- Headings
        heading_match = re.match(r'^(#{1,6})\s+(.*)', stripped)
        if heading_match:
            level = len(heading_match.group(1))
            heading_text = heading_match.group(2).strip()

            # Check if this is a boss heading
            boss_match = re.match(r'(?:Boss(?:\s+Fight)?:\s*)(.*)', heading_text, re.IGNORECASE)
            if not boss_match:
                boss_match = re.match(r'(?:Final\s+Boss:\s*)(.*)', heading_text, re.IGNORECASE)

            # Check if this is a quest heading
            quest_match = re.match(r'(?:Side\s+Quest|Hidden\s+Quest|Story\s+Quest):\s*(.*)', heading_text, re.IGNORECASE)

            if boss_match:
                flush_prose()
                boss_name = boss_match.group(1).strip()
                # Collect boss info until next heading or horizontal rule
                i += 1
                boss_lines = []
                while i < n:
                    s = lines[i].strip()
                    if s == '---':
                        break
                    if re.match(r'^#{1,4}\s+', s):
                        # Check if this is sub-info for the boss
                        sub_heading = re.match(r'^#{1,6}\s+(.*)', s)
                        if sub_heading:
                            sh = sub_heading.group(1).strip()
                            if any(kw in sh.lower() for kw in ['strategy', 'boss skill', 'preparation', 'stances']):
                                boss_lines.append(lines[i])
                                i += 1
                                continue
                            else:
                                break
                    boss_lines.append(lines[i])
                    i += 1

                # Parse boss info
                stats = {}
                strategy_lines = []
                table_lines = []
                other_lines = []
                in_strategy = False
                reward = None

                for bline in boss_lines:
                    bs = bline.strip()
                    if is_table_line(bline):
                        table_lines.append(bline)
                        continue
                    if bs.lower().startswith('**strategy') or bs.lower().startswith('strategy:'):
                        in_strategy = True
                        # Extract strategy text after the heading
                        after = re.sub(r'\*\*Strategy:?\*\*:?\s*', '', bs, flags=re.IGNORECASE).strip()
                        if after:
                            strategy_lines.append(after)
                        continue
                    if bs.lower().startswith('**reward') or bs.lower().startswith('*   **reward'):
                        rw = re.sub(r'\*\*Reward:?\*\*:?\s*', '', bs, flags=re.IGNORECASE).strip()
                        rw = rw.lstrip('*').lstrip().lstrip(':').strip()
                        reward = rw
                        continue
                    if in_strategy:
                        if bs.startswith('**') and not bs.startswith('**Strategy'):
                            in_strategy = False
                            other_lines.append(bline)
                        else:
                            strategy_lines.append(bs.lstrip('> ').lstrip('* ').lstrip('- '))
                    else:
                        other_lines.append(bline)

                # Parse stats from table
                if table_lines:
                    stats = extract_boss_stats(table_lines)

                strategy_text = '\n'.join(s for s in strategy_lines if s.strip()).strip()

                # Add remaining non-table, non-strategy text to strategy
                extra = '\n'.join(l.strip() for l in other_lines if l.strip() and not is_separator_line(l)).strip()
                if extra and not strategy_text:
                    strategy_text = extra
                elif extra and strategy_text:
                    strategy_text = strategy_text + '\n\n' + extra

                # Add checkpoint for boss
                cp_id = builder.add_checkpoint(f"Boss: {boss_name}")
                cp_marker = f"<!-- checkpoint: {cp_id} | Boss: {boss_name} -->"

                builder.add_encounter(
                    name=boss_name,
                    heading=f"Boss: {boss_name}",
                    stats=stats if stats else None,
                    strategy=strategy_text if strategy_text else None,
                    reward=reward,
                )
                continue

            elif quest_match:
                flush_prose()
                quest_name = quest_match.group(1).strip()
                quest_type = "side"
                if 'hidden' in heading_text.lower():
                    quest_type = "hidden"
                elif 'story' in heading_text.lower():
                    quest_type = "story"

                # Collect quest info
                i += 1
                quest_lines = []
                while i < n:
                    s = lines[i].strip()
                    if s == '---':
                        break
                    if re.match(r'^#{1,3}\s+', s):
                        break
                    quest_lines.append(lines[i])
                    i += 1

                # Parse quest details
                client = None
                reward = None
                content_lines = []
                for ql in quest_lines:
                    qs = ql.strip()
                    client_m = re.match(r'\*\s*\*\*Client:?\*\*:?\s*(.*)', qs)
                    if client_m:
                        client = client_m.group(1).strip().rstrip('.')
                        continue
                    reward_m = re.match(r'\*\s*\*\*Reward:?\*\*:?\s*(.*)', qs)
                    if reward_m:
                        reward = reward_m.group(1).strip().rstrip('.')
                        continue
                    content_lines.append(qs)

                quest_content = '\n'.join(l for l in content_lines if l).strip()

                builder.add_quest(
                    name=quest_name,
                    quest_type=quest_type,
                    client=client,
                    content=quest_content if quest_content else None,
                    reward=reward,
                )
                continue

            else:
                # Regular heading
                flush_prose()

                # Check for checkpoint-worthy headings
                checkpoint_keywords = ['december', 'november', 'march', 'prologue', 'ymir',
                                       'legram', 'bareahard', 'roer', 'celdic', 'nord',
                                       'courageous', 'geofront', 'infernal castle', 
                                       'reverie corridor', 'final mission', 'aurochs']
                if level <= 3 and any(kw in heading_text.lower() for kw in checkpoint_keywords):
                    cp_id = builder.add_checkpoint(heading_text)

                current_heading = heading_text
                i += 1
                continue

        # --- Blockquotes with boss info
        if stripped.startswith('> **Boss:') or stripped.startswith('> *   **Boss:'):
            flush_prose()
            boss_match = re.search(r'Boss:\s*(.*?)(?:\*\*|$)', stripped)
            if boss_match:
                boss_name = boss_match.group(1).strip()
                # Collect all blockquote lines
                i += 1
                bq_lines = [stripped]
                while i < n and (lines[i].strip().startswith('>') or lines[i].strip().startswith('*   >')):
                    bq_lines.append(lines[i].strip())
                    i += 1

                # Parse stats and strategy from blockquote
                stats = {}
                strategy_parts = []
                for bql in bq_lines:
                    bql = bql.lstrip('> ').strip()
                    hp_m = re.search(r'\*\*HP\*\*:?\s*([0-9,]+)', bql)
                    if hp_m:
                        stats['HP'] = hp_m.group(1)
                    elem_m = re.search(r'\*\*Elemental Efficacy\*\*:?\s*(.*)', bql)
                    if elem_m:
                        stats['Elemental Efficacy'] = elem_m.group(1).strip()
                    strat_m = re.search(r'\*\*Strategy\*\*:?\s*(.*)', bql)
                    if strat_m:
                        strategy_parts.append(strat_m.group(1).strip())
                    elif 'strategy' not in bql.lower() and 'boss:' not in bql.lower():
                        strategy_parts.append(bql)

                strategy = '\n'.join(s for s in strategy_parts if s).strip()
                builder.add_encounter(
                    name=boss_name,
                    stats=stats if stats else None,
                    strategy=strategy if strategy else None,
                )
                continue

        # --- Callouts (blockquotes with warnings/tips/notes)
        if stripped.startswith('> **Warning') or stripped.startswith('> **Tip') or stripped.startswith('> **Note') or stripped.startswith('> **Important'):
            flush_prose()
            severity = "info"
            if 'warning' in stripped.lower() or 'important' in stripped.lower():
                severity = "warning"
            elif 'danger' in stripped.lower():
                severity = "danger"

            callout_lines = [stripped.lstrip('> ').strip()]
            i += 1
            while i < n and lines[i].strip().startswith('>'):
                callout_lines.append(lines[i].strip().lstrip('> ').strip())
                i += 1
            builder.add_callout('\n'.join(callout_lines), severity)
            continue

        # --- Standalone tables
        if is_table_line(line):
            flush_prose()
            tlines, next_i = collect_table_lines(i)
            if len(tlines) >= 3:
                cols, rows = parse_md_table(tlines)
                if cols and rows:
                    table_heading = current_heading or "Data"
                    current_heading = None
                    builder.add_table(table_heading, cols, rows)
            i = next_i
            continue

        # --- Missable lists (detect pattern)
        if '**Missable' in stripped or 'Missable List' in stripped or 'Missable Items' in stripped:
            flush_prose()
            heading_text = stripped.strip('#').strip().strip('*').strip()
            i += 1
            # Collect items
            items = []
            item_counter = 0
            while i < n:
                s = lines[i].strip()
                if s == '---' or (re.match(r'^#{1,4}\s+', s) and 'missable' not in s.lower()):
                    break
                if is_table_line(s):
                    # Table-format missable list
                    tlines, next_i = collect_table_lines(i)
                    if len(tlines) >= 3:
                        cols, rows = parse_md_table(tlines)
                        if cols and rows:
                            for row in rows:
                                item_counter += 1
                                item_id = f"{builder.prefix}-miss-{item_counter}"
                                label = row[0].strip('*').strip() if row else "Item"
                                detail = row[1] if len(row) > 1 else ""
                                items.append({"id": item_id, "label": label, "detail": detail})
                    i = next_i
                    continue
                # Bullet-format missable list
                bullet_m = re.match(r'[\*\-]\s+(.*)', s)
                if bullet_m:
                    item_counter += 1
                    item_id = f"{builder.prefix}-miss-{item_counter}"
                    items.append({"id": item_id, "label": bullet_m.group(1).strip()})
                i += 1
            if items:
                builder.add_checklist(heading_text, "missable", items)
            continue

        # --- Regular content → prose buffer
        prose_buffer.append(line)
        i += 1

    # Flush any remaining prose
    flush_prose()


def build_section(filename, section_id, title, prefix):
    """Build a section JSON object from a markdown file."""
    filepath = os.path.join(BASE, filename)
    with open(filepath, 'r', encoding='utf-8') as f:
        md_text = f.read()
    
    # Strip markdown code fences if present
    md_text = re.sub(r'^```markdown\s*\n?', '', md_text)
    md_text = re.sub(r'\n```\s*$', '', md_text)
    
    # Handle duplicated content: some files have the content pasted twice 
    # with a ```markdown fence in the middle. Take the second (complete) copy.
    dup_match = re.search(r'```markdown\s*\n(#\s+The Legend of Heroes)', md_text)
    if dup_match:
        md_text = md_text[dup_match.start(1):].rstrip()
    
    builder = SectionBuilder(section_id, title, prefix)
    parse_markdown_to_blocks(md_text, builder)

    # Ensure minimum 3 blocks
    if len(builder.blocks) < 3:
        # Add a callout if we're short
        builder.add_callout(f"Continue with {title}.", "info")

    return builder.build()


def main():
    all_sections = []
    
    for filename, section_id, title, prefix in SECTIONS:
        print(f"Processing {filename} -> {section_id}...")
        section = build_section(filename, section_id, title, prefix)
        
        # Write individual section file
        section_file = os.path.join(BASE, f"section-{section_id}.json")
        with open(section_file, 'w', encoding='utf-8') as f:
            json.dump(section, f, indent=2, ensure_ascii=False)
        
        block_count = len(section.get('blocks', []))
        cp_count = len(section.get('checkpoints', []))
        print(f"  -> {block_count} blocks, {cp_count} checkpoints")
        
        all_sections.append(section)

    # Assemble full walkthrough
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
        "sections": all_sections
    }

    output_file = os.path.join(BASE, "main-walkthrough.json")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(walkthrough, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*50}")
    print(f"  Total sections: {len(all_sections)}")
    total_blocks = sum(len(s.get('blocks', [])) for s in all_sections)
    total_cps = sum(len(s.get('checkpoints', [])) for s in all_sections)
    print(f"  Total blocks: {total_blocks}")
    print(f"  Total checkpoints: {total_cps}")
    print(f"  Output: {output_file}")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
