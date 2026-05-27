/**
 * Content script — extracts article content from the current page
 * using Mozilla Readability and converts to Markdown via Turndown.
 */

// Loaded via popup message — not auto-executing
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
    try {
      const result = extractContent();
      sendResponse({ success: true, ...result });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true; // async response
  }
});

function extractContent() {
  // Clone document for Readability (it mutates the DOM)
  const docClone = document.cloneNode(true);
  const reader = new Readability(docClone);
  const article = reader.parse();

  if (!article || !article.content) {
    throw new Error('Could not extract article content from this page');
  }

  // Convert HTML to Markdown
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  // Preserve tables
  turndownService.addRule('tables', {
    filter: ['table'],
    replacement: function (content, node) {
      return '\n' + htmlTableToMarkdown(node) + '\n';
    },
  });

  const markdown = turndownService.turndown(article.content);

  return {
    title: article.title || document.title,
    url: window.location.href,
    markdown,
    byline: article.byline || '',
  };
}

function htmlTableToMarkdown(tableNode) {
  const rows = tableNode.querySelectorAll('tr');
  if (rows.length === 0) return '';

  const result = [];
  rows.forEach((row, i) => {
    const cells = Array.from(row.querySelectorAll('td, th'));
    const line = '| ' + cells.map(c => c.textContent.trim()).join(' | ') + ' |';
    result.push(line);
    if (i === 0) {
      result.push('| ' + cells.map(() => '---').join(' | ') + ' |');
    }
  });
  return result.join('\n');
}
