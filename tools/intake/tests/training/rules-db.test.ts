import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RulesDB } from '../../src/training/rules-db.js';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('RulesDB', () => {
  const testPath = join(tmpdir(), `test-training-${Date.now()}.json`);

  afterEach(() => {
    if (existsSync(testPath)) unlinkSync(testPath);
  });

  it('creates new empty database if file does not exist', () => {
    const db = new RulesDB(testPath);
    expect(db.data.examples).toEqual([]);
    expect(db.data.graduation_status).toBe('training');
    expect(db.data.walkthroughs_processed).toBe(0);
  });

  it('loads existing database from file', () => {
    writeFileSync(testPath, JSON.stringify({
      examples: [{ source_pattern: 'test', converter_guessed: 'prose', user_corrected_to: 'callout', context: {}, game: 'test', timestamp: '2026-01-01' }],
      graduation_status: 'training',
      walkthroughs_processed: 3,
    }));
    const db = new RulesDB(testPath);
    expect(db.data.examples).toHaveLength(1);
    expect(db.data.walkthroughs_processed).toBe(3);
  });

  it('addCorrection persists to file', () => {
    const db = new RulesDB(testPath);
    db.addCorrection({
      source_pattern: '| HP | Weakness |',
      converter_guessed: 'table',
      user_corrected_to: 'encounter',
      context: { heading_above: 'Boss: X' },
      game: 'test-game',
      timestamp: '2026-05-26',
    });
    expect(db.data.examples).toHaveLength(1);

    // Verify persisted
    const db2 = new RulesDB(testPath);
    expect(db2.data.examples).toHaveLength(1);
  });

  it('isTraining returns true when not graduated', () => {
    const db = new RulesDB(testPath);
    expect(db.isTraining).toBe(true);
  });

  it('shouldGraduate returns true after 10 walkthroughs', () => {
    writeFileSync(testPath, JSON.stringify({
      examples: [],
      graduation_status: 'training',
      walkthroughs_processed: 10,
    }));
    const db = new RulesDB(testPath);
    expect(db.shouldGraduate).toBe(true);
  });

  it('shouldGraduate returns false if already graduated', () => {
    writeFileSync(testPath, JSON.stringify({
      examples: [],
      graduation_status: 'graduated',
      walkthroughs_processed: 15,
    }));
    const db = new RulesDB(testPath);
    expect(db.shouldGraduate).toBe(false);
  });

  it('graduate changes status', () => {
    const db = new RulesDB(testPath);
    db.graduate();
    expect(db.data.graduation_status).toBe('graduated');
    expect(db.isTraining).toBe(false);
  });

  it('incrementWalkthroughs updates count', () => {
    const db = new RulesDB(testPath);
    db.incrementWalkthroughs();
    db.incrementWalkthroughs();
    expect(db.data.walkthroughs_processed).toBe(2);
  });

  it('resetGraduation re-enters training without losing examples', () => {
    const db = new RulesDB(testPath);
    db.addCorrection({
      source_pattern: 'x', converter_guessed: 'prose', user_corrected_to: 'callout',
      context: {}, game: 'g', timestamp: '2026-01-01',
    });
    db.graduate();
    db.resetGraduation();
    expect(db.data.graduation_status).toBe('training');
    expect(db.data.examples).toHaveLength(1);
  });
});

describe('RulesDB — configurable graduation threshold', () => {
  const testPath = join(tmpdir(), `test-threshold-${Date.now()}.json`);
  const originalEnv = process.env.INTAKE_GRADUATION_THRESHOLD;

  afterEach(() => {
    if (existsSync(testPath)) unlinkSync(testPath);
    if (originalEnv === undefined) delete process.env.INTAKE_GRADUATION_THRESHOLD;
    else process.env.INTAKE_GRADUATION_THRESHOLD = originalEnv;
  });

  it('defaults to DEFAULT_GRADUATION_THRESHOLD (10) when nothing is set', () => {
    delete process.env.INTAKE_GRADUATION_THRESHOLD;
    const db = new RulesDB(testPath);
    expect(db.graduationThreshold).toBe(10);
  });

  it('uses constructor override when provided', () => {
    delete process.env.INTAKE_GRADUATION_THRESHOLD;
    const db = new RulesDB(testPath, { graduationThreshold: 50 });
    expect(db.graduationThreshold).toBe(50);
  });

  it('uses INTAKE_GRADUATION_THRESHOLD env var when no constructor override', () => {
    process.env.INTAKE_GRADUATION_THRESHOLD = '100';
    const db = new RulesDB(testPath);
    expect(db.graduationThreshold).toBe(100);
  });

  it('uses stored value from file when env and override are unset', () => {
    delete process.env.INTAKE_GRADUATION_THRESHOLD;
    writeFileSync(testPath, JSON.stringify({
      examples: [], graduation_status: 'training', walkthroughs_processed: 0,
      graduation_threshold: 25,
    }));
    const db = new RulesDB(testPath);
    expect(db.graduationThreshold).toBe(25);
  });

  it('constructor override beats env var beats stored value', () => {
    process.env.INTAKE_GRADUATION_THRESHOLD = '100';
    writeFileSync(testPath, JSON.stringify({
      examples: [], graduation_status: 'training', walkthroughs_processed: 0,
      graduation_threshold: 25,
    }));
    const db = new RulesDB(testPath, { graduationThreshold: 7 });
    expect(db.graduationThreshold).toBe(7);
  });

  it('shouldGraduate respects the configured threshold (50)', () => {
    delete process.env.INTAKE_GRADUATION_THRESHOLD;
    writeFileSync(testPath, JSON.stringify({
      examples: [], graduation_status: 'training', walkthroughs_processed: 49,
      graduation_threshold: 50,
    }));
    const db = new RulesDB(testPath);
    expect(db.shouldGraduate).toBe(false);
    db.incrementWalkthroughs();
    expect(db.shouldGraduate).toBe(true);
  });

  it('shouldGraduate respects the configured threshold (100)', () => {
    delete process.env.INTAKE_GRADUATION_THRESHOLD;
    writeFileSync(testPath, JSON.stringify({
      examples: [], graduation_status: 'training', walkthroughs_processed: 100,
      graduation_threshold: 100,
    }));
    const db = new RulesDB(testPath);
    expect(db.shouldGraduate).toBe(true);
  });

  it('setGraduationThreshold persists and updates eligibility', () => {
    writeFileSync(testPath, JSON.stringify({
      examples: [], graduation_status: 'training', walkthroughs_processed: 60,
      graduation_threshold: 100,
    }));
    delete process.env.INTAKE_GRADUATION_THRESHOLD;
    const db = new RulesDB(testPath);
    expect(db.shouldGraduate).toBe(false);
    db.setGraduationThreshold(50);
    expect(db.graduationThreshold).toBe(50);
    expect(db.shouldGraduate).toBe(true);

    // Verify persisted across reloads
    const db2 = new RulesDB(testPath);
    expect(db2.graduationThreshold).toBe(50);
  });

  it('setGraduationThreshold rejects invalid values', () => {
    const db = new RulesDB(testPath);
    expect(() => db.setGraduationThreshold(0)).toThrow();
    expect(() => db.setGraduationThreshold(-5)).toThrow();
    expect(() => db.setGraduationThreshold(1.5)).toThrow();
  });

  it('ignores invalid env var values and falls through to stored/default', () => {
    process.env.INTAKE_GRADUATION_THRESHOLD = 'not-a-number';
    writeFileSync(testPath, JSON.stringify({
      examples: [], graduation_status: 'training', walkthroughs_processed: 0,
      graduation_threshold: 42,
    }));
    const db = new RulesDB(testPath);
    expect(db.graduationThreshold).toBe(42);
  });
});
