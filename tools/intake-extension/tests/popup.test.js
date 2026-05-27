// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const popupScript = readFileSync(join(__dirname, '..', 'popup.js'), 'utf-8');
const popupHtml = readFileSync(join(__dirname, '..', 'popup.html'), 'utf-8');

function setupFetchMock(routes) {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const path = url.replace('http://localhost:3847', '');
    const key = `${opts.method || 'GET'} ${path}`;
    const handler = routes[key];
    if (!handler) {
      return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
    }
    return handler;
  });
}

function setupChromeTabsMock() {
  let extractResponse = { success: true, title: 'P1', url: 'https://example.com/p1', markdown: '## P1\n\nText' };
  globalThis.chrome = {
    tabs: {
      query: vi.fn(async () => [{ id: 1 }]),
      sendMessage: vi.fn((tabId, msg, cb) => {
        cb(extractResponse);
      }),
    },
  };
  return {
    setExtractResponse(resp) { extractResponse = resp; },
  };
}

describe('intake-extension popup', () => {
  let chromeMock;

  beforeEach(() => {
    // Render the popup HTML and inject the script.
    document.body.innerHTML = popupHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];
    chromeMock = setupChromeTabsMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads session info on startup', async () => {
    setupFetchMock({
      'GET /api/session': { ok: true, json: async () => ({ game: 'Test Game', pages_captured: 2 }) },
      'GET /api/pages': { ok: true, json: async () => [
        { page_number: 1, title: 'Prologue' },
        { page_number: 2, title: 'Act 1' },
      ] },
    });
    eval(popupScript);
    await new Promise(r => setTimeout(r, 10));

    const status = document.getElementById('status');
    expect(status.textContent).toContain('Test Game');
    expect(status.textContent).toContain('2');
    const items = document.querySelectorAll('#pageList li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Prologue');
  });

  it('shows error when server is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    eval(popupScript);
    await new Promise(r => setTimeout(r, 10));
    const status = document.getElementById('status');
    expect(status.textContent).toMatch(/cannot connect/i);
    expect(status.className).toContain('error');
  });

  it('shows error when no active session', async () => {
    setupFetchMock({
      'GET /api/session': { ok: false, json: async () => ({ error: 'No session' }) },
      'GET /api/pages': { ok: true, json: async () => [] },
    });
    eval(popupScript);
    await new Promise(r => setTimeout(r, 10));
    const status = document.getElementById('status');
    expect(status.textContent).toMatch(/no active session/i);
  });

  it('captureBtn extracts page and POSTs to /api/intake', async () => {
    const intakePost = vi.fn(async () => ({
      ok: true, json: async () => ({ success: true, page_number: 3 }),
    }));
    setupFetchMock({
      'GET /api/session': { ok: true, json: async () => ({ game: 'G', pages_captured: 0 }) },
      'GET /api/pages': { ok: true, json: async () => [] },
      'POST /api/intake': intakePost(),
    });
    eval(popupScript);
    await new Promise(r => setTimeout(r, 10));

    document.getElementById('captureBtn').click();
    await new Promise(r => setTimeout(r, 50));

    expect(chrome.tabs.sendMessage).toHaveBeenCalled();
    expect(document.getElementById('status').textContent).toContain('Page 3 captured');
  });

  it('captureBtn surfaces extension extraction failure', async () => {
    chromeMock.setExtractResponse({ success: false, error: 'Could not extract' });
    setupFetchMock({
      'GET /api/session': { ok: true, json: async () => ({ game: 'G', pages_captured: 0 }) },
      'GET /api/pages': { ok: true, json: async () => [] },
    });
    eval(popupScript);
    await new Promise(r => setTimeout(r, 10));

    document.getElementById('captureBtn').click();
    await new Promise(r => setTimeout(r, 50));

    const status = document.getElementById('status');
    expect(status.textContent).toMatch(/could not extract/i);
    expect(status.className).toContain('error');
  });

  it('doneBtn POSTs to /api/convert and reports result', async () => {
    setupFetchMock({
      'GET /api/session': { ok: true, json: async () => ({ game: 'G', pages_captured: 1 }) },
      'GET /api/pages': { ok: true, json: async () => [{ page_number: 1, title: 'P1' }] },
      'POST /api/convert': { ok: true, json: async () => ({ success: true, sections: 3, total_blocks: 27 }) },
    });
    eval(popupScript);
    await new Promise(r => setTimeout(r, 10));

    document.getElementById('doneBtn').click();
    await new Promise(r => setTimeout(r, 50));

    const status = document.getElementById('status');
    expect(status.textContent).toContain('3 sections');
    expect(status.textContent).toContain('27 blocks');
  });
});
