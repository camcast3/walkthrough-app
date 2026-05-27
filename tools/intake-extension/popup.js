const SERVER = 'http://localhost:3847';
const statusEl = document.getElementById('status');
const pageListEl = document.getElementById('pageList');
const captureBtn = document.getElementById('captureBtn');
const doneBtn = document.getElementById('doneBtn');

async function loadSession() {
  try {
    const res = await fetch(`${SERVER}/api/session`);
    if (res.ok) {
      const session = await res.json();
      statusEl.textContent = `Game: ${session.game} | Pages: ${session.pages_captured}`;
      statusEl.className = 'status';
    } else {
      statusEl.textContent = 'No active session. Run: npx intake start --game "..."';
      statusEl.className = 'status error';
    }

    const pagesRes = await fetch(`${SERVER}/api/pages`);
    if (pagesRes.ok) {
      const pages = await pagesRes.json();
      pageListEl.innerHTML = pages
        .map(p => `<li>${p.page_number}. ${p.title}</li>`)
        .join('');
    }
  } catch {
    statusEl.textContent = 'Cannot connect to intake server (localhost:3847)';
    statusEl.className = 'status error';
  }
}

captureBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { action: 'extract' }, async (response) => {
    if (!response || !response.success) {
      statusEl.textContent = `Error: ${response?.error || 'Extraction failed'}`;
      statusEl.className = 'status error';
      return;
    }

    try {
      const res = await fetch(`${SERVER}/api/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: response.title,
          url: response.url,
          markdown: response.markdown,
        }),
      });

      const result = await res.json();
      if (result.success) {
        statusEl.textContent = `✓ Page ${result.page_number} captured!`;
        statusEl.className = 'status';
        const li = document.createElement('li');
        li.textContent = `${result.page_number}. ${response.title}`;
        pageListEl.appendChild(li);
      } else {
        statusEl.textContent = `Error: ${result.error}`;
        statusEl.className = 'status error';
      }
    } catch (err) {
      statusEl.textContent = `Server error: ${err.message}`;
      statusEl.className = 'status error';
    }
  });
});

doneBtn.addEventListener('click', async () => {
  try {
    const res = await fetch(`${SERVER}/api/convert`, { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      statusEl.textContent = `✓ Converted: ${result.sections} sections, ${result.total_blocks} blocks`;
      statusEl.className = 'status';
    } else {
      statusEl.textContent = `Error: ${result.error}`;
      statusEl.className = 'status error';
    }
  } catch (err) {
    statusEl.textContent = `Server error: ${err.message}`;
    statusEl.className = 'status error';
  }
});

// Load on popup open
loadSession();
