/**
 * Downloads remote images referenced in walkthrough blocks and rewrites
 * URLs to local relative paths for offline viewing.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

export interface DownloadResult {
  total: number;
  downloaded: number;
  failed: number;
  skipped: number;
}

/** Extract all image URLs from markdown content. */
function extractImageUrls(markdown: string): string[] {
  const urls: string[] = [];
  // Match ![alt](url) patterns — use a regex that handles nested brackets in alt text
  const imgRegex = /!\[(?:[^\[\]]|\[[^\]]*\])*\]\(([^)\s]+)\)/g;
  let match;
  while ((match = imgRegex.exec(markdown)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

/** Generate a stable filename from a URL. */
function urlToFilename(url: string): string {
  // Try to preserve the original filename
  const urlPath = new URL(url).pathname;
  const base = urlPath.split('/').pop() || '';
  // If filename is reasonable, use it (deduped via hash prefix)
  const ext = extname(base) || '.png';
  const cleanBase = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  // Add short hash to avoid collisions
  const hash = createHash('md5').update(url).digest('hex').slice(0, 8);
  return cleanBase ? `${hash}-${cleanBase}` : `${hash}${ext}`;
}

/** Download a single image, returns local filename or null on failure. */
async function downloadImage(url: string, imagesDir: string): Promise<string | null> {
  const filename = urlToFilename(url);
  const localPath = join(imagesDir, filename);

  // Skip if already downloaded
  if (existsSync(localPath)) return filename;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'WalkthroughIntake/1.0' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(localPath, buffer);
    return filename;
  } catch {
    return null;
  }
}

/** Rewrite image URLs in markdown content to local relative paths. */
function rewriteImageUrls(content: string, urlMap: Map<string, string>): string {
  return content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    const localFile = urlMap.get(url);
    if (localFile) {
      return `![${alt}](./images/${localFile})`;
    }
    return match;
  });
}

/**
 * Process all blocks in a walkthrough: download images and rewrite URLs.
 * Mutates blocks in place.
 */
export async function downloadAndRewriteImages(
  sections: Array<{ blocks: Array<Record<string, unknown>> }>,
  walkthroughDir: string,
  onProgress?: (msg: string) => void,
): Promise<DownloadResult> {
  const imagesDir = join(walkthroughDir, 'images');
  mkdirSync(imagesDir, { recursive: true });

  // Collect all unique image URLs across all blocks
  const allUrls = new Set<string>();
  const textFields = ['content', 'heading'] as const;
  for (const section of sections) {
    for (const block of section.blocks) {
      for (const field of textFields) {
        if (block[field] && typeof block[field] === 'string') {
          for (const url of extractImageUrls(block[field] as string)) {
            if (url.startsWith('http://') || url.startsWith('https://')) {
              allUrls.add(url);
            }
          }
        }
      }
    }
  }

  const result: DownloadResult = {
    total: allUrls.size,
    downloaded: 0,
    failed: 0,
    skipped: 0,
  };

  if (allUrls.size === 0) return result;

  onProgress?.(`Found ${allUrls.size} images to download...`);

  // Download all images (with concurrency limit)
  const urlMap = new Map<string, string>();
  const urls = [...allUrls];
  const BATCH_SIZE = 5;

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (url) => {
        const filename = await downloadImage(url, imagesDir);
        return { url, filename };
      })
    );

    for (const { url, filename } of results) {
      if (filename) {
        urlMap.set(url, filename);
        result.downloaded++;
      } else {
        result.failed++;
      }
    }

    onProgress?.(`Downloaded ${result.downloaded}/${allUrls.size} images...`);
  }

  // Rewrite URLs in all blocks
  for (const section of sections) {
    for (const block of section.blocks) {
      for (const field of textFields) {
        if (block[field] && typeof block[field] === 'string') {
          block[field] = rewriteImageUrls(block[field] as string, urlMap);
        }
      }
    }
  }

  return result;
}
