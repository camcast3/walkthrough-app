import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import { timeAgo, syncProgress, getDeviceId } from './sync.js';

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

	it('returns stale=true when remote is newer by more than 60 seconds', async () => {
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
