import { describe, it, expect } from 'vitest';
import {
	computeProgress,
	countCheckableSteps,
	formatHours,
	estimateTimeRemaining,
	HLTB_MODES,
	HLTB_MODE_LABELS,
	HLTB_MODE_FINISH_LABELS,
	HLTB_MODE_FULL_TITLES,
	INLINE_CHECKABLE_RE
} from './state.js';

describe('computeProgress', () => {
	it('returns 0 when no steps are checked', () => {
		expect(computeProgress(new Set(), 5)).toBe(0);
	});

	it('returns 0 when totalSteps is 0 (no divide-by-zero)', () => {
		expect(computeProgress(new Set(), 0)).toBe(0);
	});

	it('returns 60 when 3 of 5 steps are checked', () => {
		expect(computeProgress(new Set(['a', 'b', 'c']), 5)).toBe(60);
	});

	it('returns 100 when all steps are checked', () => {
		expect(computeProgress(new Set(['a', 'b', 'c', 'd', 'e']), 5)).toBe(100);
	});
});

describe('countCheckableSteps', () => {
	it('returns 0 for sections with only note-type steps', () => {
		const sections = [{ steps: [{ type: 'note' }, { type: 'note' }] }];
		expect(countCheckableSteps(sections)).toBe(0);
	});

	it('counts non-note step types (step, warning, collectible, boss)', () => {
		const sections = [
			{
				steps: [
					{ type: 'step' },
					{ type: 'warning' },
					{ type: 'collectible' },
					{ type: 'boss' },
					{ type: 'note' }
				]
			}
		];
		expect(countCheckableSteps(sections)).toBe(4);
	});

	it('counts checkpoints', () => {
		const sections = [{ checkpoints: [{ id: 'cp1' }, { id: 'cp2' }] }];
		expect(countCheckableSteps(sections)).toBe(2);
	});

	it('counts both steps and checkpoints together', () => {
		const sections = [
			{
				steps: [{ type: 'step' }, { type: 'note' }],
				checkpoints: [{ id: 'cp1' }]
			}
		];
		expect(countCheckableSteps(sections)).toBe(2);
	});

	it('returns 0 for an empty sections array', () => {
		expect(countCheckableSteps([])).toBe(0);
	});

	it('counts inline collectible markers in section content', () => {
		const sections = [
			{
				content:
					'Pick up the chest <!-- collectible: stone-brooch | Stone Brooch --> here.\n' +
					'And another <!-- collectible: teara-balm | Teara Balm -->.'
			}
		];
		expect(countCheckableSteps(sections)).toBe(2);
	});

	it('counts inline missable and side_quest markers in section content', () => {
		const sections = [
			{
				content:
					'<!-- missable: imperial-chronicle-1 | Buy Imperial Chronicle Issue #1 -->\n' +
					'<!-- side_quest: munch-no-more | Side Quest: Munch no More -->'
			}
		];
		expect(countCheckableSteps(sections)).toBe(2);
	});

	it('combines inline markers with checkpoints and steps', () => {
		const sections = [
			{
				steps: [{ type: 'step' }],
				checkpoints: [{ id: 'cp1' }],
				content: 'Grab the <!-- collectible: item-1 | Item 1 --> from the chest.'
			}
		];
		// 1 step + 1 checkpoint + 1 inline collectible = 3
		expect(countCheckableSteps(sections)).toBe(3);
	});

	it('counts checklist block items', () => {
		const sections = [
			{
				blocks: [
					{
						type: 'checklist',
						items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
					}
				]
			}
		];
		expect(countCheckableSteps(sections)).toBe(3);
	});

	it('counts inline markers inside prose blocks', () => {
		const sections = [
			{
				blocks: [
					{
						type: 'prose',
						content: 'Get the <!-- collectible: gem-1 | Gem --> and <!-- missable: key-2 | Key -->.'
					}
				]
			}
		];
		expect(countCheckableSteps(sections)).toBe(2);
	});

	it('combines steps, checkpoints, section content markers, and block items', () => {
		const sections = [
			{
				steps: [{ type: 'step' }, { type: 'note' }],
				checkpoints: [{ id: 'cp1' }],
				content: '<!-- collectible: inline-1 | Inline Item -->',
				blocks: [
					{
						type: 'checklist',
						items: [{ id: 'cl-1' }, { id: 'cl-2' }]
					},
					{
						type: 'prose',
						content: '<!-- missable: prose-miss-1 | Missable -->'
					},
					{
						type: 'table'
					}
				]
			}
		];
		// 1 step + 1 checkpoint + 1 inline + 2 checklist items + 1 prose block inline = 6
		expect(countCheckableSteps(sections)).toBe(6);
	});
});

describe('INLINE_CHECKABLE_RE', () => {
	it('matches collectible markers', () => {
		const text = '<!-- collectible: stone-brooch | Stone Brooch -->';
		const matches = Array.from(text.matchAll(INLINE_CHECKABLE_RE));
		expect(matches).toHaveLength(1);
		expect(matches[0][1]).toBe('collectible');
		expect(matches[0][2]).toBe('stone-brooch');
		expect(matches[0][3].trim()).toBe('Stone Brooch');
	});

	it('matches missable markers', () => {
		const text = '<!-- missable: key-item-1 | Key Item -->';
		const matches = Array.from(text.matchAll(INLINE_CHECKABLE_RE));
		expect(matches).toHaveLength(1);
		expect(matches[0][1]).toBe('missable');
		expect(matches[0][2]).toBe('key-item-1');
	});

	it('matches side_quest markers', () => {
		const text = '<!-- side_quest: munch-no-more | Munch no More -->';
		const matches = Array.from(text.matchAll(INLINE_CHECKABLE_RE));
		expect(matches).toHaveLength(1);
		expect(matches[0][1]).toBe('side_quest');
	});

	it('does not match checkpoint markers', () => {
		const text = '<!-- checkpoint: boss-defeated | Boss Defeated -->';
		const matches = Array.from(text.matchAll(INLINE_CHECKABLE_RE));
		expect(matches).toHaveLength(0);
	});

	it('matches multiple markers in one string', () => {
		const text =
			'<!-- collectible: item-1 | Item 1 --> some text <!-- missable: item-2 | Item 2 -->';
		const matches = Array.from(text.matchAll(INLINE_CHECKABLE_RE));
		expect(matches).toHaveLength(2);
	});
});

describe('formatHours', () => {
	it('returns "< 1m" for 0 hours', () => {
		expect(formatHours(0)).toBe('< 1m');
	});

	it('returns "30m" for 0.5 hours', () => {
		expect(formatHours(0.5)).toBe('30m');
	});

	it('returns "1h" for 1 hour', () => {
		expect(formatHours(1)).toBe('1h');
	});

	it('returns "1h 30m" for 1.5 hours', () => {
		expect(formatHours(1.5)).toBe('1h 30m');
	});

	it('returns "24h" for 24 hours', () => {
		expect(formatHours(24)).toBe('24h');
	});

	it('returns "24h 30m" for 24.5 hours', () => {
		expect(formatHours(24.5)).toBe('24h 30m');
	});
});

describe('estimateTimeRemaining', () => {
	it('returns null when totalHours is undefined', () => {
		expect(estimateTimeRemaining(undefined, 0)).toBeNull();
	});

	it('returns null when totalHours is 0', () => {
		expect(estimateTimeRemaining(0, 0)).toBeNull();
	});

	it('returns full hours at 0% progress', () => {
		expect(estimateTimeRemaining(10, 0)).toBe(10);
	});

	it('returns half hours at 50% progress', () => {
		expect(estimateTimeRemaining(10, 50)).toBe(5);
	});

	it('returns 0 at 100% progress', () => {
		expect(estimateTimeRemaining(10, 100)).toBe(0);
	});

	it('clamps negative remaining values to 0', () => {
		expect(estimateTimeRemaining(10, 110)).toBe(0);
	});
});

describe('HLTB constants', () => {
	it('HLTB_MODES has exactly 3 elements', () => {
		expect(HLTB_MODES).toHaveLength(3);
	});

	it('all three modes appear as keys in HLTB_MODE_LABELS', () => {
		for (const mode of HLTB_MODES) {
			expect(mode in HLTB_MODE_LABELS).toBe(true);
		}
	});

	it('all three modes appear as keys in HLTB_MODE_FINISH_LABELS', () => {
		for (const mode of HLTB_MODES) {
			expect(mode in HLTB_MODE_FINISH_LABELS).toBe(true);
		}
	});

	it('all three modes appear as keys in HLTB_MODE_FULL_TITLES', () => {
		for (const mode of HLTB_MODES) {
			expect(mode in HLTB_MODE_FULL_TITLES).toBe(true);
		}
	});
});
