import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
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

describe('detectSections — Cold Steel II snapshot', () => {
  it('produces stable section breakdown for page1.md', () => {
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const fixturePath = path.join(
      dirname,
      '..',
      '..',
      '..',
      '..',
      'walkthroughs',
      'trails-of-cold-steel-ii',
      'page1.md',
    );
    const md = readFileSync(fixturePath, 'utf-8');
    const sections = detectSections(parseMarkdown(md));
    const summary = sections.map(s => ({ id: s.id, title: s.title, tokenCount: s.tokens.length }));
    expect(summary).toMatchSnapshot();
  });
});
