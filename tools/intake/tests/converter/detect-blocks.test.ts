import { describe, it, expect } from 'vitest';
import { detectBlockType, buildBlock } from '../../src/converter/detect-blocks.js';
import { MarkdownToken } from '../../src/converter/markdown-parser.js';

const makeToken = (overrides: Partial<MarkdownToken>): MarkdownToken => ({
  type: 'paragraph',
  content: 'Default content',
  line_start: 0,
  line_end: 0,
  ...overrides,
});

const defaultContext = { surrounding_types: [] as any[] };

describe('detectBlockType', () => {
  it('classifies plain paragraphs as prose', () => {
    const token = makeToken({ content: 'Head north and talk to the guard.' });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('prose');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('classifies tables with encounter stats as encounter', () => {
    const token = makeToken({
      type: 'table',
      content: '| Name | HP | Weakness |\n|---|---|---|\n| Ortheim | 12000 | Fire |',
    });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('encounter');
  });

  it('classifies tables without encounter stats as table', () => {
    const token = makeToken({
      type: 'table',
      content: '| Item | Price | Location |\n|---|---|---|\n| Potion | 100 | Shop |',
    });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('table');
  });

  it('classifies blockquotes as callout', () => {
    const token = makeToken({ type: 'blockquote', content: 'Be careful here!' });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('callout');
  });

  it('classifies paragraphs starting with Warning as callout', () => {
    const token = makeToken({ content: 'Warning: This boss is missable!' });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('callout');
  });

  it('classifies text with quest patterns as quest', () => {
    const token = makeToken({ content: 'Side Quest: Find the missing cat' });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('quest');
  });

  it('uses heading context for encounter detection', () => {
    const token = makeToken({ content: 'This boss uses fire attacks...' });
    const context = { heading_above: 'Boss: Flame Dragon', surrounding_types: [] as any[] };
    const result = detectBlockType(token, context, null);
    expect(result.block_type).toBe('encounter');
  });

  it('classifies lists with location items as checklist', () => {
    const token = makeToken({
      type: 'list',
      content: '- Golden Orb (location: north tower)\n- Silver Key (location: basement)\n- Red Gem (location: east wing)',
    });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('checklist');
  });

  it('classifies regular lists as prose', () => {
    const token = makeToken({
      type: 'list',
      content: '- Go north\n- Talk to NPC',
    });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('prose');
  });

  it('respects training corrections over defaults', () => {
    const token = makeToken({
      type: 'table',
      content: '| Item | Qty |\n|---|---|\n| Herb | 3 |',
    });
    const training = {
      examples: [{
        source_pattern: '| Item | Qty |',
        converter_guessed: 'table' as const,
        user_corrected_to: 'checklist' as const,
        context: { heading_above: undefined },
        game: 'test',
        timestamp: '2026-01-01',
      }],
      graduation_status: 'training' as const,
      walkthroughs_processed: 1,
    };
    const result = detectBlockType(token, defaultContext, training);
    expect(result.block_type).toBe('checklist');
  });
});

describe('buildBlock', () => {
  it('builds a prose block with heading context', () => {
    const token = makeToken({ content: 'Walk north to the plaza.' });
    const block = buildBlock(token, 'prose', { heading_above: 'Day 1', surrounding_types: [] });
    expect(block).toEqual({
      type: 'prose',
      heading: 'Day 1',
      content: 'Walk north to the plaza.',
    });
  });

  it('builds an encounter block from stats table', () => {
    const token = makeToken({
      type: 'table',
      content: '| Name | HP | Weakness |\n|---|---|---|\n| Dragon | 9999 | Ice |',
    });
    const block = buildBlock(token, 'encounter', { heading_above: 'Boss: Dragon', surrounding_types: [] });
    expect(block.type).toBe('encounter');
    expect((block as any).name).toBe('Dragon');
    expect((block as any).stats).toEqual({ Name: 'Dragon', HP: '9999', Weakness: 'Ice' });
  });

  it('builds a callout block and strips severity prefix', () => {
    const token = makeToken({ content: 'Warning: Missable item ahead!' });
    const block = buildBlock(token, 'callout', defaultContext);
    expect(block.type).toBe('callout');
    expect((block as any).severity).toBe('warning');
    expect((block as any).content).toBe('Missable item ahead!');
  });

  it('builds a table block from markdown table', () => {
    const token = makeToken({
      type: 'table',
      content: '| Shop | Price |\n|---|---|\n| Potion | 50 |\n| Ether | 100 |',
    });
    const block = buildBlock(token, 'table', defaultContext);
    expect(block.type).toBe('table');
    expect((block as any).columns).toEqual(['Shop', 'Price']);
    expect((block as any).rows).toHaveLength(2);
  });

  it('builds a quest block with detected type', () => {
    const token = makeToken({ content: 'Side Quest: The Missing Cat' });
    const block = buildBlock(token, 'quest', { heading_above: 'Optional', surrounding_types: [] });
    expect(block.type).toBe('quest');
    expect((block as any).quest_type).toBe('side');
    expect((block as any).name).toBe('The Missing Cat');
  });

  it('flags a missable quest when text says missable', () => {
    const token = makeToken({
      content: 'Side Quest: Help the merchant. This quest is permanently missable if you leave the area.',
    });
    const block = buildBlock(token, 'quest', { heading_above: 'Optional', surrounding_types: [] });
    expect((block as any).quest_type).toBe('missable');
    expect((block as any).missable_window).toBeDefined();
  });

  it('flags a missable quest when explicitly labeled', () => {
    const token = makeToken({
      content: 'Missable Quest: The Vanishing Cat. Only available during Chapter 1.',
    });
    const block = buildBlock(token, 'quest', defaultContext);
    expect((block as any).quest_type).toBe('missable');
    expect((block as any).missable_window).toBe('Chapter 1');
  });

  it('builds an event block for a Cold Steel bonding event', () => {
    const token = makeToken({
      content: 'Talk to Laura at the training hall to start her bonding event. Only available during free time on Day 2.',
    });
    const block = buildBlock(token, 'event', {
      heading_above: 'Bonding Event: Laura',
      surrounding_types: [],
    });
    expect(block.type).toBe('event');
    expect((block as any).event_type).toBe('bonding');
    expect((block as any).name).toBe('Laura');
    expect((block as any).missable).toBe(true);
    expect((block as any).trigger).toContain('Laura');
    expect((block as any).availability).toBe('free time on Day 2');
  });

  it('marks non-missable events as missable:false', () => {
    const token = makeToken({
      content: 'A scripted cutscene plays when you enter the throne room.',
    });
    const block = buildBlock(token, 'event', {
      heading_above: 'Cutscene: Throne Room',
      surrounding_types: [],
    });
    expect(block.type).toBe('event');
    expect((block as any).event_type).toBe('cutscene');
    expect((block as any).missable).toBe(false);
  });
});

describe('detectBlockType — events and missables', () => {
  it('classifies bonding event headings as event', () => {
    const token = makeToken({ content: 'Talk to Laura at the training hall.' });
    const result = detectBlockType(token, {
      heading_above: 'Bonding Event: Laura',
      surrounding_types: [],
    }, null);
    expect(result.block_type).toBe('event');
  });

  it('classifies text mentioning missable conversation as event', () => {
    const token = makeToken({
      content: 'There is a one-time conversation with the merchant only available during Chapter 2.',
    });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('event');
  });

  it('classifies missable side quest text as quest (not event)', () => {
    const token = makeToken({
      content: 'Side Quest: The Lost Sword. This quest is missable after Chapter 3.',
    });
    const result = detectBlockType(token, defaultContext, null);
    expect(result.block_type).toBe('quest');
  });

  it('builds a checklist from list items', () => {
    const token = makeToken({
      type: 'list',
      content: '- Red Orb — North Tower\n- Blue Key — Basement',
    });
    const block = buildBlock(token, 'checklist', defaultContext);
    expect(block.type).toBe('checklist');
    expect((block as any).items).toHaveLength(2);
    expect((block as any).items[0].label).toBe('Red Orb');
    expect((block as any).items[0].detail).toBe('North Tower');
  });
});
