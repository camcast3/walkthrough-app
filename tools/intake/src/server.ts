/**
 * Local intake server — receives pages from the browser extension,
 * serves APIs for the CLI review tool.
 */

import express from 'express';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { convertPages } from './converter/index.js';
import { IntakeSession, PageCapture, ConvertedSection } from './types.js';
import { RulesDB } from './training/rules-db.js';

export function createServer(workingDir: string) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const intakeDir = join(workingDir, '.intake');
  const pagesDir = join(intakeDir, 'pages');
  const sessionFile = join(intakeDir, 'session.json');
  const sectionsFile = join(intakeDir, 'sections.json');
  const trainingDbPath = join(workingDir, '..', '..', 'tools', 'intake', 'training-data.json');

  // Ensure directories exist
  mkdirSync(pagesDir, { recursive: true });

  function getSession(): IntakeSession | null {
    if (!existsSync(sessionFile)) return null;
    return JSON.parse(readFileSync(sessionFile, 'utf-8'));
  }

  function saveSession(session: IntakeSession): void {
    writeFileSync(sessionFile, JSON.stringify(session, null, 2));
  }

  function getSections(): ConvertedSection[] | null {
    if (!existsSync(sectionsFile)) return null;
    return JSON.parse(readFileSync(sectionsFile, 'utf-8'));
  }

  // POST /api/intake — receive a page from the extension
  app.post('/api/intake', (req, res) => {
    const { title, url, markdown, page_number } = req.body;

    if (!markdown || !title) {
      res.status(400).json({ error: 'Missing required fields: title, markdown' });
      return;
    }

    const pageNum = page_number || (readdirSync(pagesDir).length + 1);
    const capture: PageCapture = {
      page_number: pageNum,
      title,
      url: url || '',
      markdown,
      captured_at: new Date().toISOString(),
    };

    writeFileSync(join(pagesDir, `page${pageNum}.json`), JSON.stringify(capture, null, 2));

    // Update session
    const session = getSession();
    if (session) {
      session.pages_captured = pageNum;
      saveSession(session);
    }

    res.json({ success: true, page_number: pageNum });
  });

  // GET /api/session — current session status
  app.get('/api/session', (_req, res) => {
    const session = getSession();
    if (!session) {
      res.status(404).json({ error: 'No active session' });
      return;
    }
    res.json(session);
  });

  // GET /api/pages — list captured pages
  app.get('/api/pages', (_req, res) => {
    if (!existsSync(pagesDir)) {
      res.json([]);
      return;
    }
    const files = readdirSync(pagesDir).filter(f => f.endsWith('.json'));
    const pages = files.map(f => JSON.parse(readFileSync(join(pagesDir, f), 'utf-8')));
    pages.sort((a: PageCapture, b: PageCapture) => a.page_number - b.page_number);
    res.json(pages);
  });

  // GET /api/pages/:num — get a specific page
  app.get('/api/pages/:num', (req, res) => {
    const filePath = join(pagesDir, `page${req.params.num}.json`);
    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    res.json(JSON.parse(readFileSync(filePath, 'utf-8')));
  });

  // POST /api/convert — run converter on all pages
  app.post('/api/convert', (_req, res) => {
    const files = readdirSync(pagesDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      res.status(400).json({ error: 'No pages captured yet' });
      return;
    }

    const pages = files
      .map(f => JSON.parse(readFileSync(join(pagesDir, f), 'utf-8')) as PageCapture)
      .sort((a, b) => a.page_number - b.page_number)
      .map(p => ({ markdown: p.markdown, title: p.title }));

    const rulesDb = new RulesDB(trainingDbPath);
    const sections = convertPages(pages, {
      training: rulesDb.data,
      source_site: getSession()?.source_url,
    });

    writeFileSync(sectionsFile, JSON.stringify(sections, null, 2));

    const session = getSession();
    if (session) {
      session.state = 'reviewing';
      saveSession(session);
    }

    res.json({
      success: true,
      sections: sections.length,
      total_blocks: sections.reduce((sum, s) => sum + s.blocks.length, 0),
    });
  });

  // GET /api/sections — get converted sections
  app.get('/api/sections', (_req, res) => {
    const sections = getSections();
    if (!sections) {
      res.status(404).json({ error: 'No converted sections. Run POST /api/convert first.' });
      return;
    }
    res.json(sections);
  });

  // GET /api/sections/:id — get a specific section
  app.get('/api/sections/:id', (req, res) => {
    const sections = getSections();
    if (!sections) {
      res.status(404).json({ error: 'No converted sections' });
      return;
    }
    const section = sections.find(s => s.id === req.params.id);
    if (!section) {
      res.status(404).json({ error: 'Section not found' });
      return;
    }
    res.json(section);
  });

  // PUT /api/sections/:id/blocks/:index — update a block
  app.put('/api/sections/:id/blocks/:index', (req, res) => {
    const sections = getSections();
    if (!sections) {
      res.status(404).json({ error: 'No converted sections' });
      return;
    }

    const section = sections.find(s => s.id === req.params.id);
    if (!section) {
      res.status(404).json({ error: 'Section not found' });
      return;
    }

    const blockIndex = parseInt(req.params.index, 10);
    if (blockIndex < 0 || blockIndex >= section.blocks.length) {
      res.status(400).json({ error: 'Invalid block index' });
      return;
    }

    const { block, approved } = req.body;
    if (block) section.blocks[blockIndex].block = block;
    if (approved !== undefined) section.blocks[blockIndex].approved = approved;

    writeFileSync(sectionsFile, JSON.stringify(sections, null, 2));
    res.json({ success: true });
  });

  // POST /api/approve/:id — mark a section as approved
  app.post('/api/approve/:id', (req, res) => {
    const sections = getSections();
    if (!sections) {
      res.status(404).json({ error: 'No converted sections' });
      return;
    }

    const section = sections.find(s => s.id === req.params.id);
    if (!section) {
      res.status(404).json({ error: 'Section not found' });
      return;
    }

    section.approved = true;
    section.blocks.forEach(b => (b.approved = true));
    writeFileSync(sectionsFile, JSON.stringify(sections, null, 2));
    res.json({ success: true });
  });

  // POST /api/finalize — write to main-walkthrough.json
  app.post('/api/finalize', (req, res) => {
    const sections = getSections();
    const session = getSession();
    if (!sections || !session) {
      res.status(400).json({ error: 'No session or sections' });
      return;
    }

    const walkthrough = {
      id: session.slug,
      game: session.game,
      title: `Complete Walkthrough`,
      author: 'Intake System',
      source_url: session.source_url,
      attribution: `Based on walkthrough from ${session.source_url}`,
      created_at: new Date().toISOString().split('T')[0],
      sections: sections.map(s => ({
        id: s.id,
        title: s.title,
        blocks: s.blocks.map(b => b.block),
        checkpoints: s.checkpoints,
      })),
    };

    const outputPath = join(workingDir, 'main-walkthrough.json');
    writeFileSync(outputPath, JSON.stringify(walkthrough, null, 2));

    if (session) {
      session.state = 'finalized';
      saveSession(session);
    }

    res.json({ success: true, output: outputPath });
  });

  // DELETE /api/session — reset
  app.delete('/api/session', (_req, res) => {
    // Clean up handled by caller
    res.json({ success: true, message: 'Session reset' });
  });

  return app;
}
