import { describe, it, expect } from 'vitest';
import {
	computeProgress,
	countCheckableSteps,
	formatHours,
	estimateTimeRemaining,
	HLTB_MODES,
	HLTB_MODE_LABELS,
	HLTB_MODE_FINISH_LABELS,
	HLTB_MODE_FULL_TITLES
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
