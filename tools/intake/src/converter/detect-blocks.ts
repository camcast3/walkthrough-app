/**
 * Classifies markdown tokens into walkthrough block types.
 * Uses rule-based detection with confidence scoring.
 * NEVER modifies content — only assigns types.
 */

import { MarkdownToken, parseTable } from './markdown-parser.js';
import { BlockType, WalkthroughBlock } from '../types.js';
import { TrainingDatabase } from '../types.js';

interface DetectionContext {
  heading_above?: string;
  heading_level?: number;
  surrounding_types: BlockType[];
  source_site?: string;
}

interface DetectionResult {
  block_type: BlockType;
  confidence: number;
}

// ── Encounter detection ─────────────────────────────────────────────────────

const ENCOUNTER_HEADING_PATTERNS = [
  /boss:\s*/i,
  /boss fight/i,
  /mini.?boss/i,
  /battle:\s*/i,
  /encounter:\s*/i,
];

const ENCOUNTER_STAT_COLUMNS = ['hp', 'weakness', 'level', 'exp', 'mira', 'drops'];

function isEncounterTable(headers: string[]): boolean {
  const lowerHeaders = headers.map(h => h.toLowerCase());
  return ENCOUNTER_STAT_COLUMNS.some(col => lowerHeaders.includes(col));
}

/** Infer column names for tables without headers based on row content patterns. */
function inferColumnNames(colCount: number, rows: string[][]): string[] {
  if (colCount === 0) return ['Item'];
  if (colCount === 1) return ['Item'];
  if (colCount === 2) {
    // Check if second column looks like locations
    const locationLike = rows.filter(r => r[1] && /highway|shrine|path|bridge|fort|castle|store|shop|cave|mountain|area|floor|entrance|section/i.test(r[1]));
    if (locationLike.length > rows.length * 0.3) return ['Item', 'Location'];
    return ['Item', 'Details'];
  }
  if (colCount === 3) return ['Item', 'Details', 'Location'];
  // Generic fallback
  return Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`);
}

// ── Callout detection ───────────────────────────────────────────────────────

const CALLOUT_PATTERNS = [
  /^(warning|caution|danger|important|note|tip)[\s:!]/i,
  /^⚠/,
  /^\*\*(warning|note|important|caution|tip)\*\*/i,
];

// ── Quest detection ─────────────────────────────────────────────────────────

const QUEST_PATTERNS = [
  /quest:\s*/i,
  /side quest/i,
  /hidden quest/i,
  /main quest/i,
  /missable quest/i,
];

const QUEST_HEADING_PATTERNS = [
  /story quest/i,
  /hidden quest/i,
  /side quest/i,
  /main quest/i,
  /^quest:/i,
];

/** Returns true if the block's primary focus IS a quest (not just a passing mention) */
function isQuestFocused(content: string): boolean {
  // If quest-related keyword appears in the first 60 chars, it's likely the focus
  const start = content.slice(0, 60).toLowerCase();
  if (/quest|objective|reward/.test(start)) return true;
  // If "hidden quest" or "side quest" only appears at the tail end, it's a passing mention
  const lastQuestIndex = Math.max(
    content.toLowerCase().lastIndexOf('quest'),
    content.toLowerCase().lastIndexOf('side quest'),
  );
  // If the quest mention is in the last 20% of the text, it's just a passing mention
  if (lastQuestIndex > content.length * 0.8) return false;
  return true;
}

const COLLECTIBLE_PATTERNS = [
  /gambler jack/i,
  /limited time.{0,30}(collect|obtain|buy|get)/i,
  /very limited time frame/i,
  /be sure to collect/i,
  /collecting all.{0,20}(volumes|copies)/i,
  /\breceipe\b.*\bmissable\b|\bmissable\b.*\brecipe\b/i,
  /purchase the\b.{0,40}\brecipe\b/i,
  /\brecipe\b.{0,40}\bpurchase\b/i,
  /\bhidden quest\b.{0,40}\bspeak to\b/i,
];

// ── Event detection (bonding, missable conversations, time-limited cutscenes) ─

const EVENT_HEADING_PATTERNS = [
  /^bonding event/i,
  /^bond event/i,
  /^free time/i,
  /^optional event/i,
  /^missable event/i,
  /^conversation:/i,
];

const EVENT_BODY_PATTERNS = [
  /bonding event/i,
  /missable (?:conversation|event|cutscene)/i,
  /one-?time (?:conversation|event|cutscene)/i,
  /only available (?:during|on|in)/i,
  /will be lost if/i,
  /permanently miss(?:able|ed)?/i,
];

const MISSABLE_KEYWORDS = /\b(missable|missed|permanently lost|permanently miss|one[- ]?time|only available|expires?|locked out)\b/i;

// ── Checklist detection ─────────────────────────────────────────────────────

const CHECKLIST_ITEM_PATTERNS = [
  /^\s*[-*]\s+.*\(.*location.*\)/i,
  /^\s*[-*]\s+\[[ x]\]/i,
  /^\s*\d+\.\s+.*—\s+/,
  // Bullet with bold name (collectible, NPC, or location list)
  /^\s*[-*]\s+\*\*[^*]+\*\*/,
  // Bullet with "Name - Location" or "Name — Location" pattern
  /^\s*[-*]\s+\S.+\s[-–—]\s+\S/,
  // Numbered items with a dash/colon separator
  /^\s*\d+\.\s+\S.+\s[-–—:]\s+\S/,
];

function looksLikeChecklist(content: string): boolean {
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  // Must have at least 3 non-empty lines
  if (lines.length < 3) return false;
  const bulletLines = lines.filter(l => /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l));
  // If most lines are bullets/numbered items, check patterns
  if (bulletLines.length >= 3 && bulletLines.length / lines.length >= 0.6) {
    // Check if items follow a consistent pattern (name-location, bold items, etc.)
    const matchCount = bulletLines.filter(line =>
      CHECKLIST_ITEM_PATTERNS.some(p => p.test(line))
    ).length;
    return matchCount >= 3 || (matchCount / bulletLines.length) > 0.5;
  }
  return false;
}

// ── Main detection ──────────────────────────────────────────────────────────

export function detectBlockType(
  token: MarkdownToken,
  context: DetectionContext,
  training: TrainingDatabase | null,
): DetectionResult {
  // 1. Check training corrections first (highest priority)
  if (training && training.examples.length > 0) {
    const trainedResult = checkTrainingRules(token, context, training);
    if (trainedResult) return trainedResult;
  }

  // 2. Pattern-based detection
  switch (token.type) {
    case 'table':
      return detectTableType(token, context);
    case 'blockquote':
      return { block_type: 'callout', confidence: 0.85 };
    case 'list':
      return detectListType(token, context);
    case 'paragraph':
      return detectParagraphType(token, context);
    case 'heading':
      // Headings below H2 are absorbed into prose blocks
      return { block_type: 'prose', confidence: 0.9 };
    default:
      return { block_type: 'prose', confidence: 0.7 };
  }
}

function detectTableType(token: MarkdownToken, context: DetectionContext): DetectionResult {
  const table = parseTable(token.content);

  // Check heading for quest designation — quest data often comes as tables
  if (context.heading_above && QUEST_HEADING_PATTERNS.some(p => p.test(context.heading_above!))) {
    return { block_type: 'quest', confidence: 0.85 };
  }

  // Check if this is an encounter stats table
  if (isEncounterTable(table.headers)) {
    return { block_type: 'encounter', confidence: 0.9 };
  }

  // Check if rows contain HP stats (compound table split — no proper header)
  const allCells = [...table.rows.flat(), ...table.headers];
  if (allCells.some(cell => /HP:\s*\d+/i.test(cell))) {
    return { block_type: 'encounter', confidence: 0.85 };
  }

  // Check if the heading above suggests an encounter
  if (context.heading_above && ENCOUNTER_HEADING_PATTERNS.some(p => p.test(context.heading_above!))) {
    return { block_type: 'encounter', confidence: 0.8 };
  }

  return { block_type: 'table', confidence: 0.85 };
}

function detectListType(token: MarkdownToken, _context: DetectionContext): DetectionResult {
  if (looksLikeChecklist(token.content)) {
    return { block_type: 'checklist', confidence: 0.75 };
  }
  return { block_type: 'prose', confidence: 0.7 };
}

function detectParagraphType(token: MarkdownToken, context: DetectionContext): DetectionResult {
  // Check for callout patterns
  if (CALLOUT_PATTERNS.some(p => p.test(token.content))) {
    return { block_type: 'callout', confidence: 0.85 };
  }

  // Check for collectible/missable item callouts
  if (COLLECTIBLE_PATTERNS.some(p => p.test(token.content))) {
    return { block_type: 'callout', confidence: 0.8 };
  }

  // Check for event patterns (bonding events, missable conversations, etc.)
  if (context.heading_above && EVENT_HEADING_PATTERNS.some(p => p.test(context.heading_above!))) {
    return { block_type: 'event', confidence: 0.85 };
  }
  if (EVENT_BODY_PATTERNS.some(p => p.test(token.content))) {
    return { block_type: 'event', confidence: 0.75 };
  }

  // Check heading for quest designation (e.g. "Story Quest: Herbal Remedies")
  if (context.heading_above && QUEST_HEADING_PATTERNS.some(p => p.test(context.heading_above!))) {
    return { block_type: 'quest', confidence: 0.85 };
  }

  // Check for quest patterns — only if the block's primary purpose IS the quest
  // (not just a passing mention like "you can do a hidden quest")
  if (QUEST_PATTERNS.some(p => p.test(token.content)) && isQuestFocused(token.content)) {
    return { block_type: 'quest', confidence: 0.75 };
  }

  // Check heading context for encounter
  if (context.heading_above && ENCOUNTER_HEADING_PATTERNS.some(p => p.test(context.heading_above!))) {
    return { block_type: 'encounter', confidence: 0.7 };
  }

  // Check for structured bullet lists that should be checklists
  if (looksLikeChecklist(token.content)) {
    return { block_type: 'checklist', confidence: 0.75 };
  }

  return { block_type: 'prose', confidence: 0.9 };
}

function checkTrainingRules(
  token: MarkdownToken,
  context: DetectionContext,
  training: TrainingDatabase,
): DetectionResult | null {
  // Skip junk-like training examples (ad content that shouldn't inform classification)
  const JUNK_TRAINING_PATTERNS = [
    /ad-?block/i, /ad-free/i, /subscription/i, /support.*neoseeker/i,
    /click here to upgrade/i, /advertisement/i, /^last edited by\b/i,
  ];

  // Find matching examples by context similarity
  const matches = training.examples.filter(ex => {
    // Exclude junk examples that should never have been recorded
    if (JUNK_TRAINING_PATTERNS.some(p => p.test(ex.source_pattern))) return false;

    if (context.heading_above && ex.context.heading_above) {
      return ENCOUNTER_HEADING_PATTERNS.some(p =>
        p.test(context.heading_above!) && p.test(ex.context.heading_above!)
      );
    }
    // Match by source pattern substring
    return token.content.includes(ex.source_pattern.slice(0, 50));
  });

  if (matches.length > 0) {
    // Use the most common correction
    const corrections = matches.map(m => m.user_corrected_to);
    const mostCommon = mode(corrections);
    return { block_type: mostCommon, confidence: 0.85 + (matches.length * 0.02) };
  }

  return null;
}

function mode(arr: BlockType[]): BlockType {
  const counts = new Map<BlockType, number>();
  for (const item of arr) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  let max = 0;
  let result: BlockType = 'prose';
  for (const [key, count] of counts) {
    if (count > max) {
      max = count;
      result = key;
    }
  }
  return result;
}

// ── Block construction ──────────────────────────────────────────────────────

export function buildBlock(token: MarkdownToken, blockType: BlockType, context: DetectionContext): WalkthroughBlock {
  // Strip markdown image links from all headings
  const heading = context.heading_above ? stripMarkdownImages(context.heading_above) || undefined : undefined;

  switch (blockType) {
    case 'prose':
      return {
        type: 'prose',
        heading,
        content: token.content,
      };

    case 'encounter': {
      if (token.type === 'table') {
        const table = parseTable(token.content);
        const stats: Record<string, string> = {};
        let name: string;
        let strategy: string | undefined;

        // Check if we have proper headers with stat columns
        if (isEncounterTable(table.headers)) {
          name = extractEncounterName(token, context);
          if (table.rows.length > 0) {
            table.headers.forEach((h, i) => {
              if (table.rows[0][i]) stats[h] = table.rows[0][i];
            });
          }
          // Extract real boss name from boss-type labels in stats
          const bossLabels = ['Trial Chest Boss', 'Boss', 'Enemy', 'Mini-Boss', 'Mini Boss', 'Field Boss'];
          for (const label of bossLabels) {
            if (stats[label]) {
              name = stats[label];
              delete stats[label];
              break;
            }
          }
        } else {
          // Compound table split: rows contain key-value pairs like "HP: 45225"
          // First row typically has the boss name + HP + Item Drop
          const allRows = table.headers.length > 0
            ? [table.headers, ...table.rows]
            : table.rows;

          name = allRows[0]?.[0] || extractEncounterName(token, context);

          for (const row of allRows) {
            for (const cell of row) {
              const kvMatch = cell.match(/^(.+?):\s*(.+)$/);
              if (kvMatch) {
                stats[kvMatch[1].trim()] = kvMatch[2].trim();
              }
            }
            // Check for long prose rows (strategy text)
            if (row.length === 1 && row[0].length > 150) {
              strategy = row[0];
            } else if (row.filter(c => c !== '').length === 1) {
              const text = row.find(c => c !== '') || '';
              if (text.length > 150) {
                strategy = text;
              }
            }
          }

          // Extract real boss name from boss-type labels in stats
          const bossLabels = ['Trial Chest Boss', 'Boss', 'Enemy', 'Mini-Boss', 'Mini Boss', 'Field Boss'];
          for (const label of bossLabels) {
            if (stats[label]) {
              name = stats[label];
              delete stats[label];
              break;
            }
          }
        }

        return {
          type: 'encounter',
          heading,
          name,
          stats: Object.keys(stats).length > 0 ? stats : undefined,
          strategy,
        };
      }
      const name = extractEncounterName(token, context);
      return { type: 'encounter', heading, name, strategy: token.content };
    }

    case 'quest': {
      // If this was originally a table token, extract quest data from rows
      let questContent = token.content;
      if (token.type === 'table') {
        const table = parseTable(token.content);
        const allRows = table.headers.length > 0 && !table.headers.every(h => h.trim() === '')
          ? [table.headers, ...table.rows]
          : table.rows;
        // Extract named fields from KV-style rows (e.g. ["Quest Name", "Highlands Hunt"])
        const kvRows = allRows.filter(r => r.length >= 2 && r[0].trim().length > 0);
        questContent = kvRows.map(r => r.slice(1).join(', ')).join('\n');
      }
      const questName = extractQuestName(token, context);
      return {
        type: 'quest',
        heading,
        quest_type: detectQuestType(questContent, context),
        name: questName,
        content: questContent,
        missable_window: extractMissableWindow(questContent),
      };
    }

    case 'event': {
      return {
        type: 'event',
        heading,
        event_type: detectEventType(token.content, context),
        name: extractEventName(token, context),
        trigger: extractEventTrigger(token.content),
        availability: extractMissableWindow(token.content),
        missable: MISSABLE_KEYWORDS.test(token.content) ||
                  (context.heading_above ? /missable/i.test(context.heading_above) : false),
        content: token.content,
      };
    }

    case 'table': {
      const table = parseTable(token.content);
      // Trim trailing empty cells from all rows
      const trimRow = (row: string[]): string[] => {
        let end = row.length;
        while (end > 0 && row[end - 1].trim() === '') end--;
        return end === row.length ? row : row.slice(0, end);
      };
      table.headers = trimRow(table.headers);
      table.rows = table.rows.map(trimRow);
      // Detect if "headers" are actually data (no real column names)
      const colCount = table.headers.length;
      const allHeadersEmpty = colCount === 0 || table.headers.every(h => h.trim() === '');

      // No headers at all — infer columns from row data
      if (colCount === 0) {
        const maxCols = table.rows.reduce((max, r) => Math.max(max, r.length), 0);
        const inferredColumns = inferColumnNames(maxCols, table.rows);
        return {
          type: 'table',
          heading,
          columns: inferredColumns,
          rows: table.rows,
        };
      }

      const headersAreData = (
        // Headers are all empty or blank strings
        allHeadersEmpty ||
        // Headers contain numeric/data patterns
        table.headers.some(h =>
          /\d{2,}|,\s|x\s*\d|\.\s*$/.test(h) || h.length > 40
        ) ||
        // Header/row cell count mismatch — rows have different width than headers
        (table.rows.length > 0 && (
          table.rows[0].length < colCount || table.rows[0].length > colCount
        ))
      );
      if (headersAreData) {
        // Don't include empty/blank headers as a data row
        const extraRows = allHeadersEmpty ? [] : [table.headers];
        const dataRows = [...extraRows, ...table.rows];
        // Generate column names from row width (schema requires minItems: 1)
        const maxCols = dataRows.reduce((max, r) => Math.max(max, r.length), 0);
        const inferredColumns = inferColumnNames(maxCols, dataRows);
        return {
          type: 'table',
          heading,
          columns: inferredColumns,
          rows: dataRows,
        };
      }
      return {
        type: 'table',
        heading,
        columns: table.headers,
        rows: table.rows,
      };
    }

    case 'checklist': {
      const items = parseChecklistItems(token.content);
      return { type: 'checklist', heading, items };
    }

    case 'callout':
      return {
        type: 'callout',
        severity: detectCalloutSeverity(token.content),
        content: token.content.replace(/^(warning|note|important|caution|tip)[\s:!]*/i, ''),
      };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractEncounterName(token: MarkdownToken, context: DetectionContext): string {
  if (context.heading_above) {
    const cleaned = stripMarkdownImages(context.heading_above);
    const match = cleaned.match(/boss:\s*(.+)/i) ||
                  cleaned.match(/battle:\s*(.+)/i) ||
                  cleaned.match(/encounter:\s*(.+)/i);
    if (match) return match[1].trim();
    if (cleaned.trim()) return cleaned.trim();
  }
  // Try to extract name from stats-style table content (e.g. "Trial Chest Boss: Senior Bear Mole")
  const bossMatch = token.content.match(/(?:trial chest boss|boss|enemy|name):\s*(.+)/i);
  if (bossMatch) return bossMatch[1].trim().split('|')[0].trim();
  // Try first cell of the table if it's not a stat key-value
  const firstLine = token.content.split('\n')[0];
  const firstCell = firstLine.replace(/^\|?\s*/, '').split('|')[0].trim();
  if (firstCell && !firstCell.includes(':') && firstCell.length < 60) return firstCell;
  return 'Encounter';
}

function extractQuestName(token: MarkdownToken, context: DetectionContext): string {
  const match = token.content.match(/(?:quest|side quest):\s*(.+)/i);
  if (match) return stripMarkdownImages(match[1]).trim();
  if (context.heading_above) {
    const cleaned = stripMarkdownImages(context.heading_above);
    if (cleaned.trim()) return cleaned.trim();
  }
  // Try to extract from content first sentence
  const firstSentence = token.content.split(/[.\n]/)[0];
  if (firstSentence && firstSentence.length < 80) return stripMarkdownImages(firstSentence).trim();
  return 'Quest';
}

/** Strips markdown image syntax [![alt](url)](url) and ![alt](url) from text */
function stripMarkdownImages(text: string): string {
  // [![alt](imgUrl)](linkUrl)
  text = text.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '');
  // ![alt](url)
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  return text.trim();
}

function detectQuestType(
  content: string,
  context: DetectionContext,
): 'main' | 'side' | 'missable' | 'hidden' | 'story' {
  const haystack = `${context.heading_above ?? ''}\n${content}`;
  // Missable check first — a "missable side quest" is more useful tagged as missable.
  if (/missable\s+(?:side\s+)?quest/i.test(haystack) ||
      (/side quest/i.test(haystack) && MISSABLE_KEYWORDS.test(content))) {
    return 'missable';
  }
  if (/hidden quest/i.test(haystack)) return 'hidden';
  if (/side quest/i.test(haystack)) return 'side';
  if (/main quest/i.test(haystack)) return 'main';
  return 'story';
}

function detectEventType(
  content: string,
  context: DetectionContext,
): 'bonding' | 'conversation' | 'cutscene' | 'collectible' | 'other' {
  const haystack = `${context.heading_above ?? ''}\n${content}`;
  if (/bond(?:ing)? event/i.test(haystack)) return 'bonding';
  if (/conversation|dialogue|talk to/i.test(haystack)) return 'conversation';
  if (/cutscene|scene/i.test(haystack)) return 'cutscene';
  if (/chest|pickup|collectible|item/i.test(haystack)) return 'collectible';
  return 'other';
}

function extractEventName(token: MarkdownToken, context: DetectionContext): string {
  if (context.heading_above) {
    const cleaned = stripMarkdownImages(context.heading_above);
    if (cleaned.trim()) {
      return cleaned
        .replace(/^(bonding event|bond event|optional event|missable event|conversation):\s*/i, '')
        .trim();
    }
  }
  const match = token.content.match(/(?:bonding event|conversation|cutscene):\s*(.+)/i);
  if (match) return stripMarkdownImages(match[1]).trim();
  // Try to derive a name from the first meaningful sentence
  const firstLine = token.content.split(/\n/)[0].trim();
  if (firstLine && firstLine.length < 80) return stripMarkdownImages(firstLine).trim();
  return 'Event';
}

function extractEventTrigger(content: string): string | undefined {
  // "Trigger: X" or "Talk to X at Y"
  const trigger = content.match(/trigger:\s*(.+?)(?:\n|$)/i);
  if (trigger) return trigger[1].trim();
  const talkTo = content.match(/[Tt]alk to\s+([A-Z][^.\n]{2,80})/);
  if (talkTo) return talkTo[1].trim();
  return undefined;
}

function extractMissableWindow(content: string): string | undefined {
  // "Available during Chapter 1" / "Only available on Day 2" / "Before X event"
  const patterns = [
    /only available (?:during|on|in)\s+([^.\n]+)/i,
    /available (?:during|on|in)\s+([^.\n]+)/i,
    /before\s+(?:the\s+)?([^.\n]+?)\s+(?:event|battle|cutscene|ends?)/i,
    /must be done (?:by|before|during)\s+([^.\n]+)/i,
    /(?:missable|lost|unavailable)\s+(?:if|once|when|after)\s+(?:you\s+)?([^.\n]+)/i,
  ];
  for (const p of patterns) {
    const m = content.match(p);
    if (m) return m[1].trim();
  }
  return undefined;
}

function detectCalloutSeverity(content: string): 'info' | 'warning' | 'danger' {
  if (/danger|critical/i.test(content)) return 'danger';
  if (/warning|caution/i.test(content)) return 'warning';
  return 'info';
}

function parseChecklistItems(content: string): Array<{ id: string; label: string; detail?: string }> {
  const lines = content.split('\n').filter(l => /^\s*[-*+]\s/.test(l) || /^\s*\d+\.\s/.test(l));
  return lines.map((line, i) => {
    const text = line.replace(/^\s*[-*+]\s+/, '').replace(/^\s*\d+\.\s+/, '').trim();
    // Split on " — ", " – ", or " - " (but not leading dash)
    const dashSplit = text.split(/\s[-–—]\s/);
    return {
      id: `item-${i + 1}`,
      label: dashSplit[0].trim(),
      detail: dashSplit.slice(1).join(' — ').trim() || undefined,
    };
  });
}
