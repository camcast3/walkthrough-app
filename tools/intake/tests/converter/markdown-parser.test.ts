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
