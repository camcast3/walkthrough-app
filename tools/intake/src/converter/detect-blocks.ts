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
];

function looksLikeChecklist(content: string): boolean {
  const lines = content.split('\n');
  const matchCount = lines.filter(line =>
    CHECKLIST_ITEM_PATTERNS.some(p => p.test(line))
  ).length;
  return matchCount >= 3 || (matchCount / lines.length) > 0.5;
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

  // Check if this is an encounter stats table
  if (isEncounterTable(table.headers)) {
    return { block_type: 'encounter', confidence: 0.9 };
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

  // Check for event patterns (bonding events, missable conversations, etc.)
  // — checked before quest patterns because "missable side quest" should still
  //   classify as quest, but a "bonding event" heading should win.
  if (context.heading_above && EVENT_HEADING_PATTERNS.some(p => p.test(context.heading_above!))) {
    return { block_type: 'event', confidence: 0.85 };
  }
  if (EVENT_BODY_PATTERNS.some(p => p.test(token.content))) {
    return { block_type: 'event', confidence: 0.75 };
  }

  // Check for quest patterns
  if (QUEST_PATTERNS.some(p => p.test(token.content))) {
    return { block_type: 'quest', confidence: 0.75 };
  }

  // Check heading context for encounter
  if (context.heading_above && ENCOUNTER_HEADING_PATTERNS.some(p => p.test(context.heading_above!))) {
    return { block_type: 'encounter', confidence: 0.7 };
  }

  return { block_type: 'prose', confidence: 0.9 };
}

function checkTrainingRules(
  token: MarkdownToken,
  context: DetectionContext,
  training: TrainingDatabase,
): DetectionResult | null {
  // Find matching examples by context similarity
  const matches = training.examples.filter(ex => {
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
  switch (blockType) {
    case 'prose':
      return {
        type: 'prose',
        heading: context.heading_above,
        content: token.content,
      };

    case 'encounter': {
      const name = extractEncounterName(token, context);
      if (token.type === 'table') {
        const table = parseTable(token.content);
        const stats: Record<string, string> = {};
        if (table.rows.length > 0) {
          table.headers.forEach((h, i) => {
            if (table.rows[0][i]) stats[h] = table.rows[0][i];
          });
        }
        return { type: 'encounter', heading: context.heading_above, name, stats };
      }
      return { type: 'encounter', heading: context.heading_above, name, strategy: token.content };
    }

    case 'quest': {
      const questName = extractQuestName(token, context);
      return {
        type: 'quest',
        heading: context.heading_above,
        quest_type: detectQuestType(token.content, context),
        name: questName,
        content: token.content,
        missable_window: extractMissableWindow(token.content),
      };
    }

    case 'event': {
      return {
        type: 'event',
        heading: context.heading_above,
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
      return {
        type: 'table',
        heading: context.heading_above,
        columns: table.headers,
        rows: table.rows,
      };
    }

    case 'checklist': {
      const items = parseChecklistItems(token.content);
      return { type: 'checklist', heading: context.heading_above, items };
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
    const match = context.heading_above.match(/boss:\s*(.+)/i) ||
                  context.heading_above.match(/battle:\s*(.+)/i) ||
                  context.heading_above.match(/encounter:\s*(.+)/i);
    if (match) return match[1].trim();
    return context.heading_above;
  }
  return 'Unknown Encounter';
}

function extractQuestName(token: MarkdownToken, context: DetectionContext): string {
  const match = token.content.match(/(?:quest|side quest):\s*(.+)/i);
  if (match) return match[1].trim();
  if (context.heading_above) return context.heading_above;
  return 'Unknown Quest';
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
    // Strip common prefixes like "Bonding Event: " to leave the name.
    return context.heading_above
      .replace(/^(bonding event|bond event|optional event|missable event|conversation):\s*/i, '')
      .trim();
  }
  const match = token.content.match(/(?:bonding event|conversation|cutscene):\s*(.+)/i);
  if (match) return match[1].trim();
  return 'Unknown Event';
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
    const dashSplit = text.split(' — ');
    return {
      id: `item-${i + 1}`,
      label: dashSplit[0].trim(),
      detail: dashSplit[1]?.trim(),
    };
  });
}
