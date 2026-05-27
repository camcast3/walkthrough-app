// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentScript = readFileSync(join(__dirname, '..', 'content.js'), 'utf-8');

// Stub the chrome.runtime API used by the extension.
function setupChromeMock() {
  let messageListener = null;
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener: (fn) => { messageListener = fn; },
      },
    },
  };
  return {
    triggerMessage(request) {
      return new Promise((resolve) => {
        const keepOpen = messageListener(request, {}, resolve);
        if (keepOpen !== true) {
          resolve(undefined);
        }
      });
    },
  };
}

// Minimal Readability stub returning predictable article content.
function setupReadabilityMock(article) {
  globalThis.Readability = vi.fn(function (doc) {
    this.doc = doc;
    this.parse = () => article;
  });
}

// Minimal TurndownService stub — passes HTML through with a marker so we can
// verify our custom rules ran without depending on the real implementation.
function setupTurndownMock() {
  const rules = new Map();
  globalThis.TurndownService = vi.fn(function () {
    this.addRule = (name, rule) => rules.set(name, rule);
    this.turndown = (html) => {
      // Very rough conversion — strip tags but keep table rule output.
      const tableMatch = html.match(/<table[^>]*>[\s\S]*?<\/table>/);
      if (tableMatch && rules.has('tables')) {
        const doc = new DOMParser().parseFromString(tableMatch[0], 'text/html');
        const tableNode = doc.querySelector('table');
        const replacement = rules.get('tables').replacement('', tableNode);
        html = html.replace(tableMatch[0], replacement);
      }
      return html.replace(/<\/?[^>]+>/g, '').trim();
    };
  });
  return rules;
}

describe('intake-extension content script', () => {
  let chromeMock;
  beforeEach(() => {
    document.documentElement.innerHTML = '<html><body><article><h1>Test Article</h1><p>Hello world</p></article></body></html>';
    chromeMock = setupChromeMock();
    setupReadabilityMock({
      title: 'Test Article',
      content: '<h1>Test Article</h1><p>Hello world</p>',
      byline: 'Author Name',
    });
    setupTurndownMock();
    // Re-execute the content script to (re)register the listener with mocks in place.
    eval(contentScript);
  });

  it('registers a chrome.runtime onMessage listener', () => {
    expect(chrome.runtime.onMessage.addListener).toBeDefined();
  });

  it('responds to extract with article title, url, and markdown', async () => {
    const response = await chromeMock.triggerMessage({ action: 'extract' });
    expect(response.success).toBe(true);
    expect(response.title).toBe('Test Article');
    expect(response.url).toBe(window.location.href);
    expect(response.markdown).toContain('Hello world');
  });

  it('passes byline through when available', async () => {
    const response = await chromeMock.triggerMessage({ action: 'extract' });
    expect(response.byline).toBe('Author Name');
  });

  it('returns success:false with error message when Readability fails', async () => {
    setupReadabilityMock(null);
    eval(contentScript);
    const response = await chromeMock.triggerMessage({ action: 'extract' });
    expect(response.success).toBe(false);
    expect(response.error).toMatch(/could not extract/i);
  });

  it('ignores messages with unknown action', async () => {
    const response = await chromeMock.triggerMessage({ action: 'unknown' });
    expect(response).toBeUndefined();
  });

  it('converts HTML tables to markdown table format', async () => {
    document.documentElement.innerHTML = `
      <html><body><article>
        <table>
          <tr><th>Name</th><th>HP</th></tr>
          <tr><td>Boss</td><td>5000</td></tr>
        </table>
      </article></body></html>
    `;
    setupReadabilityMock({
      title: 'Boss',
      content: '<table><tr><th>Name</th><th>HP</th></tr><tr><td>Boss</td><td>5000</td></tr></table>',
    });
    setupTurndownMock();
    eval(contentScript);

    const response = await chromeMock.triggerMessage({ action: 'extract' });
    expect(response.success).toBe(true);
    expect(response.markdown).toContain('| Name | HP |');
    expect(response.markdown).toContain('| --- | --- |');
    expect(response.markdown).toContain('| Boss | 5000 |');
  });
});
