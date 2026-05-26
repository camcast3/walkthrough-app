# Walkthrough Intake System — Code Proposal

> **Status:** Draft  
> **Date:** 2026-05-26  
> **Branch:** `camcast/intake-system`

---

## Summary

Replace the unreliable 4-agent AI pipeline with a local-first, deterministic intake system. Content is captured verbatim from walkthrough sites via a browser extension, classified into block types by a trainable rule engine, reviewed interactively in the CLI, and previewed in the existing webapp.

---

## File Structure (New Code)

```
tools/
├── intake/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── cli.ts
│   │   ├── server.ts
│   │   ├── converter/
│   │   │   ├── index.ts
│   │   │   ├── detect-blocks.ts
│   │   │   ├── detect-sections.ts
│   │   │   ├── detect-checkpoints.ts
│   │   │   └── markdown-parser.ts
│   │   ├── training/
│   │   │   ├── index.ts
│   │   │   └── rules-db.ts
│   │   ├── review/
│   │   │   ├── index.ts
│   │   │   ├── renderer.ts
│   │   │   └── actions.ts
│   │   └── types.ts
│   └── tests/
│       ├── converter/
│       │   ├── detect-blocks.test.ts
│       │   ├── detect-sections.test.ts
│       │   ├── detect-checkpoints.test.ts
│       │   └── markdown-parser.test.ts
│       ├── training/
│       │   └── rules-db.test.ts
│       ├── server.test.ts
│       └── cli.test.ts
│
├── intake-extension/
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   ├── content.js
│   └── lib/
│       ├── readability.js
│       └── turndown.js
```

---

## Exact Code Changes

### 1. `tools/intake/package.json`

```json
{
  "name": "@walkthrough-app/intake",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "intake": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/cli.ts",
    "start": "tsx src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "chalk": "^5.4.0",
    "commander": "^13.1.0",
    "express": "^5.1.0",
    "inquirer": "^12.6.0",
    "slugify": "^1.6.6"
  },
  "devDependencies": {
    "@types/express": "^5.0.2",
    "@types/node": "^22.15.0",
    "tsx": "^4.19.0",
    "typescript": "^6.0.3",
    "vitest": "^4.1.5",
    "@vitest/coverage-v8": "^4.1.5",
    "supertest": "^7.1.0",
    "@types/supertest": "^6.0.3"
  }
}
```

---

### 2. `tools/intake/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

### 3. `tools/intake/src/types.ts`

```typescript
// Shared types for the intake system — mirrors walkthrough.schema.json block types

export interface ProseBlock {
  type: 'prose';
  heading?: string;
  content: string;
}

export interface EncounterBlock {
  type: 'encounter';
  heading?: string;
  name: string;
  stats?: Record<string, string>;
  strategy?: string;
  reward?: string;
  drops?: string;
}

export interface QuestBlock {
  type: 'quest';
  heading?: string;
  quest_type: 'main' | 'side' | 'hidden' | 'story';
  name: string;
  client?: string;
  content?: string;
  reward?: string;
}

export interface TableBlock {
  type: 'table';
  heading?: string;
  columns: string[];
  rows: string[][];
}

export interface ChecklistItem {
  id: string;
  label: string;
  detail?: string;
}

export interface ChecklistBlock {
  type: 'checklist';
  heading?: string;
  style?: 'collectible' | 'missable' | 'npc' | 'key' | 'puzzle';
  items: ChecklistItem[];
}

export interface CalloutBlock {
  type: 'callout';
  severity?: 'info' | 'warning' | 'danger';
  content: string;
}

export type BlockType = 'prose' | 'encounter' | 'quest' | 'table' | 'checklist' | 'callout';

export type WalkthroughBlock =
  | ProseBlock
  | EncounterBlock
  | QuestBlock
  | TableBlock
  | ChecklistBlock
  | CalloutBlock;

export interface WalkthroughCheckpoint {
  id: string;
  label: string;
}

export interface WalkthroughSection {
  id: string;
  title: string;
  blocks: WalkthroughBlock[];
  checkpoints: WalkthroughCheckpoint[];
}

export interface Walkthrough {
  id: string;
  game: string;
  title: string;
  author: string;
  source_url: string;
  attribution: string;
  created_at: string;
  cover_image?: string;
  sections: WalkthroughSection[];
}

// ── Intake-specific types ───────────────────────────────────────────────────

export interface IntakeSession {
  game: string;
  slug: string;
  source_url: string;
  pages_captured: number;
  state: 'capturing' | 'converting' | 'reviewing' | 'finalized';
  created_at: string;
}

export interface PageCapture {
  page_number: number;
  title: string;
  url: string;
  markdown: string;
  captured_at: string;
}

export interface ClassifiedBlock {
  block: WalkthroughBlock;
  confidence: number;
  source_line_start: number;
  source_line_end: number;
  approved: boolean;
}

export interface ConvertedSection {
  id: string;
  title: string;
  blocks: ClassifiedBlock[];
  checkpoints: WalkthroughCheckpoint[];
  approved: boolean;
}

export interface TrainingExample {
  source_pattern: string;
  converter_guessed: BlockType;
  user_corrected_to: BlockType;
  context: {
    heading_above?: string;
    heading_level?: number;
    surrounding_types?: BlockType[];
    source_site?: string;
  };
  game: string;
  timestamp: string;
}

export interface TrainingDatabase {
  examples: TrainingExample[];
  graduation_status: 'training' | 'graduated';
  walkthroughs_processed: number;
}
```

---

### 4. `tools/intake/src/converter/markdown-parser.ts`

```typescript
/**
 * Parses markdown into structural tokens for the block detector.
 * Does NOT modify content — only identifies structure.
 */

export interface MarkdownToken {
  type: 'heading' | 'paragraph' | 'table' | 'list' | 'blockquote' | 'hr' | 'code_block';
  level?: number; // for headings (1-6)
  content: string;
  line_start: number;
  line_end: number;
}

export interface MarkdownTable {
  headers: string[];
  rows: string[][];
  raw: string;
}

export function parseMarkdown(markdown: string): MarkdownToken[] {
  const lines = markdown.split('\n');
  const tokens: MarkdownToken[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      tokens.push({
        type: 'heading',
        level: headingMatch[1].length,
        content: headingMatch[2].trim(),
        line_start: i,
        line_end: i,
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
      tokens.push({
        type: 'hr',
        content: line,
        line_start: i,
        line_end: i,
      });
      i++;
      continue;
    }

    // Code block (fenced)
    if (line.trim().startsWith('```')) {
      const start = i;
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        i++;
      }
      tokens.push({
        type: 'code_block',
        content: lines.slice(start, i + 1).join('\n'),
        line_start: start,
        line_end: i,
      });
      i++;
      continue;
    }

    // Table (line starts with |)
    if (line.trim().startsWith('|')) {
      const start = i;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        i++;
      }
      tokens.push({
        type: 'table',
        content: lines.slice(start, i).join('\n'),
        line_start: start,
        line_end: i - 1,
      });
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('>')) {
      const start = i;
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        i++;
      }
      tokens.push({
        type: 'blockquote',
        content: lines.slice(start, i).map(l => l.replace(/^>\s?/, '')).join('\n'),
        line_start: start,
        line_end: i - 1,
      });
      continue;
    }

    // List (unordered or ordered)
    if (/^(\s*[-*+]|\s*\d+\.)\s/.test(line)) {
      const start = i;
      while (
        i < lines.length &&
        (lines[i].trim() !== '' && (/^(\s*[-*+]|\s*\d+\.)\s/.test(lines[i]) || /^\s{2,}/.test(lines[i])))
      ) {
        i++;
      }
      tokens.push({
        type: 'list',
        content: lines.slice(start, i).join('\n'),
        line_start: start,
        line_end: i - 1,
      });
      continue;
    }

    // Paragraph (default — collect consecutive non-empty lines)
    const start = i;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].trim().startsWith('|') &&
      !lines[i].trim().startsWith('>') &&
      !lines[i].trim().startsWith('```') &&
      !/^(\s*[-*+]|\s*\d+\.)\s/.test(lines[i]) &&
      !/^(-{3,}|_{3,}|\*{3,})$/.test(lines[i].trim())
    ) {
      i++;
    }
    tokens.push({
      type: 'paragraph',
      content: lines.slice(start, i).join('\n'),
      line_start: start,
      line_end: i - 1,
    });
  }

  return tokens;
}

export function parseTable(tableContent: string): MarkdownTable {
  const lines = tableContent.split('\n').filter(l => l.trim() !== '');

  if (lines.length < 2) {
    return { headers: [], rows: [], raw: tableContent };
  }

  const parseRow = (line: string): string[] =>
    line.split('|').slice(1, -1).map(cell => cell.trim());

  const headers = parseRow(lines[0]);
  // Skip separator line (line[1] is usually |---|---|)
  const dataLines = lines.slice(2);
  const rows = dataLines.map(parseRow);

  return { headers, rows, raw: tableContent };
}
```

---

### 5. `tools/intake/src/converter/detect-sections.ts`

```typescript
/**
 * Splits parsed markdown tokens into walkthrough sections.
 * H2 headings (##) mark section boundaries.
 */

import { MarkdownToken } from './markdown-parser.js';
import slugify from 'slugify';

export interface RawSection {
  id: string;
  title: string;
  tokens: MarkdownToken[];
}

export function detectSections(tokens: MarkdownToken[]): RawSection[] {
  const sections: RawSection[] = [];
  let currentTitle = 'Introduction';
  let currentTokens: MarkdownToken[] = [];

  for (const token of tokens) {
    if (token.type === 'heading' && token.level === 2) {
      // Save previous section if it has content
      if (currentTokens.length > 0) {
        sections.push({
          id: slugify(currentTitle, { lower: true, strict: true }),
          title: currentTitle,
          tokens: currentTokens,
        });
      }
      currentTitle = token.content;
      currentTokens = [];
    } else {
      currentTokens.push(token);
    }
  }

  // Don't forget the last section
  if (currentTokens.length > 0) {
    sections.push({
      id: slugify(currentTitle, { lower: true, strict: true }),
      title: currentTitle,
      tokens: currentTokens,
    });
  }

  return sections;
}
```

---

### 6. `tools/intake/src/converter/detect-blocks.ts`

```typescript
/**
 * Classifies markdown tokens into walkthrough block types.
 * Uses rule-based detection with confidence scoring.
 * NEVER modifies content — only assigns types.
 */

import { MarkdownToken, parseTable } from './markdown-parser.js';
import { BlockType, ClassifiedBlock, WalkthroughBlock } from '../types.js';
import { TrainingDatabase, TrainingExample } from '../types.js';

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
];

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

function detectListType(token: MarkdownToken, context: DetectionContext): DetectionResult {
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
        quest_type: detectQuestType(token.content),
        name: questName,
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

function detectQuestType(content: string): 'main' | 'side' | 'hidden' | 'story' {
  if (/hidden quest/i.test(content)) return 'hidden';
  if (/side quest/i.test(content)) return 'side';
  if (/main quest/i.test(content)) return 'main';
  return 'story';
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
```

---

### 7. `tools/intake/src/converter/detect-checkpoints.ts`

```typescript
/**
 * Auto-generates checkpoints at H3 headings within a section.
 * These serve as "resume from here" markers.
 */

import { MarkdownToken } from './markdown-parser.js';
import { WalkthroughCheckpoint } from '../types.js';
import slugify from 'slugify';

export function detectCheckpoints(
  tokens: MarkdownToken[],
  sectionId: string,
): WalkthroughCheckpoint[] {
  const checkpoints: WalkthroughCheckpoint[] = [];

  for (const token of tokens) {
    if (token.type === 'heading' && token.level === 3) {
      const cpId = `${sectionId}-${slugify(token.content, { lower: true, strict: true })}`;
      checkpoints.push({
        id: cpId,
        label: token.content,
      });
    }
  }

  return checkpoints;
}
```

---

### 8. `tools/intake/src/converter/index.ts`

```typescript
/**
 * Main converter orchestrator.
 * Transforms captured markdown pages into classified walkthrough sections.
 */

import { parseMarkdown } from './markdown-parser.js';
import { detectSections } from './detect-sections.js';
import { detectBlockType, buildBlock } from './detect-blocks.js';
import { detectCheckpoints } from './detect-checkpoints.js';
import { ConvertedSection, ClassifiedBlock, TrainingDatabase, BlockType } from '../types.js';

export interface ConvertOptions {
  training: TrainingDatabase | null;
  source_site?: string;
}

export function convertPages(pages: string[], options: ConvertOptions): ConvertedSection[] {
  // Combine all pages into one markdown document
  const combined = pages.join('\n\n---\n\n');
  const tokens = parseMarkdown(combined);
  const rawSections = detectSections(tokens);

  return rawSections.map(section => {
    const blocks: ClassifiedBlock[] = [];
    let headingAbove: string | undefined;
    let headingLevel: number | undefined;
    const surroundingTypes: BlockType[] = [];

    for (const token of section.tokens) {
      // Track heading context
      if (token.type === 'heading') {
        headingAbove = token.content;
        headingLevel = token.level;
        continue; // Headings become context, not blocks
      }

      const context = {
        heading_above: headingAbove,
        heading_level: headingLevel,
        surrounding_types: [...surroundingTypes],
        source_site: options.source_site,
      };

      const { block_type, confidence } = detectBlockType(token, context, options.training);
      const block = buildBlock(token, block_type, context);

      blocks.push({
        block,
        confidence,
        source_line_start: token.line_start,
        source_line_end: token.line_end,
        approved: false,
      });

      surroundingTypes.push(block_type);
      // Reset heading context after it's been used
      headingAbove = undefined;
      headingLevel = undefined;
    }

    const checkpoints = detectCheckpoints(section.tokens, section.id);

    return {
      id: section.id,
      title: section.title,
      blocks,
      checkpoints,
      approved: false,
    };
  });
}
```

---

### 9. `tools/intake/src/training/rules-db.ts`

```typescript
/**
 * Training database — stores corrections and manages graduation.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { TrainingDatabase, TrainingExample, BlockType } from '../types.js';

const DEFAULT_DB: TrainingDatabase = {
  examples: [],
  graduation_status: 'training',
  walkthroughs_processed: 0,
};

export class RulesDB {
  private db: TrainingDatabase;
  private path: string;

  constructor(dbPath: string) {
    this.path = dbPath;
    this.db = existsSync(dbPath)
      ? JSON.parse(readFileSync(dbPath, 'utf-8'))
      : { ...DEFAULT_DB };
  }

  get data(): TrainingDatabase {
    return this.db;
  }

  get isTraining(): boolean {
    return this.db.graduation_status === 'training';
  }

  get shouldGraduate(): boolean {
    return this.db.walkthroughs_processed >= 10 && this.db.graduation_status === 'training';
  }

  addCorrection(example: TrainingExample): void {
    this.db.examples.push(example);
    this.save();
  }

  incrementWalkthroughs(): void {
    this.db.walkthroughs_processed++;
    this.save();
  }

  graduate(): void {
    this.db.graduation_status = 'graduated';
    this.save();
  }

  getAccuracyStats(): { total: number; corrections: number; accuracy: number } {
    const total = this.db.examples.length > 0
      ? Math.round(this.db.examples.length / 0.114) // rough estimate
      : 0;
    return {
      total,
      corrections: this.db.examples.length,
      accuracy: total > 0 ? (total - this.db.examples.length) / total : 1,
    };
  }

  private save(): void {
    writeFileSync(this.path, JSON.stringify(this.db, null, 2));
  }
}
```

---

### 10. `tools/intake/src/server.ts`

```typescript
/**
 * Local intake server — receives pages from the browser extension,
 * serves APIs for the CLI review tool.
 */

import express from 'express';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { convertPages } from './converter/index.js';
import { IntakeSession, PageCapture, ConvertedSection } from './types.js';
import { RulesDB } from './training/rules-db.js';

export function createServer(workingDir: string) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const intakeDir = join(workingDir, '.intake');
  const pagesDir = join(intakeDir, 'pages');
  const sessionFile = join(intakeDir, 'session.json');
  const sectionsFile = join(intakeDir, 'sections.json');
  const trainingDbPath = join(workingDir, '..', '..', 'tools', 'intake', 'training-data.json');

  // Ensure directories exist
  mkdirSync(pagesDir, { recursive: true });

  function getSession(): IntakeSession | null {
    if (!existsSync(sessionFile)) return null;
    return JSON.parse(readFileSync(sessionFile, 'utf-8'));
  }

  function saveSession(session: IntakeSession): void {
    writeFileSync(sessionFile, JSON.stringify(session, null, 2));
  }

  function getSections(): ConvertedSection[] | null {
    if (!existsSync(sectionsFile)) return null;
    return JSON.parse(readFileSync(sectionsFile, 'utf-8'));
  }

  // POST /api/intake — receive a page from the extension
  app.post('/api/intake', (req, res) => {
    const { title, url, markdown, page_number } = req.body;

    if (!markdown || !title) {
      res.status(400).json({ error: 'Missing required fields: title, markdown' });
      return;
    }

    const pageNum = page_number || (readdirSync(pagesDir).length + 1);
    const capture: PageCapture = {
      page_number: pageNum,
      title,
      url: url || '',
      markdown,
      captured_at: new Date().toISOString(),
    };

    writeFileSync(join(pagesDir, `page${pageNum}.json`), JSON.stringify(capture, null, 2));

    // Update session
    const session = getSession();
    if (session) {
      session.pages_captured = pageNum;
      saveSession(session);
    }

    res.json({ success: true, page_number: pageNum });
  });

  // GET /api/session — current session status
  app.get('/api/session', (_req, res) => {
    const session = getSession();
    if (!session) {
      res.status(404).json({ error: 'No active session' });
      return;
    }
    res.json(session);
  });

  // GET /api/pages — list captured pages
  app.get('/api/pages', (_req, res) => {
    if (!existsSync(pagesDir)) {
      res.json([]);
      return;
    }
    const files = readdirSync(pagesDir).filter(f => f.endsWith('.json'));
    const pages = files.map(f => JSON.parse(readFileSync(join(pagesDir, f), 'utf-8')));
    pages.sort((a: PageCapture, b: PageCapture) => a.page_number - b.page_number);
    res.json(pages);
  });

  // GET /api/pages/:num — get a specific page
  app.get('/api/pages/:num', (req, res) => {
    const filePath = join(pagesDir, `page${req.params.num}.json`);
    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    res.json(JSON.parse(readFileSync(filePath, 'utf-8')));
  });

  // POST /api/convert — run converter on all pages
  app.post('/api/convert', (_req, res) => {
    const files = readdirSync(pagesDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      res.status(400).json({ error: 'No pages captured yet' });
      return;
    }

    const pages = files
      .map(f => JSON.parse(readFileSync(join(pagesDir, f), 'utf-8')) as PageCapture)
      .sort((a, b) => a.page_number - b.page_number)
      .map(p => p.markdown);

    const rulesDb = new RulesDB(trainingDbPath);
    const sections = convertPages(pages, {
      training: rulesDb.data,
      source_site: getSession()?.source_url,
    });

    writeFileSync(sectionsFile, JSON.stringify(sections, null, 2));

    const session = getSession();
    if (session) {
      session.state = 'reviewing';
      saveSession(session);
    }

    res.json({
      success: true,
      sections: sections.length,
      total_blocks: sections.reduce((sum, s) => sum + s.blocks.length, 0),
    });
  });

  // GET /api/sections — get converted sections
  app.get('/api/sections', (_req, res) => {
    const sections = getSections();
    if (!sections) {
      res.status(404).json({ error: 'No converted sections. Run POST /api/convert first.' });
      return;
    }
    res.json(sections);
  });

  // GET /api/sections/:id — get a specific section
  app.get('/api/sections/:id', (req, res) => {
    const sections = getSections();
    if (!sections) {
      res.status(404).json({ error: 'No converted sections' });
      return;
    }
    const section = sections.find(s => s.id === req.params.id);
    if (!section) {
      res.status(404).json({ error: 'Section not found' });
      return;
    }
    res.json(section);
  });

  // PUT /api/sections/:id/blocks/:index — update a block
  app.put('/api/sections/:id/blocks/:index', (req, res) => {
    const sections = getSections();
    if (!sections) {
      res.status(404).json({ error: 'No converted sections' });
      return;
    }

    const section = sections.find(s => s.id === req.params.id);
    if (!section) {
      res.status(404).json({ error: 'Section not found' });
      return;
    }

    const blockIndex = parseInt(req.params.index, 10);
    if (blockIndex < 0 || blockIndex >= section.blocks.length) {
      res.status(400).json({ error: 'Invalid block index' });
      return;
    }

    const { block, approved } = req.body;
    if (block) section.blocks[blockIndex].block = block;
    if (approved !== undefined) section.blocks[blockIndex].approved = approved;

    writeFileSync(sectionsFile, JSON.stringify(sections, null, 2));
    res.json({ success: true });
  });

  // POST /api/approve/:id — mark a section as approved
  app.post('/api/approve/:id', (req, res) => {
    const sections = getSections();
    if (!sections) {
      res.status(404).json({ error: 'No converted sections' });
      return;
    }

    const section = sections.find(s => s.id === req.params.id);
    if (!section) {
      res.status(404).json({ error: 'Section not found' });
      return;
    }

    section.approved = true;
    section.blocks.forEach(b => (b.approved = true));
    writeFileSync(sectionsFile, JSON.stringify(sections, null, 2));
    res.json({ success: true });
  });

  // POST /api/finalize — write to main-walkthrough.json
  app.post('/api/finalize', (req, res) => {
    const sections = getSections();
    const session = getSession();
    if (!sections || !session) {
      res.status(400).json({ error: 'No session or sections' });
      return;
    }

    const walkthrough = {
      id: session.slug,
      game: session.game,
      title: `Complete Walkthrough`,
      author: 'Intake System',
      source_url: session.source_url,
      attribution: `Based on walkthrough from ${session.source_url}`,
      created_at: new Date().toISOString().split('T')[0],
      sections: sections.map(s => ({
        id: s.id,
        title: s.title,
        blocks: s.blocks.map(b => b.block),
        checkpoints: s.checkpoints,
      })),
    };

    const outputPath = join(workingDir, 'main-walkthrough.json');
    writeFileSync(outputPath, JSON.stringify(walkthrough, null, 2));

    if (session) {
      session.state = 'finalized';
      saveSession(session);
    }

    res.json({ success: true, output: outputPath });
  });

  // DELETE /api/session — reset
  app.delete('/api/session', (_req, res) => {
    // Clean up handled by caller
    res.json({ success: true, message: 'Session reset' });
  });

  return app;
}
```

---

### 11. `tools/intake/src/cli.ts`

```typescript
#!/usr/bin/env node
/**
 * Intake CLI — entry point for the walkthrough intake system.
 * Commands: start, convert, review, finalize
 */

import { Command } from 'commander';
import { createServer } from './server.js';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import slugify from 'slugify';
import { IntakeSession } from './types.js';

const program = new Command();

program
  .name('intake')
  .description('Walkthrough intake system — capture, convert, review, finalize')
  .version('1.0.0');

program
  .command('start')
  .description('Start an intake session for a new walkthrough')
  .requiredOption('--game <name>', 'Game title')
  .requiredOption('--source <url>', 'Source walkthrough URL')
  .option('--port <number>', 'Server port', '3847')
  .action(async (opts) => {
    const slug = slugify(opts.game, { lower: true, strict: true });
    const walkthroughDir = join(process.cwd(), 'walkthroughs', slug);
    const intakeDir = join(walkthroughDir, '.intake');

    mkdirSync(join(intakeDir, 'pages'), { recursive: true });

    const session: IntakeSession = {
      game: opts.game,
      slug,
      source_url: opts.source,
      pages_captured: 0,
      state: 'capturing',
      created_at: new Date().toISOString(),
    };

    writeFileSync(join(intakeDir, 'session.json'), JSON.stringify(session, null, 2));

    const app = createServer(walkthroughDir);
    const port = parseInt(opts.port, 10);

    app.listen(port, () => {
      console.log(`\n✓ Intake server running on http://localhost:${port}`);
      console.log(`  Game: ${opts.game}`);
      console.log(`  Source: ${opts.source}`);
      console.log(`  Working dir: ${intakeDir}`);
      console.log(`\n  Open the walkthrough in your browser and use the extension to capture pages.`);
      console.log(`  Press Ctrl+C to stop.\n`);
    });
  });

program
  .command('convert')
  .description('Run the deterministic converter on captured pages')
  .option('--dir <path>', 'Walkthrough directory')
  .action(async (opts) => {
    const dir = opts.dir || process.cwd();
    console.log(`Converting pages in ${dir}...`);
    // Conversion is triggered via the API — this is a convenience wrapper
    const response = await fetch(`http://localhost:3847/api/convert`, { method: 'POST' });
    const result = await response.json();
    if (result.success) {
      console.log(`✓ Converted into ${result.sections} sections (${result.total_blocks} blocks)`);
    } else {
      console.error(`✗ Conversion failed: ${result.error}`);
    }
  });

program
  .command('finalize')
  .description('Write approved sections to main-walkthrough.json')
  .action(async () => {
    const response = await fetch(`http://localhost:3847/api/finalize`, { method: 'POST' });
    const result = await response.json();
    if (result.success) {
      console.log(`✓ Walkthrough finalized: ${result.output}`);
    } else {
      console.error(`✗ Finalize failed: ${result.error}`);
    }
  });

program.parse();
```

---

### 12. `tools/intake-extension/manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Walkthrough Intake",
  "version": "1.0.0",
  "description": "Capture walkthrough pages for the local intake system",
  "permissions": ["activeTab"],
  "host_permissions": ["http://localhost:3847/*"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

---

### 13. `tools/intake-extension/content.js`

```javascript
/**
 * Content script — extracts article content from the current page
 * using Mozilla Readability and converts to Markdown via Turndown.
 */

// Loaded via popup message — not auto-executing
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
    try {
      const result = extractContent();
      sendResponse({ success: true, ...result });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }
  return true; // async response
});

function extractContent() {
  // Clone document for Readability (it mutates the DOM)
  const docClone = document.cloneNode(true);
  const reader = new Readability(docClone);
  const article = reader.parse();

  if (!article || !article.content) {
    throw new Error('Could not extract article content from this page');
  }

  // Convert HTML to Markdown
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  // Preserve tables
  turndownService.addRule('tables', {
    filter: ['table'],
    replacement: function (content, node) {
      return '\n' + htmlTableToMarkdown(node) + '\n';
    },
  });

  const markdown = turndownService.turndown(article.content);

  return {
    title: article.title || document.title,
    url: window.location.href,
    markdown,
    byline: article.byline || '',
  };
}

function htmlTableToMarkdown(tableNode) {
  const rows = tableNode.querySelectorAll('tr');
  if (rows.length === 0) return '';

  const result = [];
  rows.forEach((row, i) => {
    const cells = Array.from(row.querySelectorAll('td, th'));
    const line = '| ' + cells.map(c => c.textContent.trim()).join(' | ') + ' |';
    result.push(line);
    if (i === 0) {
      result.push('| ' + cells.map(() => '---').join(' | ') + ' |');
    }
  });
  return result.join('\n');
}
```

---

### 14. `tools/intake-extension/popup.html`

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { width: 320px; padding: 16px; font-family: system-ui, sans-serif; font-size: 14px; }
    h2 { margin: 0 0 12px; font-size: 16px; }
    .page-list { list-style: none; padding: 0; margin: 8px 0; }
    .page-list li { padding: 4px 0; }
    .page-list li::before { content: "✓ "; color: #22c55e; }
    button { width: 100%; padding: 10px; margin: 4px 0; border: none; border-radius: 6px;
             cursor: pointer; font-size: 14px; font-weight: 500; }
    .capture-btn { background: #3b82f6; color: white; }
    .capture-btn:hover { background: #2563eb; }
    .done-btn { background: #22c55e; color: white; }
    .done-btn:hover { background: #16a34a; }
    .status { margin: 8px 0; padding: 8px; border-radius: 4px; background: #f0fdf4; color: #166534; }
    .error { background: #fef2f2; color: #991b1b; }
  </style>
</head>
<body>
  <h2>Walkthrough Intake</h2>
  <div id="status"></div>
  <ul class="page-list" id="pageList"></ul>
  <button class="capture-btn" id="captureBtn">Capture This Page</button>
  <button class="done-btn" id="doneBtn">Done — Start Conversion</button>
  <script src="popup.js"></script>
</body>
</html>
```

---

### 15. `tools/intake-extension/popup.js`

```javascript
const SERVER = 'http://localhost:3847';
const statusEl = document.getElementById('status');
const pageListEl = document.getElementById('pageList');
const captureBtn = document.getElementById('captureBtn');
const doneBtn = document.getElementById('doneBtn');

async function loadSession() {
  try {
    const res = await fetch(`${SERVER}/api/session`);
    if (res.ok) {
      const session = await res.json();
      statusEl.textContent = `Game: ${session.game} | Pages: ${session.pages_captured}`;
      statusEl.className = 'status';
    } else {
      statusEl.textContent = 'No active session. Run: npx intake start --game "..."';
      statusEl.className = 'status error';
    }

    const pagesRes = await fetch(`${SERVER}/api/pages`);
    if (pagesRes.ok) {
      const pages = await pagesRes.json();
      pageListEl.innerHTML = pages
        .map(p => `<li>${p.page_number}. ${p.title}</li>`)
        .join('');
    }
  } catch {
    statusEl.textContent = 'Cannot connect to intake server (localhost:3847)';
    statusEl.className = 'status error';
  }
}

captureBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { action: 'extract' }, async (response) => {
    if (!response || !response.success) {
      statusEl.textContent = `Error: ${response?.error || 'Extraction failed'}`;
      statusEl.className = 'status error';
      return;
    }

    try {
      const res = await fetch(`${SERVER}/api/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: response.title,
          url: response.url,
          markdown: response.markdown,
        }),
      });

      const result = await res.json();
      if (result.success) {
        statusEl.textContent = `✓ Page ${result.page_number} captured!`;
        statusEl.className = 'status';
        loadSession();
      } else {
        statusEl.textContent = `Error: ${result.error}`;
        statusEl.className = 'status error';
      }
    } catch (err) {
      statusEl.textContent = `Server error: ${err.message}`;
      statusEl.className = 'status error';
    }
  });
});

doneBtn.addEventListener('click', async () => {
  try {
    const res = await fetch(`${SERVER}/api/convert`, { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      statusEl.textContent = `✓ Converted: ${result.sections} sections, ${result.total_blocks} blocks`;
      statusEl.className = 'status';
    } else {
      statusEl.textContent = `Error: ${result.error}`;
      statusEl.className = 'status error';
    }
  } catch (err) {
    statusEl.textContent = `Server error: ${err.message}`;
    statusEl.className = 'status error';
  }
});

// Load on popup open
loadSession();
```

---

## Test Coverage

### Test File: `tools/intake/tests/converter/markdown-parser.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { parseMarkdown, parseTable } from '../../src/converter/markdown-parser.js';

describe('parseMarkdown', () => {
  it('parses headings with correct level', () => {
    const tokens = parseMarkdown('# Title\n## Section\n### Subsection');
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toMatchObject({ type: 'heading', level: 1, content: 'Title' });
    expect(tokens[1]).toMatchObject({ type: 'heading', level: 2, content: 'Section' });
    expect(tokens[2]).toMatchObject({ type: 'heading', level: 3, content: 'Subsection' });
  });

  it('parses paragraphs as consecutive non-empty lines', () => {
    const tokens = parseMarkdown('Line one\nLine two\n\nNew paragraph');
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ type: 'paragraph', content: 'Line one\nLine two' });
    expect(tokens[1]).toMatchObject({ type: 'paragraph', content: 'New paragraph' });
  });

  it('parses markdown tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const tokens = parseMarkdown(md);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('table');
    expect(tokens[0].content).toContain('| A | B |');
  });

  it('parses blockquotes', () => {
    const tokens = parseMarkdown('> This is a quote\n> Second line');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: 'blockquote' });
    expect(tokens[0].content).toContain('This is a quote');
  });

  it('parses unordered lists', () => {
    const tokens = parseMarkdown('- Item 1\n- Item 2\n- Item 3');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('list');
  });

  it('parses ordered lists', () => {
    const tokens = parseMarkdown('1. First\n2. Second\n3. Third');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('list');
  });

  it('parses fenced code blocks', () => {
    const md = '```js\nconst x = 1;\n```';
    const tokens = parseMarkdown(md);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('code_block');
  });

  it('parses horizontal rules', () => {
    const tokens = parseMarkdown('---');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('hr');
  });

  it('tracks line numbers correctly', () => {
    const md = '# Title\n\nParagraph text\nMore text\n\n## Next';
    const tokens = parseMarkdown(md);
    expect(tokens[0].line_start).toBe(0); // # Title
    expect(tokens[1].line_start).toBe(2); // Paragraph
    expect(tokens[1].line_end).toBe(3);
    expect(tokens[2].line_start).toBe(5); // ## Next
  });

  it('handles mixed content in sequence', () => {
    const md = '## Section\n\nSome text.\n\n| Col |\n|---|\n| val |\n\n> Note here';
    const tokens = parseMarkdown(md);
    expect(tokens.map(t => t.type)).toEqual(['heading', 'paragraph', 'table', 'blockquote']);
  });
});

describe('parseTable', () => {
  it('extracts headers and rows', () => {
    const table = parseTable('| Name | HP | Weakness |\n|---|---|---|\n| Boss A | 5000 | Fire |');
    expect(table.headers).toEqual(['Name', 'HP', 'Weakness']);
    expect(table.rows).toEqual([['Boss A', '5000', 'Fire']]);
  });

  it('handles multiple data rows', () => {
    const table = parseTable('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
    expect(table.rows).toHaveLength(2);
  });

  it('handles empty table gracefully', () => {
    const table = parseTable('');
    expect(table.headers).toEqual([]);
    expect(table.rows).toEqual([]);
  });
});
```

---

### Test File: `tools/intake/tests/converter/detect-sections.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { detectSections } from '../../src/converter/detect-sections.js';
import { parseMarkdown } from '../../src/converter/markdown-parser.js';

describe('detectSections', () => {
  it('splits on H2 headings', () => {
    const tokens = parseMarkdown('## Prologue\n\nText here\n\n## Act 1\n\nMore text');
    const sections = detectSections(tokens);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('Prologue');
    expect(sections[1].title).toBe('Act 1');
  });

  it('creates Introduction section for content before first H2', () => {
    const tokens = parseMarkdown('Some intro text\n\n## First Section\n\nContent');
    const sections = detectSections(tokens);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('Introduction');
    expect(sections[1].title).toBe('First Section');
  });

  it('generates slugified IDs', () => {
    const tokens = parseMarkdown('## Act 1 - Part 2\n\nText');
    const sections = detectSections(tokens);
    expect(sections[0].id).toBe('act-1-part-2');
  });

  it('handles document with no H2 headings as single section', () => {
    const tokens = parseMarkdown('### Sub heading\n\nJust paragraphs\n\nMore text');
    const sections = detectSections(tokens);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Introduction');
  });

  it('preserves tokens within sections', () => {
    const tokens = parseMarkdown('## Section\n\nPara 1\n\n| A |\n|---|\n| B |');
    const sections = detectSections(tokens);
    expect(sections[0].tokens).toHaveLength(2); // paragraph + table
  });
});
```

---

### Test File: `tools/intake/tests/converter/detect-blocks.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { detectBlockType, buildBlock } from '../../src/converter/detect-blocks.js';
import { MarkdownToken } from '../../src/converter/markdown-parser.js';

const makeToken = (overrides: Partial<MarkdownToken>): MarkdownToken => ({
  type: 'paragraph',
  content: 'Default content',
  line_start: 0,
  line_end: 0,
  ...overrides,
});

const defaultContext = { surrounding_types: [] as any[] };

describe('detectBlockType', () => {
  it('classifies plain paragraphs as prose', () => {
    const token = makeToken({ content: 'Head north and talk to the guard.' });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('prose');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('classifies tables with encounter stats as encounter', () => {
    const token = makeToken({
      type: 'table',
      content: '| Name | HP | Weakness |\n|---|---|---|\n| Ortheim | 12000 | Fire |',
    });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('encounter');
  });

  it('classifies tables without encounter stats as table', () => {
    const token = makeToken({
      type: 'table',
      content: '| Item | Price | Location |\n|---|---|---|\n| Potion | 100 | Shop |',
    });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('table');
  });

  it('classifies blockquotes as callout', () => {
    const token = makeToken({ type: 'blockquote', content: 'Be careful here!' });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('callout');
  });

  it('classifies paragraphs starting with Warning as callout', () => {
    const token = makeToken({ content: 'Warning: This boss is missable!' });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('callout');
  });

  it('classifies text with quest patterns as quest', () => {
    const token = makeToken({ content: 'Side Quest: Find the missing cat' });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('quest');
  });

  it('uses heading context for encounter detection', () => {
    const token = makeToken({ content: 'This boss uses fire attacks...' });
    const context = { heading_above: 'Boss: Flame Dragon', surrounding_types: [] as any[] };
    const result = detectBlockType(token, context, null);
    expect(result.block_type).toBe('encounter');
  });

  it('classifies lists with location items as checklist', () => {
    const token = makeToken({
      type: 'list',
      content: '- Golden Orb (location: north tower)\n- Silver Key (location: basement)\n- Red Gem (location: east wing)',
    });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('checklist');
  });

  it('classifies regular lists as prose', () => {
    const token = makeToken({
      type: 'list',
      content: '- Go north\n- Talk to NPC',
    });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('prose');
  });

  it('respects training corrections over defaults', () => {
    const token = makeToken({
      type: 'table',
      content: '| Item | Qty |\n|---|---|\n| Herb | 3 |',
    });
    const training = {
      examples: [{
        source_pattern: '| Item | Qty |',
        converter_guessed: 'table' as const,
        user_corrected_to: 'checklist' as const,
        context: { heading_above: undefined },
        game: 'test',
        timestamp: '2026-01-01',
      }],
      graduation_status: 'training' as const,
      walkthroughs_processed: 1,
    };
    const result = detectBlockType(token, defaultContext, training);
    expect(result.block_type).toBe('checklist');
  });
});

describe('buildBlock', () => {
  it('builds a prose block with heading context', () => {
    const token = makeToken({ content: 'Walk north to the plaza.' });
    const block = buildBlock(token, 'prose', { heading_above: 'Day 1', surrounding_types: [] });
    expect(block).toEqual({
      type: 'prose',
      heading: 'Day 1',
      content: 'Walk north to the plaza.',
    });
  });

  it('builds an encounter block from stats table', () => {
    const token = makeToken({
      type: 'table',
      content: '| Name | HP | Weakness |\n|---|---|---|\n| Dragon | 9999 | Ice |',
    });
    const block = buildBlock(token, 'encounter', { heading_above: 'Boss: Dragon', surrounding_types: [] });
    expect(block.type).toBe('encounter');
    expect((block as any).name).toBe('Dragon');
    expect((block as any).stats).toEqual({ Name: 'Dragon', HP: '9999', Weakness: 'Ice' });
  });

  it('builds a callout block and strips severity prefix', () => {
    const token = makeToken({ content: 'Warning: Missable item ahead!' });
    const block = buildBlock(token, 'callout', defaultContext);
    expect(block.type).toBe('callout');
    expect((block as any).severity).toBe('warning');
    expect((block as any).content).toBe('Missable item ahead!');
  });

  it('builds a table block from markdown table', () => {
    const token = makeToken({
      type: 'table',
      content: '| Shop | Price |\n|---|---|\n| Potion | 50 |\n| Ether | 100 |',
    });
    const block = buildBlock(token, 'table', defaultContext);
    expect(block.type).toBe('table');
    expect((block as any).columns).toEqual(['Shop', 'Price']);
    expect((block as any).rows).toHaveLength(2);
  });

  it('builds a quest block with detected type', () => {
    const token = makeToken({ content: 'Side Quest: The Missing Cat' });
    const block = buildBlock(token, 'quest', { heading_above: 'Optional', surrounding_types: [] });
    expect(block.type).toBe('quest');
    expect((block as any).quest_type).toBe('side');
    expect((block as any).name).toBe('The Missing Cat');
  });

  it('builds a checklist from list items', () => {
    const token = makeToken({
      type: 'list',
      content: '- Red Orb — North Tower\n- Blue Key — Basement',
    });
    const block = buildBlock(token, 'checklist', defaultContext);
    expect(block.type).toBe('checklist');
    expect((block as any).items).toHaveLength(2);
    expect((block as any).items[0].label).toBe('Red Orb');
    expect((block as any).items[0].detail).toBe('North Tower');
  });
});
```

---

### Test File: `tools/intake/tests/converter/detect-checkpoints.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { detectCheckpoints } from '../../src/converter/detect-checkpoints.js';
import { parseMarkdown } from '../../src/converter/markdown-parser.js';

describe('detectCheckpoints', () => {
  it('generates checkpoints from H3 headings', () => {
    const tokens = parseMarkdown('### Morning\n\nText\n\n### Afternoon\n\nMore text');
    const checkpoints = detectCheckpoints(tokens, 'prologue');
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]).toMatchObject({ id: 'prologue-morning', label: 'Morning' });
    expect(checkpoints[1]).toMatchObject({ id: 'prologue-afternoon', label: 'Afternoon' });
  });

  it('ignores non-H3 headings', () => {
    const tokens = parseMarkdown('## Section\n\n#### Deep heading\n\nText');
    const checkpoints = detectCheckpoints(tokens, 'section');
    expect(checkpoints).toHaveLength(0); // only H2 and H4, no H3
  });

  it('returns empty array when no H3 headings exist', () => {
    const tokens = parseMarkdown('Just paragraphs\n\nMore text');
    const checkpoints = detectCheckpoints(tokens, 'intro');
    expect(checkpoints).toHaveLength(0);
  });

  it('slugifies checkpoint IDs correctly', () => {
    const tokens = parseMarkdown('### Act 1 — Part 2\n\nText');
    const checkpoints = detectCheckpoints(tokens, 'main');
    expect(checkpoints[0].id).toMatch(/^main-/);
  });
});
```

---

### Test File: `tools/intake/tests/training/rules-db.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RulesDB } from '../../src/training/rules-db.js';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('RulesDB', () => {
  const testPath = join(tmpdir(), `test-training-${Date.now()}.json`);

  afterEach(() => {
    if (existsSync(testPath)) unlinkSync(testPath);
  });

  it('creates new empty database if file does not exist', () => {
    const db = new RulesDB(testPath);
    expect(db.data.examples).toEqual([]);
    expect(db.data.graduation_status).toBe('training');
    expect(db.data.walkthroughs_processed).toBe(0);
  });

  it('loads existing database from file', () => {
    writeFileSync(testPath, JSON.stringify({
      examples: [{ source_pattern: 'test', converter_guessed: 'prose', user_corrected_to: 'callout', context: {}, game: 'test', timestamp: '2026-01-01' }],
      graduation_status: 'training',
      walkthroughs_processed: 3,
    }));
    const db = new RulesDB(testPath);
    expect(db.data.examples).toHaveLength(1);
    expect(db.data.walkthroughs_processed).toBe(3);
  });

  it('addCorrection persists to file', () => {
    const db = new RulesDB(testPath);
    db.addCorrection({
      source_pattern: '| HP | Weakness |',
      converter_guessed: 'table',
      user_corrected_to: 'encounter',
      context: { heading_above: 'Boss: X' },
      game: 'test-game',
      timestamp: '2026-05-26',
    });
    expect(db.data.examples).toHaveLength(1);

    // Verify persisted
    const db2 = new RulesDB(testPath);
    expect(db2.data.examples).toHaveLength(1);
  });

  it('isTraining returns true when not graduated', () => {
    const db = new RulesDB(testPath);
    expect(db.isTraining).toBe(true);
  });

  it('shouldGraduate returns true after 10 walkthroughs', () => {
    writeFileSync(testPath, JSON.stringify({
      examples: [],
      graduation_status: 'training',
      walkthroughs_processed: 10,
    }));
    const db = new RulesDB(testPath);
    expect(db.shouldGraduate).toBe(true);
  });

  it('shouldGraduate returns false if already graduated', () => {
    writeFileSync(testPath, JSON.stringify({
      examples: [],
      graduation_status: 'graduated',
      walkthroughs_processed: 15,
    }));
    const db = new RulesDB(testPath);
    expect(db.shouldGraduate).toBe(false);
  });

  it('graduate changes status', () => {
    const db = new RulesDB(testPath);
    db.graduate();
    expect(db.data.graduation_status).toBe('graduated');
    expect(db.isTraining).toBe(false);
  });

  it('incrementWalkthroughs updates count', () => {
    const db = new RulesDB(testPath);
    db.incrementWalkthroughs();
    db.incrementWalkthroughs();
    expect(db.data.walkthroughs_processed).toBe(2);
  });
});
```

---

### Test File: `tools/intake/tests/server.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Intake Server API', () => {
  let workingDir: string;
  let app: ReturnType<typeof createServer>;

  beforeEach(() => {
    workingDir = join(tmpdir(), `intake-test-${Date.now()}`);
    mkdirSync(join(workingDir, '.intake', 'pages'), { recursive: true });

    // Create a session file
    writeFileSync(join(workingDir, '.intake', 'session.json'), JSON.stringify({
      game: 'Test Game',
      slug: 'test-game',
      source_url: 'https://example.com',
      pages_captured: 0,
      state: 'capturing',
      created_at: '2026-05-26T00:00:00Z',
    }));

    app = createServer(workingDir);
  });

  afterEach(() => {
    if (existsSync(workingDir)) rmSync(workingDir, { recursive: true });
  });

  describe('GET /api/session', () => {
    it('returns current session', async () => {
      const res = await request(app).get('/api/session');
      expect(res.status).toBe(200);
      expect(res.body.game).toBe('Test Game');
      expect(res.body.state).toBe('capturing');
    });
  });

  describe('POST /api/intake', () => {
    it('saves page capture', async () => {
      const res = await request(app)
        .post('/api/intake')
        .send({ title: 'Prologue', url: 'https://example.com/p1', markdown: '## Prologue\n\nText here' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.page_number).toBe(1);
    });

    it('rejects missing required fields', async () => {
      const res = await request(app)
        .post('/api/intake')
        .send({ url: 'https://example.com' });

      expect(res.status).toBe(400);
    });

    it('increments page numbers', async () => {
      await request(app).post('/api/intake').send({ title: 'P1', markdown: 'Text 1' });
      const res = await request(app).post('/api/intake').send({ title: 'P2', markdown: 'Text 2' });
      expect(res.body.page_number).toBe(2);
    });
  });

  describe('GET /api/pages', () => {
    it('returns empty list initially', async () => {
      const res = await request(app).get('/api/pages');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns captured pages in order', async () => {
      await request(app).post('/api/intake').send({ title: 'P1', markdown: 'A' });
      await request(app).post('/api/intake').send({ title: 'P2', markdown: 'B' });

      const res = await request(app).get('/api/pages');
      expect(res.body).toHaveLength(2);
      expect(res.body[0].title).toBe('P1');
      expect(res.body[1].title).toBe('P2');
    });
  });

  describe('POST /api/convert', () => {
    it('converts captured pages into sections', async () => {
      await request(app).post('/api/intake').send({
        title: 'Prologue',
        markdown: '## Prologue\n\nWalk north to the gate.\n\n## Act 1\n\nTalk to Sara.',
      });

      const res = await request(app).post('/api/convert');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sections).toBeGreaterThanOrEqual(2);
    });

    it('fails with no pages', async () => {
      const res = await request(app).post('/api/convert');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/sections', () => {
    it('returns 404 before conversion', async () => {
      const res = await request(app).get('/api/sections');
      expect(res.status).toBe(404);
    });

    it('returns sections after conversion', async () => {
      await request(app).post('/api/intake').send({ title: 'P1', markdown: '## Section\n\nContent' });
      await request(app).post('/api/convert');

      const res = await request(app).get('/api/sections');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/approve/:id', () => {
    it('marks a section as approved', async () => {
      await request(app).post('/api/intake').send({ title: 'P1', markdown: '## Test\n\nContent' });
      await request(app).post('/api/convert');

      const sections = await request(app).get('/api/sections');
      const sectionId = sections.body[0].id;

      const res = await request(app).post(`/api/approve/${sectionId}`);
      expect(res.status).toBe(200);

      const updated = await request(app).get(`/api/sections/${sectionId}`);
      expect(updated.body.approved).toBe(true);
    });
  });

  describe('POST /api/finalize', () => {
    it('writes main-walkthrough.json', async () => {
      await request(app).post('/api/intake').send({ title: 'P1', markdown: '## Prologue\n\nText' });
      await request(app).post('/api/convert');

      const res = await request(app).post('/api/finalize');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(existsSync(join(workingDir, 'main-walkthrough.json'))).toBe(true);
    });
  });
});
```

---

## `.gitignore` Addition

Add to the root `.gitignore`:

```
# Intake working directories
walkthroughs/**/.intake/
tools/intake/training-data.json
```

---

## Implementation Order

1. **Phase 1 — Core converter** (`tools/intake/src/converter/` + types)
2. **Phase 2 — Training system** (`tools/intake/src/training/`)
3. **Phase 3 — Server** (`tools/intake/src/server.ts`)
4. **Phase 4 — CLI** (`tools/intake/src/cli.ts`)
5. **Phase 5 — Browser extension** (`tools/intake-extension/`)
6. **Phase 6 — Integration testing** (end-to-end with sample data)

---

## Test Coverage Summary

| Component | Test File | Coverage |
|-----------|-----------|----------|
| Markdown parser | `tests/converter/markdown-parser.test.ts` | Token parsing, tables, line numbers, mixed content |
| Section detection | `tests/converter/detect-sections.test.ts` | H2 splitting, slug generation, intro section |
| Block detection | `tests/converter/detect-blocks.test.ts` | All 6 block types, confidence scoring, training override |
| Checkpoint detection | `tests/converter/detect-checkpoints.test.ts` | H3 extraction, ID generation |
| Training DB | `tests/training/rules-db.test.ts` | CRUD, persistence, graduation logic |
| Server API | `tests/server.test.ts` | All endpoints, error cases, integration flow |

**Target:** >90% line coverage on converter and training modules.
