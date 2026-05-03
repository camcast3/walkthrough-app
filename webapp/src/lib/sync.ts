import type { ProgressRecord, SyncStatus, WalkthroughSummary } from './types.js';
import { browser } from '$app/environment';

const API_BASE = '/api';
const STALE_THRESHOLD_MS = 60_000; // show warning if remote is >60s newer
const DEVICE_ID_KEY = 'wt_device_id';

/**
 * Returns a stable per-browser device identifier, persisting it in localStorage.
 * A new random UUID is generated on first use.
 * Falls back to an empty string in non-browser (SSR) environments.
 */
export function getDeviceId(): string {
	if (!browser) return '';
	let id = localStorage.getItem(DEVICE_ID_KEY);
	if (!id) {
		id = crypto.randomUUID();
		localStorage.setItem(DEVICE_ID_KEY, id);
	}
	return id;
}

export async function fetchWalkthroughs(): Promise<WalkthroughSummary[]> {
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
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	const deviceId = getDeviceId();
	if (deviceId) headers['X-Device-ID'] = deviceId;

	await fetch(`${API_BASE}/progress/${record.walkthroughId}`, {
		method: 'PUT',
		headers,
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
 * Fetches the list of checked-out walkthrough IDs on this client.
 * Returns an empty array when the server is unreachable or returns an error.
 */
export async function fetchCheckouts(): Promise<string[]> {
	try {
		const res = await fetch(`${API_BASE}/checkouts`);
		if (!res.ok) return [];
		return res.json();
	} catch {
		return [];
	}
}

/**
 * Checks out a walkthrough on this client.
 * The server will cache the content locally for offline use.
 */
export async function checkout(walkthroughId: string): Promise<void> {
	const res = await fetch(`${API_BASE}/checkouts/${walkthroughId}`, { method: 'PUT' });
	if (!res.ok) throw new Error(`Failed to checkout walkthrough ${walkthroughId}`);
}

/**
 * Checks in (removes) a walkthrough from this client's local cache.
 */
export async function checkin(walkthroughId: string): Promise<void> {
	const res = await fetch(`${API_BASE}/checkouts/${walkthroughId}`, { method: 'DELETE' });
	if (!res.ok) throw new Error(`Failed to checkin walkthrough ${walkthroughId}`);
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

// ── Server management API ──────────────────────────────────────────────────────

export interface IngestStep {
	name: string;
	label: string;
	status: 'pending' | 'running' | 'done' | 'error';
	message?: string;
}

export interface IngestJob {
	id: string;
	input: string;
	status: 'running' | 'done' | 'error';
	steps: IngestStep[];
	walkthrough_id?: string;
	error?: string;
	started_at: string;
	updated_at: string;
}

export interface DeviceActivity {
	device_id: string;
	last_seen: string;
	walkthroughs: string[];
}

/**
 * Submits a walkthrough URL or raw JSON for ingest on the server.
 * Returns the created ingest job.
 */
export async function submitIngest(input: string): Promise<IngestJob> {
	const isUrl = input.startsWith('http://') || input.startsWith('https://');
	const body = isUrl ? { url: input } : { content: input };
	const res = await fetch(`${API_BASE}/server/ingest`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: 'Unknown error' }));
		throw new Error((err as { error: string }).error ?? 'Failed to submit ingest');
	}
	return res.json();
}

/** Fetches the current state of an ingest job by ID. */
export async function fetchIngestJob(id: string): Promise<IngestJob> {
	const res = await fetch(`${API_BASE}/server/ingest/${id}`);
	if (!res.ok) throw new Error('Ingest job not found');
	return res.json();
}

/** Lists all recent ingest jobs (newest first). */
export async function fetchIngestJobs(): Promise<IngestJob[]> {
	try {
		const res = await fetch(`${API_BASE}/server/ingest`);
		if (!res.ok) return [];
		return res.json();
	} catch {
		return [];
	}
}

/** Returns all known client devices and their walkthrough activity. */
export async function fetchDevices(): Promise<DeviceActivity[]> {
	try {
		const res = await fetch(`${API_BASE}/server/devices`);
		if (!res.ok) return [];
		return res.json();
	} catch {
		return [];
	}
}

// ── Client config API ──────────────────────────────────────────────────────────

export interface ClientConfig {
	appMode: string;
	serverUrl?: string;
	refreshInterval?: string;
	syncInterval?: string;
	cacheDir?: string;
	persistWarnings?: string[];
}

export interface ClientConfigUpdate {
	serverUrl?: string;
	refreshInterval?: string;
	syncInterval?: string;
	cacheDir?: string;
}

/** Fetches the current runtime configuration from the server. */
export async function fetchClientConfig(): Promise<ClientConfig> {
	const res = await fetch(`${API_BASE}/config`);
	if (!res.ok) throw new Error('Failed to fetch config');
	return res.json();
}

/** Updates runtime configuration settings. Returns the updated config. */
export async function updateClientConfig(update: ClientConfigUpdate): Promise<ClientConfig> {
	const res = await fetch(`${API_BASE}/config`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(update)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: 'Unknown error' }));
		throw new Error((err as { error: string }).error ?? 'Failed to update config');
	}
	return res.json();
}
