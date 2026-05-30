/**
 * Main converter orchestrator.
 * Transforms captured markdown pages into classified walkthrough sections.
 */

import { parseMarkdown } from './markdown-parser.js';
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
        const pageTokens = parseMarkdown(page.markdown);
        const title = stripSiteSuffix(page.title) || `Page ${i + 1}`;
        return {
          id: slugify(title, { lower: true, strict: true }),
          title,
          tokens: pageTokens,
        };
      })
    : rawSections;

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
