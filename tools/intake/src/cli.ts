#!/usr/bin/env node
/**
 * Intake CLI — entry point for the walkthrough intake system.
 * Commands: start, convert, review, finalize
 */

import { Command } from 'commander';
import { createServer } from './server.js';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import slugify from 'slugify';
import { IntakeSession } from './types.js';

const program = new Command();

program
  .name('intake')
  .description('Walkthrough intake system — capture, convert, review, finalize')
  .version('1.0.0');

program
  .command('start')
  .description('Start an intake session for a new walkthrough')
  .requiredOption('--game <name>', 'Game title')
  .requiredOption('--source <url>', 'Source walkthrough URL')
  .option('--port <number>', 'Server port', '3847')
  .action(async (opts) => {
    const slug = slugify(opts.game, { lower: true, strict: true });
    const walkthroughDir = join(process.cwd(), 'walkthroughs', slug);
    const intakeDir = join(walkthroughDir, '.intake');

    mkdirSync(join(intakeDir, 'pages'), { recursive: true });

    const session: IntakeSession = {
      game: opts.game,
      slug,
      source_url: opts.source,
      pages_captured: 0,
      state: 'capturing',
      created_at: new Date().toISOString(),
    };

    writeFileSync(join(intakeDir, 'session.json'), JSON.stringify(session, null, 2));

    const app = createServer(walkthroughDir);
    const port = parseInt(opts.port, 10);

    app.listen(port, () => {
      console.log(`\n✓ Intake server running on http://localhost:${port}`);
      console.log(`  Game: ${opts.game}`);
      console.log(`  Source: ${opts.source}`);
      console.log(`  Working dir: ${intakeDir}`);
      console.log(`\n  Open the walkthrough in your browser and use the extension to capture pages.`);
      console.log(`  Press Ctrl+C to stop.\n`);
    });
  });

program
  .command('convert')
  .description('Run the deterministic converter on captured pages')
  .option('--dir <path>', 'Walkthrough directory')
  .action(async (opts) => {
    const dir = opts.dir || process.cwd();
    console.log(`Converting pages in ${dir}...`);
    // Conversion is triggered via the API — this is a convenience wrapper
    const response = await fetch(`http://localhost:3847/api/convert`, { method: 'POST' });
    const result = await response.json();
    if (result.success) {
      console.log(`✓ Converted into ${result.sections} sections (${result.total_blocks} blocks)`);
    } else {
      console.error(`✗ Conversion failed: ${result.error}`);
    }
  });

program
  .command('finalize')
  .description('Write approved sections to main-walkthrough.json')
  .action(async () => {
    const response = await fetch(`http://localhost:3847/api/finalize`, { method: 'POST' });
    const result = await response.json();
    if (result.success) {
      console.log(`✓ Walkthrough finalized: ${result.output}`);
    } else {
      console.error(`✗ Finalize failed: ${result.error}`);
    }
  });

// ── Training mode controls ────────────────────────────────────────────────
// All three commands let you tune the graduation threshold (default 10).
// Examples:
//   npx intake set-threshold 50         # bump to 50 walkthroughs
//   npx intake set-threshold 100        # bump to 100 walkthroughs
//   INTAKE_GRADUATION_THRESHOLD=25 npx intake training-status   # one-off
//   npx intake graduate --force         # graduate now regardless of count

program
  .command('set-threshold <count>')
  .description('Set how many walkthroughs must be processed before graduation (persisted)')
  .action(async (count: string) => {
    const { RulesDB } = await import('./training/rules-db.js');
    const dbPath = resolveTrainingDbPath();
    const db = new RulesDB(dbPath);
    const value = parseInt(count, 10);
    db.setGraduationThreshold(value);
    console.log(`✓ Graduation threshold set to ${value} walkthroughs`);
    console.log(`  Progress: ${db.data.walkthroughs_processed}/${value}`);
  });

program
  .command('training-status')
  .description('Show training mode status and graduation progress')
  .action(async () => {
    const { RulesDB } = await import('./training/rules-db.js');
    const db = new RulesDB(resolveTrainingDbPath());
    const threshold = db.graduationThreshold;
    const processed = db.data.walkthroughs_processed;
    console.log(`Status:     ${db.data.graduation_status}`);
    console.log(`Threshold:  ${threshold} walkthroughs`);
    console.log(`Processed:  ${processed} (${Math.min(100, Math.round((processed / threshold) * 100))}%)`);
    console.log(`Examples:   ${db.data.examples.length} corrections recorded`);
    if (db.shouldGraduate) {
      console.log(`\n→ Ready to graduate! Run: npx intake graduate`);
    }
  });

program
  .command('graduate')
  .description('Graduate out of training mode (auto-approves high-confidence blocks)')
  .option('--force', 'Graduate even if the threshold has not been reached')
  .action(async (opts) => {
    const { RulesDB } = await import('./training/rules-db.js');
    const db = new RulesDB(resolveTrainingDbPath());
    if (!db.shouldGraduate && !opts.force) {
      console.error(
        `✗ Not eligible to graduate yet (${db.data.walkthroughs_processed}/${db.graduationThreshold}). ` +
        `Use --force to override.`,
      );
      process.exit(1);
    }
    db.graduate();
    console.log(`✓ Graduated! Converter will now auto-approve high-confidence blocks.`);
  });

function resolveTrainingDbPath(): string {
  // Repo-relative location, consistent with server.ts
  return join(process.cwd(), 'tools', 'intake', 'training-data.json');
}

program.parse();
