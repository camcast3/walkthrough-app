export interface WalkthroughStep {
	id: string;
	type: 'step' | 'note' | 'warning' | 'collectible' | 'boss';
	text: string;
	note?: string;
	image_url?: string;
}

export interface WalkthroughSection {
	id: string;
	title: string;
	steps: WalkthroughStep[];
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
	sections: WalkthroughSection[];
}

export interface WalkthroughSummary {
	id: string;
	game: string;
	title: string;
	author: string;
	created_at: string;
	cover_image?: string;
}

/** Set of step IDs that have been checked off. */
export type CheckedSteps = Set<string>;

export interface ProgressRecord {
	walkthroughId: string;
	checkedSteps: string[];
	updatedAt: string; // ISO timestamp
}

export interface SyncStatus {
	online: boolean;
	lastSynced: string | null;
	stale: boolean;
	remoteUpdatedAt: string | null;
}
