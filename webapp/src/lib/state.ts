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

/** Count all checkable steps (type !== 'note') in a walkthrough. */
export function countCheckableSteps(sections: { steps: { type: string }[] }[]): number {
	return sections.reduce(
		(total, section) => total + section.steps.filter((s) => s.type !== 'note').length,
		0
	);
}
