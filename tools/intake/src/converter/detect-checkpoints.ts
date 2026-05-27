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
