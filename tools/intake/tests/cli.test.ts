import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'src', 'cli.ts');
// We use tsx so we don't have to build before testing.
const RUNNER = ['npx', 'tsx', CLI];

const USE_SHELL = process.platform === 'win32';

/** Wrap args containing spaces in double-quotes for Windows cmd shell. */
function shellQuote(args: string[]): string[] {
  if (!USE_SHELL) return args;
  return args.map(a => (a.includes(' ') ? `"${a}"` : a));
}

function runCli(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  return spawnSync(RUNNER[0], shellQuote([...RUNNER.slice(1), ...args]), {
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, ...opts.env },
    encoding: 'utf-8',
    shell: USE_SHELL,
  });
}

describe('CLI — argument parsing', () => {
  it('shows version with --version', () => {
    const result = runCli(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  it('shows help with --help', () => {
    const result = runCli(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('start');
    expect(result.stdout).toContain('convert');
    expect(result.stdout).toContain('finalize');
    expect(result.stdout).toContain('set-threshold');
    expect(result.stdout).toContain('training-status');
    expect(result.stdout).toContain('graduate');
  });

  it('errors when start is missing --game', () => {
    const result = runCli(['start', '--source', 'https://example.com']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/required option.*game/i);
  });

  it('errors when start is missing --source', () => {
    const result = runCli(['start', '--game', 'Test Game']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/required option.*source/i);
  });
});

describe('CLI — training threshold commands', () => {
  let workdir: string;
  let dbPath: string;

  beforeEach(() => {
    workdir = join(tmpdir(), `cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(workdir, 'tools', 'intake'), { recursive: true });
    dbPath = join(workdir, 'tools', 'intake', 'training-data.json');
  });

  afterEach(() => {
    if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
  });

  it('set-threshold persists value to training-data.json', () => {
    const result = runCli(['set-threshold', '50'], { cwd: workdir });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('50');
    expect(existsSync(dbPath)).toBe(true);
    const db = JSON.parse(readFileSync(dbPath, 'utf-8'));
    expect(db.graduation_threshold).toBe(50);
  });

  it('set-threshold supports 100', () => {
    const result = runCli(['set-threshold', '100'], { cwd: workdir });
    expect(result.status).toBe(0);
    const db = JSON.parse(readFileSync(dbPath, 'utf-8'));
    expect(db.graduation_threshold).toBe(100);
  });

  it('set-threshold rejects zero / negative', () => {
    const result = runCli(['set-threshold', '0'], { cwd: workdir });
    expect(result.status).not.toBe(0);
  });

  it('training-status reports current configuration', () => {
    writeFileSync(dbPath, JSON.stringify({
      examples: [], graduation_status: 'training',
      walkthroughs_processed: 3, graduation_threshold: 50,
    }));
    const result = runCli(['training-status'], { cwd: workdir });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('training');
    expect(result.stdout).toMatch(/50/);
    expect(result.stdout).toMatch(/3/);
  });

  it('training-status reflects INTAKE_GRADUATION_THRESHOLD env var', () => {
    writeFileSync(dbPath, JSON.stringify({
      examples: [], graduation_status: 'training',
      walkthroughs_processed: 0, graduation_threshold: 10,
    }));
    const result = runCli(['training-status'], {
      cwd: workdir,
      env: { INTAKE_GRADUATION_THRESHOLD: '100' },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/100/);
  });

  it('graduate refuses early without --force', () => {
    writeFileSync(dbPath, JSON.stringify({
      examples: [], graduation_status: 'training',
      walkthroughs_processed: 1, graduation_threshold: 50,
    }));
    const result = runCli(['graduate'], { cwd: workdir });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/not eligible|force/i);
    // Status should be unchanged
    const db = JSON.parse(readFileSync(dbPath, 'utf-8'));
    expect(db.graduation_status).toBe('training');
  });

  it('graduate --force overrides the threshold check', () => {
    writeFileSync(dbPath, JSON.stringify({
      examples: [], graduation_status: 'training',
      walkthroughs_processed: 1, graduation_threshold: 50,
    }));
    const result = runCli(['graduate', '--force'], { cwd: workdir });
    expect(result.status).toBe(0);
    const db = JSON.parse(readFileSync(dbPath, 'utf-8'));
    expect(db.graduation_status).toBe('graduated');
  });

  it('graduate succeeds when threshold is met', () => {
    writeFileSync(dbPath, JSON.stringify({
      examples: [], graduation_status: 'training',
      walkthroughs_processed: 50, graduation_threshold: 50,
    }));
    const result = runCli(['graduate'], { cwd: workdir });
    expect(result.status).toBe(0);
    const db = JSON.parse(readFileSync(dbPath, 'utf-8'));
    expect(db.graduation_status).toBe('graduated');
  });
});

describe('CLI — start command', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = join(tmpdir(), `cli-start-${Date.now()}`);
    mkdirSync(workdir, { recursive: true });
  });

  afterEach(async () => {
    // On Windows the killed child process may still hold file locks briefly.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
        return;
      } catch {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  });

  it('creates the walkthrough directory and session.json', async () => {
    // Use a random port and kill the process quickly — we just want to verify
    // the side effects (directories + session file) happened before the server
    // started listening.
    const proc = spawnSync(RUNNER[0],
      shellQuote([...RUNNER.slice(1), 'start', '--game', 'Test Game', '--source', 'https://example.com', '--port', '0']),
      { cwd: workdir, encoding: 'utf-8', timeout: 3000, shell: USE_SHELL },
    );
    // Process is killed by timeout — we don't care about exit code, only side effects.
    const sessionPath = join(workdir, 'walkthroughs', 'test-game', '.intake', 'session.json');
    expect(existsSync(sessionPath)).toBe(true);
    const session = JSON.parse(readFileSync(sessionPath, 'utf-8'));
    expect(session.game).toBe('Test Game');
    expect(session.slug).toBe('test-game');
    expect(session.state).toBe('capturing');
  });
});
