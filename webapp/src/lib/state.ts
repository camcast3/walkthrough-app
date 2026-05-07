import { get, set, del } from 'idb-keyval';
import type { ProgressRecord } from './types.js';

const KEY_PREFIX = 'wt_progress_';
const HISTORY_PREFIX = 'wt_progress_history_';
const MAX_SNAPSHOTS = 5;

function key(walkthroughId: string): string {
	return `${KEY_PREFIX}${walkthroughId}`;
}

function historyKey(walkthroughId: string): string {
	return `${HISTORY_PREFIX}${walkthroughId}`;
}

export async function loadProgress(walkthroughId: string): Promise<ProgressRecord | null> {
	const record = await get<ProgressRecord>(key(walkthroughId));
	return record ?? null;
}

/**
 * Saves the current progress state to IndexedDB.
 *
 * When `changedStepId` is provided, the timestamp for that step is updated to
 * the current time, recording exactly when each step was last toggled. This
 * enables rsync-like merging during sync: whichever device toggled a step
 * most recently "wins" when the two states are merged.
 *
 * A snapshot of the previous state is also saved (up to MAX_SNAPSHOTS kept)
 * to support Simple File Version (SFV) reverting.
 */
export async function saveProgress(
	walkthroughId: string,
	checkedSteps: Set<string>,
	existingTimestamps: Record<string, string> = {},
	changedStepId?: string
): Promise<ProgressRecord> {
	const stepTimestamps: Record<string, string> = { ...existingTimestamps };
	if (changedStepId) {
		stepTimestamps[changedStepId] = new Date().toISOString();
	}

	const record: ProgressRecord = {
		walkthroughId,
		checkedSteps: Array.from(checkedSteps),
		stepTimestamps,
		updatedAt: new Date().toISOString()
	};

	// Save a snapshot of the previous state before overwriting.
	const previous = await get<ProgressRecord>(key(walkthroughId));
	if (previous) {
		await _appendSnapshot(walkthroughId, previous);
	}

	await set(key(walkthroughId), record);
	return record;
}

/** Appends a snapshot to the history list and trims to MAX_SNAPSHOTS. */
async function _appendSnapshot(walkthroughId: string, record: ProgressRecord): Promise<void> {
	const history = (await get<ProgressRecord[]>(historyKey(walkthroughId))) ?? [];
	history.unshift(record);
	if (history.length > MAX_SNAPSHOTS) {
		history.length = MAX_SNAPSHOTS;
	}
	await set(historyKey(walkthroughId), history);
}

/**
 * Returns the last MAX_SNAPSHOTS saved snapshots for a walkthrough, newest first.
 * Returns an empty array when no history exists.
 */
export async function loadProgressHistory(walkthroughId: string): Promise<ProgressRecord[]> {
	return (await get<ProgressRecord[]>(historyKey(walkthroughId))) ?? [];
}

/**
 * Reverts progress to a historical snapshot by index (0 = most recent).
 * Saves the reverted state as the current progress and records the pre-revert
 * state as a new snapshot.
 */
export async function revertToSnapshot(
	walkthroughId: string,
	snapshotIndex: number
): Promise<ProgressRecord | null> {
	const history = await loadProgressHistory(walkthroughId);
	if (snapshotIndex < 0 || snapshotIndex >= history.length) return null;
	const target = history[snapshotIndex];
	// Re-save via saveProgress so the pre-revert state is preserved in history.
	return saveProgress(
		walkthroughId,
		new Set(target.checkedSteps),
		target.stepTimestamps ?? {}
	);
}

export async function clearProgress(walkthroughId: string): Promise<void> {
	await del(key(walkthroughId));
	await del(historyKey(walkthroughId));
}

/** Returns how many steps are checked out of total. */
export function computeProgress(checkedSteps: Set<string>, totalSteps: number): number {
	if (totalSteps === 0) return 0;
	return Math.round((checkedSteps.size / totalSteps) * 100);
}

/** Regex matching inline checkable markers embedded in section content. */
export const INLINE_CHECKABLE_RE = /<!--\s*(collectible|missable|side_quest):\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*(?:\|\s*(.*?))?\s*-->/g;

/** Count all checkable items (steps, checkpoints, inline markers, checklist block items, headed prose blocks, encounter blocks, quest blocks, and table rows) in a walkthrough. */
export function countCheckableSteps(sections: { id?: string; steps?: { type: string }[]; checkpoints?: { id: string }[]; content?: string; blocks?: { type: string; heading?: string; items?: { id: string }[]; content?: string; rows?: string[][] }[] }[]): number {
	return sections.reduce(
		(total, section) => {
			const stepCount = (section.steps ?? []).filter((s) => s.type !== 'note').length;
			const cpCount = (section.checkpoints ?? []).length;
			const inlineCount = section.content
				? Array.from(section.content.matchAll(INLINE_CHECKABLE_RE)).length
				: 0;

			let blockCount = 0;
			for (const block of section.blocks ?? []) {
				if (block.type === 'checklist' && block.items) {
					blockCount += block.items.length;
				}
				if (block.type === 'prose' && block.content) {
					blockCount += Array.from(block.content.matchAll(INLINE_CHECKABLE_RE)).length;
				}
				// Headed prose blocks are themselves checkable (block-level checkbox)
				if (block.type === 'prose' && block.heading) {
					blockCount += 1;
				}
				// Encounter blocks are checkable (block-level checkbox)
				if (block.type === 'encounter') {
					blockCount += 1;
				}
				// Quest blocks are checkable (block-level checkbox)
				if (block.type === 'quest') {
					blockCount += 1;
				}
				// Table rows are individually checkable (only when table has a heading)
				if (block.type === 'table' && block.heading && block.rows) {
					blockCount += block.rows.length;
				}
			}

			return total + stepCount + cpCount + inlineCount + blockCount;
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

/** Human-readable short labels for each HLTB time category. */
export const HLTB_MODE_LABELS = {
	main_story: 'Story',
	main_story_sides: '+Sides',
	completionist: '100%'
} as const;

/** Context labels describing what each HLTB mode means for time-remaining text. */
export const HLTB_MODE_FINISH_LABELS = {
	main_story: 'to finish',
	main_story_sides: 'with sides',
	completionist: 'to 100%'
} as const;

/** Full descriptive titles for each HLTB time category, matching HLTB naming conventions. */
export const HLTB_MODE_FULL_TITLES = {
	main_story: 'Main Story',
	main_story_sides: 'Main Story + Sides',
	completionist: 'Completionist (100%)'
} as const;

/** Canonical ordered list of all HLTB time categories. */
export const HLTB_MODES = ['main_story', 'main_story_sides', 'completionist'] as const;

export type HltbMode = (typeof HLTB_MODES)[number];
