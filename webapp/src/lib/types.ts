export interface WalkthroughStep {
	id: string;
	type: 'step' | 'note' | 'warning' | 'collectible' | 'boss';
	text: string;
	note?: string;
	image_url?: string;
}

export interface WalkthroughCheckpoint {
	id: string;
	label: string;
}

// ── Block types ─────────────────────────────────────────────────────────────

export interface ProseBlock {
	type: 'prose';
	heading?: string;
	content: string;
}

export interface EncounterBlock {
	type: 'encounter';
	heading?: string;
	name: string;
	stats?: Record<string, string>;
	strategy?: string;
	reward?: string;
	drops?: string;
}

export interface QuestBlock {
	type: 'quest';
	heading?: string;
	quest_type: 'main' | 'side' | 'hidden' | 'story';
	name: string;
	client?: string;
	content?: string;
	reward?: string;
}

export interface TableBlock {
	type: 'table';
	heading?: string;
	columns: string[];
	rows: string[][];
}

export interface ChecklistItem {
	id: string;
	label: string;
	detail?: string;
}

export interface ChecklistBlock {
	type: 'checklist';
	heading?: string;
	style?: 'collectible' | 'missable' | 'npc' | 'key' | 'puzzle';
	items: ChecklistItem[];
}

export interface CalloutBlock {
	type: 'callout';
	severity?: 'info' | 'warning' | 'danger';
	content: string;
}

export type WalkthroughBlock =
	| ProseBlock
	| EncounterBlock
	| QuestBlock
	| TableBlock
	| ChecklistBlock
	| CalloutBlock;

// ── Section & Walkthrough ───────────────────────────────────────────────────

export interface WalkthroughSection {
	id: string;
	title: string;
	content?: string;
	blocks?: WalkthroughBlock[];
	checkpoints?: WalkthroughCheckpoint[];
	steps?: WalkthroughStep[];
}

export interface HltbData {
	main_story?: number;
	main_story_sides?: number;
	completionist?: number;
}

export interface Walkthrough {
	id: string;
	game: string;
	title: string;
	author: string;
	source_url: string;
	attribution: string;
	created_at: string;
	cover_image?: string;
	hltb?: HltbData;
	sections: WalkthroughSection[];
}

export interface WalkthroughSummary {
	id: string;
	game: string;
	title: string;
	author: string;
	created_at: string;
	cover_image?: string;
	hltb?: HltbData;
}

/** Set of step IDs that have been checked off. */
export type CheckedSteps = Set<string>;

export interface ProgressRecord {
	walkthroughId: string;
	checkedSteps: string[];
	/** Per-step timestamps recording when each step was last toggled (ISO strings). */
	stepTimestamps?: Record<string, string>;
	updatedAt: string; // ISO timestamp
}

export interface SyncStatus {
	online: boolean;
	lastSynced: string | null;
	stale: boolean;
	remoteUpdatedAt: string | null;
}
