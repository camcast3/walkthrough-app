import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import { timeAgo, syncProgress, getDeviceId, mergeProgressRecords } from './sync.js';

// ── timeAgo ──────────────────────────────────────────────────────────────────

describe('timeAgo', () => {
	it('returns "just now" for a timestamp less than a minute ago', () => {
		const ts = new Date(Date.now() - 30_000).toISOString();
		expect(timeAgo(ts)).toBe('just now');
	});

	it('returns "5 minutes ago" for 5 minutes ago', () => {
		const ts = new Date(Date.now() - 5 * 60_000).toISOString();
		expect(timeAgo(ts)).toBe('5 minutes ago');
	});

	it('returns "2 hours ago" for 2 hours ago', () => {
		const ts = new Date(Date.now() - 2 * 3_600_000).toISOString();
		expect(timeAgo(ts)).toBe('2 hours ago');
	});

	it('returns "3 days ago" for 3 days ago', () => {
		const ts = new Date(Date.now() - 3 * 86_400_000).toISOString();
		expect(timeAgo(ts)).toBe('3 days ago');
	});
});

// ── mergeProgressRecords ─────────────────────────────────────────────────────

describe('mergeProgressRecords', () => {
	const base = new Date('2024-01-01T10:00:00Z');
	const later = new Date('2024-01-01T10:00:10Z');
	const evenLater = new Date('2024-01-01T10:00:20Z');

	it('keeps local step when local timestamp is newer', () => {
		const local = {
			walkthroughId: 'wt',
			checkedSteps: ['s1'],
			stepTimestamps: { s1: later.toISOString() },
			updatedAt: later.toISOString()
		};
		const remote = {
			walkthroughId: 'wt',
			checkedSteps: [],
			stepTimestamps: { s1: base.toISOString() },
			updatedAt: base.toISOString()
		};
		const merged = mergeProgressRecords(local, remote);
		expect(merged.checkedSteps).toContain('s1');
	});

	it('uses remote step when remote timestamp is newer', () => {
		const local = {
			walkthroughId: 'wt',
			checkedSteps: [],
			stepTimestamps: { s1: base.toISOString() },
			updatedAt: base.toISOString()
		};
		const remote = {
			walkthroughId: 'wt',
			checkedSteps: ['s1'],
			stepTimestamps: { s1: later.toISOString() },
			updatedAt: later.toISOString()
		};
		const merged = mergeProgressRecords(local, remote);
		expect(merged.checkedSteps).toContain('s1');
	});

	it('merges non-overlapping steps from both sides', () => {
		const local = {
			walkthroughId: 'wt',
			checkedSteps: ['s1'],
			stepTimestamps: { s1: later.toISOString() },
			updatedAt: later.toISOString()
		};
		const remote = {
			walkthroughId: 'wt',
			checkedSteps: ['s2'],
			stepTimestamps: { s2: evenLater.toISOString() },
			updatedAt: evenLater.toISOString()
		};
		const merged = mergeProgressRecords(local, remote);
		expect(merged.checkedSteps).toContain('s1');
		expect(merged.checkedSteps).toContain('s2');
	});

	it('uses remote unchecked state when remote is newer', () => {
		const local = {
			walkthroughId: 'wt',
			checkedSteps: ['s1'],
			stepTimestamps: { s1: base.toISOString() },
			updatedAt: base.toISOString()
		};
		const remote = {
			walkthroughId: 'wt',
			checkedSteps: [],
			stepTimestamps: { s1: later.toISOString() },
			updatedAt: later.toISOString()
		};
		const merged = mergeProgressRecords(local, remote);
		expect(merged.checkedSteps).not.toContain('s1');
	});

	it('sets updatedAt to the max of the two sides', () => {
		const local = {
			walkthroughId: 'wt',
			checkedSteps: [],
			stepTimestamps: {},
			updatedAt: base.toISOString()
		};
		const remote = {
			walkthroughId: 'wt',
			checkedSteps: [],
			stepTimestamps: {},
			updatedAt: evenLater.toISOString()
		};
		const merged = mergeProgressRecords(local, remote);
		expect(merged.updatedAt).toBe(evenLater.toISOString());
	});

	it('returns empty checkedSteps when neither side has timestamps', () => {
		const local = {
			walkthroughId: 'wt',
			checkedSteps: ['s1'],
			updatedAt: base.toISOString()
		};
		const remote = {
			walkthroughId: 'wt',
			checkedSteps: ['s2'],
			updatedAt: later.toISOString()
		};
		const merged = mergeProgressRecords(local, remote);
		// No timestamps → no steps can be merged
		expect(merged.checkedSteps).toHaveLength(0);
	});
});

// ── syncProgress ─────────────────────────────────────────────────────────────

describe('syncProgress', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		Object.defineProperty(navigator, 'onLine', {
			value: true,
			writable: true,
			configurable: true
		});
		globalThis.fetch = vi.fn();
	});

	it('returns offline status when navigator.onLine is false', async () => {
		Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
		const result = await syncProgress('wt-1', null);
		expect(result).toEqual({
			online: false,
			stale: false,
			lastSynced: null,
			remoteUpdatedAt: null
		});
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('pushes local record when remote returns 404 and returns lastSynced', async () => {
		const localRecord = {
			walkthroughId: 'wt-1',
			checkedSteps: ['s1'],
			updatedAt: new Date().toISOString()
		};

		(globalThis.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ status: 404, ok: false, json: vi.fn() }) // pullProgress
			.mockResolvedValueOnce({ ok: true }); // pushProgress

		const result = await syncProgress('wt-1', localRecord);
		expect(result.lastSynced).not.toBeNull();
		expect(result.stale).toBe(false);
	});

	it('returns stale=true when remote is newer by more than 60 seconds (legacy records)', async () => {
		const remoteUpdatedAt = new Date(Date.now() + 120_000).toISOString();
		const localRecord = {
			walkthroughId: 'wt-1',
			checkedSteps: [],
			updatedAt: new Date(Date.now() - 120_000).toISOString()
		};

		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			status: 200,
			ok: true,
			json: vi.fn().mockResolvedValue({
				walkthroughId: 'wt-1',
				checkedSteps: ['s1'],
				updatedAt: remoteUpdatedAt
			})
		});

		const result = await syncProgress('wt-1', localRecord);
		expect(result.stale).toBe(true);
		expect(result.remoteUpdatedAt).toBe(remoteUpdatedAt);
	});

	it('merges via stepTimestamps when both sides have timestamps', async () => {
		const base = new Date('2024-01-01T10:00:00Z');
		const later = new Date('2024-01-01T10:00:10Z');

		const localRecord = {
			walkthroughId: 'wt-1',
			checkedSteps: ['s1'],
			stepTimestamps: { s1: later.toISOString(), s2: base.toISOString() },
			updatedAt: later.toISOString()
		};
		const remoteRecord = {
			walkthroughId: 'wt-1',
			checkedSteps: ['s2'],
			stepTimestamps: { s1: base.toISOString(), s2: later.toISOString() },
			updatedAt: later.toISOString()
		};

		(globalThis.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				status: 200,
				ok: true,
				json: vi.fn().mockResolvedValue(remoteRecord)
			})
			.mockResolvedValueOnce({ ok: true }); // pushProgress (merged)

		const result = await syncProgress('wt-1', localRecord);
		expect(result.stale).toBe(false);
		expect(result.lastSynced).not.toBeNull();
	});

	it('pushes local when remote is not newer and returns stale=false', async () => {
		const remoteUpdatedAt = new Date(Date.now() - 10_000).toISOString();
		const localRecord = {
			walkthroughId: 'wt-1',
			checkedSteps: ['s1'],
			updatedAt: new Date().toISOString()
		};

		(globalThis.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				status: 200,
				ok: true,
				json: vi.fn().mockResolvedValue({
					walkthroughId: 'wt-1',
					checkedSteps: [],
					updatedAt: remoteUpdatedAt
				})
			})
			.mockResolvedValueOnce({ ok: true }); // pushProgress

		const result = await syncProgress('wt-1', localRecord);
		expect(result.stale).toBe(false);
		expect(result.lastSynced).not.toBeNull();
	});

	it('returns lastSynced=null when no local record and remote returns 404', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			status: 404,
			ok: false,
			json: vi.fn()
		});

		const result = await syncProgress('wt-1', null);
		expect(result.lastSynced).toBeNull();
	});
});

// ── getDeviceId ───────────────────────────────────────────────────────────────

describe('getDeviceId', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('generates and persists a UUID on first call', () => {
		const id = getDeviceId();
		expect(id).toBeTruthy();
		expect(localStorage.getItem('wt_device_id')).toBe(id);
	});

	it('returns the same value on subsequent calls', () => {
		const first = getDeviceId();
		const second = getDeviceId();
		expect(second).toBe(first);
	});
});
