/**
 * Training database — stores corrections and manages graduation.
 *
 * The graduation threshold is fully configurable so you can tune how long the
 * converter stays in "review every block" mode before it starts auto-approving
 * high-confidence classifications. See the precedence order in `resolveThreshold`.
 */

/// <reference types="node" />

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { TrainingDatabase, TrainingExample, BlockType } from '../types.js';

/**
 * Default number of walkthroughs to process before the converter is eligible
 * to graduate out of training mode. Override per-run via:
 *
 *   1. Constructor option: `new RulesDB(path, { graduationThreshold: 50 })`
 *   2. Environment variable: `INTAKE_GRADUATION_THRESHOLD=100 npx intake ...`
 *   3. Field stored in the training-data.json file: `"graduation_threshold": 25`
 *
 * Precedence: constructor option > env var > file > DEFAULT_GRADUATION_THRESHOLD.
 *
 * Change this single constant to shift the project-wide default. It is also
 * exported so tests and the CLI can reference it without magic numbers.
 */
export const DEFAULT_GRADUATION_THRESHOLD = 10;

export interface RulesDBOptions {
  /** Override the graduation threshold for this instance only. */
  graduationThreshold?: number;
}

const DEFAULT_DB: TrainingDatabase = {
  examples: [],
  graduation_status: 'training',
  walkthroughs_processed: 0,
  graduation_threshold: DEFAULT_GRADUATION_THRESHOLD,
};

export class RulesDB {
  private db: TrainingDatabase;
  private path: string;
  private readonly thresholdOverride?: number;

  constructor(dbPath: string, options: RulesDBOptions = {}) {
    this.path = dbPath;
    this.thresholdOverride = options.graduationThreshold;
    this.db = existsSync(dbPath)
      ? { ...DEFAULT_DB, ...JSON.parse(readFileSync(dbPath, 'utf-8')) }
      : { ...DEFAULT_DB, examples: [] };
  }

  get data(): TrainingDatabase {
    return this.db;
  }

  get isTraining(): boolean {
    return this.db.graduation_status === 'training';
  }

  /**
   * Effective graduation threshold for this instance.
   * Precedence: constructor option > env var > stored value > module default.
   */
  get graduationThreshold(): number {
    return resolveThreshold(this.thresholdOverride, this.db.graduation_threshold);
  }

  get shouldGraduate(): boolean {
    return (
      this.db.walkthroughs_processed >= this.graduationThreshold &&
      this.db.graduation_status === 'training'
    );
  }

  /**
   * Persist a new threshold to the training database. Use this when you want
   * a permanent change rather than a per-run override.
   */
  setGraduationThreshold(value: number): void {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`graduation_threshold must be a positive integer, got ${value}`);
    }
    this.db.graduation_threshold = value;
    this.save();
  }

  addCorrection(example: TrainingExample): void {
    this.db.examples.push(example);
    this.save();
  }

  incrementWalkthroughs(): void {
    this.db.walkthroughs_processed++;
    this.save();
  }

  graduate(): void {
    this.db.graduation_status = 'graduated';
    this.save();
  }

  /** Re-enter training mode without losing accumulated examples. */
  resetGraduation(): void {
    this.db.graduation_status = 'training';
    this.save();
  }

  getAccuracyStats(): { total: number; corrections: number; accuracy: number } {
    const total = this.db.examples.length > 0
      ? Math.round(this.db.examples.length / 0.114) // rough estimate
      : 0;
    return {
      total,
      corrections: this.db.examples.length,
      accuracy: total > 0 ? (total - this.db.examples.length) / total : 1,
    };
  }

  private save(): void {
    writeFileSync(this.path, JSON.stringify(this.db, null, 2));
  }
}

/**
 * Resolve the effective graduation threshold based on precedence:
 *   1. Explicit override (e.g. from CLI flag passed through constructor)
 *   2. INTAKE_GRADUATION_THRESHOLD env var
 *   3. graduation_threshold stored in the training-data.json file
 *   4. DEFAULT_GRADUATION_THRESHOLD
 *
 * Invalid values (non-positive, non-integer, NaN) fall through to the next
 * source rather than throwing — this keeps the CLI forgiving.
 */
export function resolveThreshold(
  explicit: number | undefined,
  stored: number | undefined,
): number {
  if (isValidThreshold(explicit)) return explicit!;

  const envRaw = process.env.INTAKE_GRADUATION_THRESHOLD;
  if (envRaw !== undefined && envRaw !== '') {
    const envParsed = Number(envRaw);
    if (isValidThreshold(envParsed)) return envParsed;
  }

  if (isValidThreshold(stored)) return stored!;
  return DEFAULT_GRADUATION_THRESHOLD;
}

function isValidThreshold(n: number | undefined): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1;
}
