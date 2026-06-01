/**
 * Main converter orchestrator.
 * Transforms captured markdown pages into classified walkthrough sections.
 */

import { parseMarkdown, MarkdownToken } from './markdown-parser.js';
import { detectSections } from './detect-sections.js';
import { detectBlockType, buildBlock } from './detect-blocks.js';
import { detectCheckpoints } from './detect-checkpoints.js';
import { ConvertedSection, ClassifiedBlock, TrainingDatabase, BlockType, WalkthroughBlock } from '../types.js';
import slugify from 'slugify';

/** Strip common site-name suffixes like " - Game Title Walkthrough" from page titles. */
function stripSiteSuffix(title: string | undefined): string | undefined {
  if (!title) return undefined;
  // Split on " - " and remove trailing segments that look like site suffixes
  const parts = title.split(' - ');
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (/walkthrough|wiki|guide|faq/i.test(last)) {
      parts.pop();
    } else {
      break;
    }
  }
  return parts.join(' - ').trim();
}

export interface ConvertOptions {
  training: TrainingDatabase | null;
  source_site?: string;
}

export interface PageInput {
  markdown: string;
  title?: string;
}

/**
 * Split compound table tokens at internal separator rows.
 * Wiki sources often pack monster drops, treasure chests, boss stats, and
 * strategy prose into one continuous markdown table separated by empty/--- rows.
 * This splits them into independent tokens that can be classified separately.
 */
function splitCompoundTables(tokens: MarkdownToken[]): MarkdownToken[] {
  const result: MarkdownToken[] = [];

  for (const token of tokens) {
    if (token.type !== 'table') {
      result.push(token);
      continue;
    }

    const lines = token.content.split('\n');
    // A table needs at least a header + separator + 1 data row to be splittable
    if (lines.length < 4) {
      result.push(token);
      continue;
    }

    // Find internal separator patterns: a row that is just `| |` or `| --- |`
    // These are visual dividers within compound wiki tables
    const subTables: string[][] = [];
    let current: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Check if this line is a visual separator row.
      // Visual dividers: `| |` or `| --- |` (1-2 cells, all empty or dashes).
      // NOT a separator: `| --- | --- | --- |` (3+ cells) — that's a real table header separator.
      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
      const isSeparator = cells.length > 0 && cells.length <= 2 &&
        cells.every(c => c === '' || /^-+$/.test(c));

      if (isSeparator) {
        // If current has exactly 1 row and this separator has the same cell count
        // as that row, it's the table's own header separator — keep it.
        if (current.length === 1) {
          const headerCells = current[0].split('|').slice(1, -1);
          if (cells.length === headerCells.length || cells.every(c => /^-+$/.test(c))) {
            current.push(line);
            continue;
          }
        }
        if (current.length > 0) {
          subTables.push(current);
          current = [];
        }
        // Skip separator lines entirely (don't add to current)
      } else if (trimmed !== '') {
        current.push(line);
      }
    }
    if (current.length > 0) {
      subTables.push(current);
    }

    // If no splits found, still check for internal header separators
    if (subTables.length <= 1) {
      // Even without visual dividers, there may be internal table header separators
      const allLines = subTables.length === 1 ? subTables[0] : lines;
      const subChunks = splitAtInternalHeaders(allLines);
      if (subChunks.length <= 1) {
        result.push(token);
        continue;
      }
      let lineOffset = token.line_start;
      for (const subChunk of subChunks) {
        if (subChunk.length === 0) continue;
        emitTableChunk(subChunk, lineOffset, result);
        lineOffset += subChunk.length;
      }
      continue;
    }

    // Convert each sub-table chunk into its own token
    let lineOffset = token.line_start;
    for (const chunk of subTables) {
      if (chunk.length === 0) continue;

      // Check for internal multi-cell separator rows (| --- | --- | --- |)
      // that indicate a new table header+separator embedded within the chunk.
      // Split at those points first.
      const subChunks = splitAtInternalHeaders(chunk);

      for (const subChunk of subChunks) {
        if (subChunk.length === 0) continue;
        emitTableChunk(subChunk, lineOffset, result);
        lineOffset += subChunk.length;
      }

      lineOffset += 2; // account for separator rows between main chunks
    }
  }

  return result;
}

/**
 * Split a chunk at internal multi-cell separator rows (| --- | --- | --- |).
 * These indicate a new table starting mid-chunk.
 */
function splitAtInternalHeaders(chunk: string[]): string[][] {
  const subChunks: string[][] = [];
  let current: string[] = [];

  for (let i = 0; i < chunk.length; i++) {
    const line = chunk[i];
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    const isMultiCellSeparator = cells.length >= 3 &&
      cells.every(c => /^-+$/.test(c) || /^:?-+:?$/.test(c));

    if (isMultiCellSeparator && i > 1) {
      // This is an internal table separator — the line BEFORE it is the header
      // of a new table. Split: everything before the header goes to one chunk,
      // the header + separator + rest go to a new chunk.
      const headerLine = current.pop(); // pull out the header (last line of current)
      if (current.length > 0) {
        subChunks.push(current);
      }
      // Start new chunk with header + separator
      current = headerLine ? [headerLine, line] : [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    subChunks.push(current);
  }
  return subChunks.length > 0 ? subChunks : [chunk];
}

/** Emit a single table chunk as the appropriate token type. */
function emitTableChunk(chunk: string[], lineOffset: number, result: MarkdownToken[]): void {
      // Determine if this chunk looks like a proper table (has |---|---| separator)
      const hasTableSeparator = chunk.length >= 2 &&
        /^\s*\|[\s\-:|]+\|/.test(chunk[1]);

      if (hasTableSeparator) {
        // It's a proper table with header + separator + rows
        result.push({
          type: 'table',
          content: chunk.join('\n'),
          line_start: lineOffset,
          line_end: lineOffset + chunk.length - 1,
        });
      } else {
        // These are data rows without a proper table header separator.
        // Parse each row's cells to decide what to do.
        const rows = chunk.map(line =>
          line.split('|').slice(1, -1).map(c => c.trim())
        );

        // Detect encounter pattern: first row has "HP:" in a cell
        const firstRow = rows[0];
        const isEncounter = firstRow.some(cell => /HP:\s*\d+/i.test(cell));

        if (isEncounter) {
          // Split encounter into stats table + strategy prose
          const encounterRows: string[] = [];
          const proseLines: string[] = [];

          for (let ri = 0; ri < rows.length; ri++) {
            const row = rows[ri];
            const nonEmpty = row.filter(c => c !== '');
            const longestCell = Math.max(...row.map(c => c.length));

            if (nonEmpty.length === 1 && longestCell > 150) {
              // Long single-cell row = strategy prose
              proseLines.push(nonEmpty[0]);
            } else {
              encounterRows.push(chunk[ri]);
            }
          }

          if (encounterRows.length > 0) {
            result.push({
              type: 'table',
              content: encounterRows.join('\n'),
              line_start: lineOffset,
              line_end: lineOffset + encounterRows.length - 1,
            });
          }
          if (proseLines.length > 0) {
            result.push({
              type: 'paragraph',
              content: proseLines.join('\n\n'),
              line_start: lineOffset,
              line_end: lineOffset + chunk.length - 1,
            });
          }
        } else {
          // Check if first row looks like a header (short generic labels, not data)
          const firstRowLooksLikeHeader = firstRow.length >= 2 &&
            firstRow.every(c => c.length < 25) &&
            !firstRow[0].match(/^\d/) &&
            // Data rows tend to have periods, commas in numbers, or long phrases
            !firstRow.some(c => /\d{2,}|,\s|x\s*\d|\.\s*$/.test(c));

          // Separate prose rows from table rows
          const proseLines: string[] = [];
          const tableLines: string[] = [];

          for (let ri = 0; ri < rows.length; ri++) {
            const row = rows[ri];
            const nonEmpty = row.filter(c => c !== '');
            const longestCell = Math.max(...row.map(c => c.length));

            if (nonEmpty.length === 1 && longestCell > 150) {
              // Prose stuffed into a table cell
              if (tableLines.length > 0) {
                result.push(makeTableToken(tableLines, lineOffset, firstRowLooksLikeHeader));
                tableLines.length = 0;
              }
              proseLines.push(nonEmpty[0]);
            } else {
              if (proseLines.length > 0) {
                result.push({
                  type: 'paragraph',
                  content: proseLines.join('\n\n'),
                  line_start: lineOffset,
                  line_end: lineOffset + proseLines.length - 1,
                });
                proseLines.length = 0;
              }
              tableLines.push(chunk[ri]);
            }
          }

          // Flush remaining
          if (tableLines.length > 0) {
            result.push(makeTableToken(tableLines, lineOffset, firstRowLooksLikeHeader));
          }
          if (proseLines.length > 0) {
            result.push({
              type: 'paragraph',
              content: proseLines.join('\n\n'),
              line_start: lineOffset,
              line_end: lineOffset + proseLines.length - 1,
            });
          }
        }
      }
}

/** Build a table token, optionally inserting a synthetic separator after the first line. */
function makeTableToken(lines: string[], lineOffset: number, firstRowIsHeader: boolean): MarkdownToken {
  if (firstRowIsHeader && lines.length >= 2) {
    // Insert a synthetic markdown separator after the header row
    const headerCells = lines[0].split('|').slice(1, -1);
    const separator = '|' + headerCells.map(() => ' --- ').join('|') + '|';
    const withSeparator = [lines[0], separator, ...lines.slice(1)];
    return {
      type: 'table',
      content: withSeparator.join('\n'),
      line_start: lineOffset,
      line_end: lineOffset + lines.length - 1,
    };
  }

  // No header detected — the first data row becomes "headers" in parseTable,
  // but we still need a separator line for parseTable to skip correctly.
  // Insert separator after line[0] so all remaining lines become data rows.
  const firstRowCells = lines[0].split('|').slice(1, -1);
  const separator = '|' + firstRowCells.map(() => ' --- ').join('|') + '|';
  const withSeparator = [lines[0], separator, ...lines.slice(1)];
  return {
    type: 'table',
    content: withSeparator.join('\n'),
    line_start: lineOffset,
    line_end: lineOffset + lines.length - 1,
  };
}

export function convertPages(pages: PageInput[], options: ConvertOptions): ConvertedSection[] {
  // Combine all pages into one markdown document
  const combined = pages.map(p => p.markdown).join('\n\n---\n\n');
  const tokens = parseMarkdown(combined);
  const rawSections = detectSections(tokens);

  // If H2-based detection yields only 1 section but we have multiple pages,
  // fall back to treating each page as its own section.
  const usePerPage = rawSections.length === 1 && pages.length > 1;
  const finalSections = usePerPage
    ? pages.map((page, i) => {
        const pageTokens = splitCompoundTables(parseMarkdown(page.markdown));
        const title = stripSiteSuffix(page.title) || `Page ${i + 1}`;
        return {
          id: slugify(title, { lower: true, strict: true }),
          title,
          tokens: pageTokens,
        };
      })
    : rawSections.map(s => ({ ...s, tokens: splitCompoundTables(s.tokens) }));

  return finalSections.map(section => {
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

      // Prune junk blocks: ads and empty tables
      if (isJunkBlock(block)) {
        continue;
      }

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

    // Post-process: reclassify callouts/prose mentioning bonding as bonding events
    const BONDING_RECLASSIFY = /\bbonding (event|point)/i;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i].block;
      if ((b.type === 'callout' || b.type === 'prose') && BONDING_RECLASSIFY.test(b.content || '')) {
        // Reclassify as a bonding event
        (blocks[i] as any).block = {
          type: 'event',
          event_type: 'bonding',
          name: 'Bonding Events',
          missable: false,
          content: b.content,
        };
      }
    }

    // Post-process: absorb Character tables adjacent to bonding events
    // (tables immediately before or after a bonding event with Character columns)
    const isBondingTable = (b: any): boolean => {
      if (b.type !== 'table') return false;
      const cols = (b.columns || []).map((c: string) => c.toLowerCase());
      return cols.includes('character') || cols.includes('date');
    };
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i].block;
      if (b.type === 'event' && (b as any).event_type === 'bonding') {
        const evt = b as any;
        if (!evt.details) evt.details = [];
        // Absorb preceding bonding tables
        while (i > 0 && isBondingTable(blocks[i - 1].block)) {
          const tbl = blocks[i - 1].block as any;
          evt.details.unshift({ columns: tbl.columns, rows: tbl.rows });
          blocks.splice(i - 1, 1);
          i--;
        }
        // Absorb following bonding tables
        while (i + 1 < blocks.length && isBondingTable(blocks[i + 1].block)) {
          const tbl = blocks[i + 1].block as any;
          evt.details.push({ columns: tbl.columns, rows: tbl.rows });
          blocks.splice(i + 1, 1);
        }
      }
    }

    // Post-process: merge consecutive encounters into a single multi-enemy fight
    for (let i = blocks.length - 1; i >= 1; i--) {
      const prev = blocks[i - 1].block;
      const curr = blocks[i].block;
      if (prev.type === 'encounter' && curr.type === 'encounter') {
        const enc = prev as { adds?: Array<{ name: string; stats?: Record<string, string> }> };
        if (!enc.adds) enc.adds = [];
        enc.adds.push({ name: (curr as any).name, stats: (curr as any).stats });
        // Carry over strategy if the merged one has it but primary doesn't
        if ((curr as any).strategy && !(prev as any).strategy) {
          (prev as any).strategy = (curr as any).strategy;
        }
        blocks.splice(i, 1);
      }
    }

    // Post-process: merge prose blocks that follow encounters as strategy text
    for (let i = blocks.length - 1; i >= 1; i--) {
      const prev = blocks[i - 1].block;
      const curr = blocks[i].block;
      if (
        prev.type === 'encounter' &&
        curr.type === 'prose' &&
        !(prev as any).strategy &&
        curr.content.length > 80 &&
        looksLikeStrategy(curr.content)
      ) {
        (prev as { strategy?: string }).strategy = curr.content;
        blocks.splice(i, 1);
      }
    }

    // Post-process: merge "Reward and AP" tables into preceding encounter
    for (let i = blocks.length - 1; i >= 1; i--) {
      const prev = blocks[i - 1].block;
      const curr = blocks[i].block;
      if (
        prev.type === 'encounter' &&
        curr.type === 'table' &&
        !(prev as any).reward
      ) {
        const rows = (curr as any).rows as string[][] | undefined;
        const cols = (curr as any).columns as string[] | undefined;
        const firstCell = rows?.[0]?.[0] || cols?.[0] || '';
        if (/reward|AP\b/i.test(firstCell)) {
          // Extract reward text from table
          const rewardText = (rows || []).map(r => r.join(', ')).join('; ');
          (prev as { reward?: string }).reward = rewardText;
          blocks.splice(i, 1);
        }
      }
    }

    // Post-process: merge tables that immediately follow an event block into the event's details
    for (let i = 0; i < blocks.length - 1; i++) {
      if (blocks[i].block.type === 'event') {
        const evt = blocks[i].block as { details?: Array<{ columns: string[]; rows: string[][] }> };
        // Consume all consecutive tables following this event
        while (i + 1 < blocks.length && blocks[i + 1].block.type === 'table') {
          const tbl = blocks[i + 1].block as { columns: string[]; rows: string[][] };
          if (!evt.details) evt.details = [];
          evt.details.push({ columns: tbl.columns, rows: tbl.rows });
          blocks.splice(i + 1, 1);
        }
      }
    }

    // Post-process: merge tables that immediately precede a bonding event into that event's details
    for (let i = blocks.length - 1; i >= 1; i--) {
      const prev = blocks[i - 1].block;
      const curr = blocks[i].block;
      if (
        prev.type === 'table' &&
        curr.type === 'event' &&
        (curr as any).event_type === 'bonding'
      ) {
        const tbl = prev as { columns: string[]; rows: string[][] };
        const evt = curr as { details?: Array<{ columns: string[]; rows: string[][] }> };
        if (!evt.details) evt.details = [];
        evt.details.unshift({ columns: tbl.columns, rows: tbl.rows });
        blocks.splice(i - 1, 1);
      }
    }

    // Post-process: merge consecutive bonding events into one
    for (let i = blocks.length - 1; i >= 1; i--) {
      const prev = blocks[i - 1].block;
      const curr = blocks[i].block;
      if (
        prev.type === 'event' && (prev as any).event_type === 'bonding' &&
        curr.type === 'event' && (curr as any).event_type === 'bonding'
      ) {
        // Append curr's content to prev
        const prevEvt = prev as any;
        const currEvt = curr as any;
        if (currEvt.content) {
          prevEvt.content = (prevEvt.content || '') + '\n\n' + currEvt.content;
        }
        // Merge details arrays
        if (currEvt.details) {
          if (!prevEvt.details) prevEvt.details = [];
          prevEvt.details.push(...currEvt.details);
        }
        blocks.splice(i, 1);
      }
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

const AD_PATTERNS = [
  /^\s*\\?[-–—]?\s*advertisement\s*[-–—]?\s*$/i,
  /^\s*\[?\s*ad\s*\]?\s*$/i,
  /^\s*sponsored\s*/i,
  /ad-?block/i,
  /turn off.*ad.?block/i,
  /support our writers/i,
  /ad-free subscription/i,
  /click here to upgrade/i,
  /nplus.*subscription/i,
  /adblock-replacement/i,
  /utm_campaign=ad/i,
];

const STRATEGY_KEYWORDS = /\b(attack|buff|heal|damage|HP|CP|EP|S-Craft|craft|boss|hit|phase|strategy|recommend|exploit|weak|defend|link attack|overdrive|stance)\b/i;

/** Returns true if prose text looks like boss fight strategy. */
function looksLikeStrategy(text: string): boolean {
  return STRATEGY_KEYWORDS.test(text);
}

/** Returns true for blocks that are junk: ads, empty tables, whitespace-only content. */
function isJunkBlock(block: WalkthroughBlock): boolean {
  // Empty tables (no columns, no rows)
  if (block.type === 'table') {
    const cols = (block as { columns?: string[] }).columns || [];
    const rows = (block as { rows?: string[][] }).rows || [];
    if (cols.length === 0 && rows.length === 0) return true;
  }

  // Advertisement prose
  if (block.type === 'prose' || block.type === 'callout') {
    const content = (block as { content?: string }).content || '';
    const trimmed = content.trim();
    if (trimmed === '' || trimmed === '* * *') return true;
    if (AD_PATTERNS.some(p => p.test(trimmed))) return true;
  }

  return false;
}
