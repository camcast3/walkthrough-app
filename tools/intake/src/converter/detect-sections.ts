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
