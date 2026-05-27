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
