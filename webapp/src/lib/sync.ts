import type { ProgressRecord, SyncStatus } from './types.js';

const API_BASE = '/api';
const STALE_THRESHOLD_MS = 60_000; // show warning if remote is >60s newer

export async function fetchWalkthroughs(): Promise<{ id: string; game: string; title: string; author: string; created_at: string }[]> {
	const res = await fetch(`${API_BASE}/walkthroughs`);
	if (!res.ok) throw new Error('Failed to fetch walkthroughs');
	return res.json();
}

export async function fetchWalkthrough(id: string): Promise<unknown> {
	const res = await fetch(`${API_BASE}/walkthroughs/${id}`);
	if (!res.ok) throw new Error(`Failed to fetch walkthrough ${id}`);
	return res.json();
}

export async function pushProgress(record: ProgressRecord): Promise<void> {
	await fetch(`${API_BASE}/progress/${record.walkthroughId}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(record)
	});
}

export async function pullProgress(walkthroughId: string): Promise<ProgressRecord | null> {
	try {
		const res = await fetch(`${API_BASE}/progress/${walkthroughId}`);
		if (res.status === 404) return null;
		if (!res.ok) throw new Error('Failed to pull progress');
		return res.json();
	} catch {
		return null;
	}
}

/**
 * Syncs local progress with the remote server.
 * Returns a SyncStatus describing whether the local state is stale.
 *
 * Strategy:
 * 1. Pull remote state.
 * 2. If remote is newer by > STALE_THRESHOLD_MS, return stale=true (caller shows warning).
 * 3. Otherwise push local state to server.
 */
export async function syncProgress(
	walkthroughId: string,
	localRecord: ProgressRecord | null
): Promise<SyncStatus> {
	const status: SyncStatus = {
		online: navigator.onLine,
		lastSynced: null,
		stale: false,
		remoteUpdatedAt: null
	};

	if (!navigator.onLine) return status;

	try {
		const remote = await pullProgress(walkthroughId);

		if (remote) {
			status.remoteUpdatedAt = remote.updatedAt;
			const remoteTime = new Date(remote.updatedAt).getTime();
			const localTime = localRecord ? new Date(localRecord.updatedAt).getTime() : 0;

			if (remoteTime - localTime > STALE_THRESHOLD_MS) {
				status.stale = true;
				return status;
			}
		}

		if (localRecord) {
			await pushProgress(localRecord);
			status.lastSynced = new Date().toISOString();
		}
	} catch {
		// Sync failure is non-fatal; app continues with local state.
	}

	return status;
}

/** Human-readable description of how long ago a timestamp was. */
export function timeAgo(isoTimestamp: string): string {
	const diff = Date.now() - new Date(isoTimestamp).getTime();
	const minutes = Math.floor(diff / 60_000);
	const hours = Math.floor(diff / 3_600_000);
	const days = Math.floor(diff / 86_400_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	return `${days} day${days === 1 ? '' : 's'} ago`;
}
