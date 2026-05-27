import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf-8'));

describe('intake-extension manifest.json', () => {
  it('is Manifest V3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('has required name, version, and description', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.description).toBeTruthy();
  });

  it('declares only activeTab permission (least-privilege)', () => {
    expect(manifest.permissions).toEqual(['activeTab']);
  });

  it('limits host_permissions to the local intake server', () => {
    expect(manifest.host_permissions).toEqual(['http://localhost:3847/*']);
  });

  it('declares popup action with HTML file', () => {
    expect(manifest.action.default_popup).toBe('popup.html');
  });

  it('registers content.js as a content script', () => {
    const scripts = manifest.content_scripts || [];
    const cs = scripts.find(s => (s.js || []).includes('content.js'));
    expect(cs).toBeDefined();
    expect(cs.run_at).toBe('document_idle');
  });
});
