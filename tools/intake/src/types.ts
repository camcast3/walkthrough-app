// Shared types for the intake system — mirrors walkthrough.schema.json block types

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
  adds?: Array<{ name: string; stats?: Record<string, string> }>;
  strategy?: string;
  reward?: string;
  drops?: string;
}

export interface QuestBlock {
  type: 'quest';
  heading?: string;
  /**
   * - main: required story quest
   * - side: optional quest, can usually be picked up later
   * - missable: optional quest that is permanently lost if not done in a specific window
   *   (e.g. Cold Steel side quests that expire when the chapter advances)
   * - hidden: not shown on the quest board; must be discovered
   * - story: narrative beat, not a tracked quest
   */
  quest_type: 'main' | 'side' | 'missable' | 'hidden' | 'story';
  name: string;
  client?: string;
  content?: string;
  reward?: string;
  /** If quest_type === 'missable', when/why it becomes unavailable. */
  missable_window?: string;
}

/**
 * Time-limited / missable events that aren't full quests — e.g. Cold Steel
 * bonding events, one-off NPC conversations, scripted cutscenes that only
 * trigger in a narrow window. These are easy to miss on a blind playthrough
 * and the walkthrough flags them explicitly.
 */
export interface EventBlock {
  type: 'event';
  heading?: string;
  /**
   * - bonding: relationship / social link event (Cold Steel bonding events, Persona S-links)
   * - conversation: optional NPC dialogue that only appears in a specific window
   * - cutscene: scripted scene with a trigger condition
   * - collectible: one-time pickup tied to a window (e.g. chest only available in chapter 1)
   * - other: anything else that's missable but not a quest
   */
  event_type: 'bonding' | 'conversation' | 'cutscene' | 'collectible' | 'other';
  name: string;
  /** Who/where it triggers — e.g. "Laura — Thors training hall". */
  trigger?: string;
  /** Window during which the event is available, e.g. "Chapter 1, free day only". */
  availability?: string;
  /** True if missing this permanently locks out content (achievement, bond level, item). */
  missable: boolean;
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

export type BlockType = 'prose' | 'encounter' | 'quest' | 'event' | 'table' | 'checklist' | 'callout';

export type WalkthroughBlock =
  | ProseBlock
  | EncounterBlock
  | QuestBlock
  | EventBlock
  | TableBlock
  | ChecklistBlock
  | CalloutBlock;

export interface WalkthroughCheckpoint {
  id: string;
  label: string;
}

export interface WalkthroughSection {
  id: string;
  title: string;
  blocks: WalkthroughBlock[];
  checkpoints: WalkthroughCheckpoint[];
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

// ── Intake-specific types ───────────────────────────────────────────────────

export interface IntakeSession {
  game: string;
  slug: string;
  source_url: string;
  pages_captured: number;
  state: 'capturing' | 'converting' | 'reviewing' | 'finalized';
  created_at: string;
}

export interface PageCapture {
  page_number: number;
  title: string;
  url: string;
  markdown: string;
  captured_at: string;
}

export interface ClassifiedBlock {
  block: WalkthroughBlock;
  confidence: number;
  source_line_start: number;
  source_line_end: number;
  approved: boolean;
}

export interface ConvertedSection {
  id: string;
  title: string;
  blocks: ClassifiedBlock[];
  checkpoints: WalkthroughCheckpoint[];
  approved: boolean;
}

export interface TrainingExample {
  source_pattern: string;
  converter_guessed: BlockType;
  user_corrected_to: BlockType;
  context: {
    heading_above?: string;
    heading_level?: number;
    surrounding_types?: BlockType[];
    source_site?: string;
  };
  game: string;
  timestamp: string;
}

export interface TrainingDatabase {
  examples: TrainingExample[];
  graduation_status: 'training' | 'graduated';
  walkthroughs_processed: number;
  /**
   * Number of walkthroughs to process before becoming eligible for graduation.
   * Defaults to `DEFAULT_GRADUATION_THRESHOLD` (10) but can be set per project —
   * a hobbyist might use 5 to graduate fast, while a serious training run might
   * set this to 50 or 100. Persisted to training-data.json so the choice
   * survives across runs.
   */
  graduation_threshold?: number;
}
