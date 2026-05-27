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
