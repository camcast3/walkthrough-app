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
