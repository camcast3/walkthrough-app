import { get, set, del } from 'idb-keyval';
import type { ProgressRecord } from './types.js';

const KEY_PREFIX = 'wt_progress_';

function key(walkthroughId: string): string {
	return `${KEY_PREFIX}${walkthroughId}`;
}

export async function loadProgress(walkthroughId: string): Promise<ProgressRecord | null> {
	const record = await get<ProgressRecord>(key(walkthroughId));
	return record ?? null;
}

export async function saveProgress(walkthroughId: string, checkedSteps: Set<string>): Promise<ProgressRecord> {
	const record: ProgressRecord = {
		walkthroughId,
		checkedSteps: Array.from(checkedSteps),
		updatedAt: new Date().toISOString()
	};
	await set(key(walkthroughId), record);
	return record;
}

export async function clearProgress(walkthroughId: string): Promise<void> {
	await del(key(walkthroughId));
}

/** Returns how many steps are checked out of total. */
export function computeProgress(checkedSteps: Set<string>, totalSteps: number): number {
	if (totalSteps === 0) return 0;
	return Math.round((checkedSteps.size / totalSteps) * 100);
}

/** Count all checkable items (steps with type !== 'note', plus checkpoints) in a walkthrough. */
export function countCheckableSteps(sections: { steps?: { type: string }[]; checkpoints?: { id: string }[] }[]): number {
	return sections.reduce(
		(total, section) => {
			const stepCount = (section.steps ?? []).filter((s) => s.type !== 'note').length;
			const cpCount = (section.checkpoints ?? []).length;
			return total + stepCount + cpCount;
		},
		0
	);
}

/**
 * Formats a number of hours into a human-readable string like "24h 30m" or "1h 45m".
 * Values under 1 minute are shown as "< 1m".
 */
export function formatHours(hours: number): string {
	const totalMinutes = Math.round(hours * 60);
	if (totalMinutes < 1) return '< 1m';
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	if (h === 0) return `${m}m`;
	if (m === 0) return `${h}h`;
	return `${h}h ${m}m`;
}

/**
 * Estimates remaining time (in hours) given a total HLTB estimate and current progress percentage.
 * Returns null when totalHours is not provided.
 */
export function estimateTimeRemaining(totalHours: number | undefined, progressPct: number): number | null {
	if (totalHours == null || totalHours <= 0) return null;
	const remaining = totalHours * (1 - progressPct / 100);
	return Math.max(0, remaining);
}
