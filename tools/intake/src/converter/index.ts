/**
 * Main converter orchestrator.
 * Transforms captured markdown pages into classified walkthrough sections.
 */

import { parseMarkdown, MarkdownToken } from './markdown-parser.js';
import { detectSections } from './detect-sections.js';
import { detectBlockType, buildBlock } from './detect-blocks.js';
import { detectCheckpoints } from './detect-checkpoints.js';
import { ConvertedSection, ClassifiedBlock, TrainingDatabase, BlockType } from '../types.js';
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

    // If no splits found, keep the original token
    if (subTables.length <= 1) {
      result.push(token);
      continue;
    }

    // Convert each sub-table chunk into its own token
    let lineOffset = token.line_start;
    for (const chunk of subTables) {
      if (chunk.length === 0) continue;

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
          // Check if first row looks like a header (all short text, no numbers at start)
          const firstRowLooksLikeHeader = firstRow.length >= 2 &&
            firstRow.every(c => c.length < 30) &&
            !firstRow[0].match(/^\d/);

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

      lineOffset += chunk.length + 2; // +2 for the separator rows skipped
    }
  }

  return result;
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
  return {
    type: 'table',
    content: lines.join('\n'),
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
