import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server.js';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Intake Server API', () => {
  let workingDir: string;
  let app: ReturnType<typeof createServer>;

  beforeEach(() => {
    workingDir = join(tmpdir(), `intake-test-${Date.now()}`);
    mkdirSync(join(workingDir, '.intake', 'pages'), { recursive: true });

    // Create a session file
    writeFileSync(join(workingDir, '.intake', 'session.json'), JSON.stringify({
      game: 'Test Game',
      slug: 'test-game',
      source_url: 'https://example.com',
      pages_captured: 0,
      state: 'capturing',
      created_at: '2026-05-26T00:00:00Z',
    }));

    app = createServer(workingDir);
  });

  afterEach(() => {
    if (existsSync(workingDir)) rmSync(workingDir, { recursive: true });
  });

  describe('GET /api/session', () => {
    it('returns current session', async () => {
      const res = await request(app).get('/api/session');
      expect(res.status).toBe(200);
      expect(res.body.game).toBe('Test Game');
      expect(res.body.state).toBe('capturing');
    });
  });

  describe('POST /api/intake', () => {
    it('saves page capture', async () => {
      const res = await request(app)
        .post('/api/intake')
        .send({ title: 'Prologue', url: 'https://example.com/p1', markdown: '## Prologue\n\nText here' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.page_number).toBe(1);
    });

    it('rejects missing required fields', async () => {
      const res = await request(app)
        .post('/api/intake')
        .send({ url: 'https://example.com' });

      expect(res.status).toBe(400);
    });

    it('increments page numbers', async () => {
      await request(app).post('/api/intake').send({ title: 'P1', markdown: 'Text 1' });
      const res = await request(app).post('/api/intake').send({ title: 'P2', markdown: 'Text 2' });
      expect(res.body.page_number).toBe(2);
    });
  });

  describe('GET /api/pages', () => {
    it('returns empty list initially', async () => {
      const res = await request(app).get('/api/pages');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns captured pages in order', async () => {
      await request(app).post('/api/intake').send({ title: 'P1', markdown: 'A' });
      await request(app).post('/api/intake').send({ title: 'P2', markdown: 'B' });

      const res = await request(app).get('/api/pages');
      expect(res.body).toHaveLength(2);
      expect(res.body[0].title).toBe('P1');
      expect(res.body[1].title).toBe('P2');
    });
  });

  describe('POST /api/convert', () => {
    it('converts captured pages into sections', async () => {
      await request(app).post('/api/intake').send({
        title: 'Prologue',
        markdown: '## Prologue\n\nWalk north to the gate.\n\n## Act 1\n\nTalk to Sara.',
      });

      const res = await request(app).post('/api/convert');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sections).toBeGreaterThanOrEqual(2);
    });

    it('fails with no pages', async () => {
      const res = await request(app).post('/api/convert');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/sections', () => {
    it('returns 404 before conversion', async () => {
      const res = await request(app).get('/api/sections');
      expect(res.status).toBe(404);
    });

    it('returns sections after conversion', async () => {
      await request(app).post('/api/intake').send({ title: 'P1', markdown: '## Section\n\nContent' });
      await request(app).post('/api/convert');

      const res = await request(app).get('/api/sections');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/approve/:id', () => {
    it('marks a section as approved', async () => {
      await request(app).post('/api/intake').send({ title: 'P1', markdown: '## Test\n\nContent' });
      await request(app).post('/api/convert');

      const sections = await request(app).get('/api/sections');
      const sectionId = sections.body[0].id;

      const res = await request(app).post(`/api/approve/${sectionId}`);
      expect(res.status).toBe(200);

      const updated = await request(app).get(`/api/sections/${sectionId}`);
      expect(updated.body.approved).toBe(true);
    });
  });

  describe('POST /api/finalize', () => {
    it('writes main-walkthrough.json', async () => {
      await request(app).post('/api/intake').send({ title: 'P1', markdown: '## Prologue\n\nText' });
      await request(app).post('/api/convert');

      const res = await request(app).post('/api/finalize');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(existsSync(join(workingDir, 'main-walkthrough.json'))).toBe(true);
    });
  });
});
