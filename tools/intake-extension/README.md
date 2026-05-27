# Intake Browser Extension

Manifest V3 Chrome/Edge extension that captures the current page via [Mozilla Readability](https://github.com/mozilla/readability) + [Turndown](https://github.com/mixmark-io/turndown) and POSTs the markdown to the local intake server (`localhost:3847`).

## What it does

1. You click **Capture This Page** in the popup.
2. The content script clones the current DOM, runs it through Readability to strip nav/ads/comments, then converts the cleaned HTML to markdown with Turndown (preserving tables).
3. The popup POSTs `{ title, url, markdown }` to `http://localhost:3847/api/intake`.
4. Repeat for every page of the walkthrough.
5. Click **Done — Start Conversion** when finished; the server runs the deterministic converter and writes `sections.json`.

The extension never sends data anywhere except `localhost:3847`. Only the `activeTab` permission is requested — content access is scoped to the tab you're viewing.

## Install (developer / unpacked)

There's no Chrome Web Store listing — load it as an unpacked extension:

### Chrome / Brave / Arc / Vivaldi
1. Go to `chrome://extensions`.
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Select the `tools/intake-extension/` directory in this repo.
5. Pin the **Walkthrough Intake** action to your toolbar for easy access.

### Microsoft Edge
1. Go to `edge://extensions`.
2. Toggle **Developer mode** on (bottom left).
3. Click **Load unpacked**.
4. Select `tools/intake-extension/`.

### After making code changes
- Go back to `chrome://extensions` (or `edge://extensions`).
- Click the circular **reload** icon on the Walkthrough Intake card.
- For `content.js` changes, refresh the source walkthrough tab too.

## Install (with dev dependencies, for tests)

```bash
cd tools/intake-extension
npm install
npm test         # 18 vitest tests under JSDOM
```

Dependencies installed here are dev-only (vitest, jsdom). The extension itself ships only the vendored `lib/readability.js` and `lib/turndown.js`.

## Usage

1. Start the intake server (see [`tools/intake/README.md`](../intake/README.md)):
   ```bash
   npx tsx tools/intake/src/cli.ts start --game "<Game>" --source "<URL>"
   ```
2. Open the source walkthrough in your browser.
3. Click the **Walkthrough Intake** action.
4. The popup shows the current session (game name + page count).
5. Click **Capture This Page** for each page of the walkthrough.
6. When done, click **Done — Start Conversion** to trigger `/api/convert`.

## Files

```
tools/intake-extension/
├── manifest.json        # Manifest V3 — activeTab + localhost:3847 only
├── content.js           # Readability + Turndown extraction, message-driven
├── popup.html           # Capture / Done UI
├── popup.js             # Talks to the local intake server
├── lib/
│   ├── readability.js   # Vendored, Apache 2.0
│   └── turndown.js      # Vendored, MIT
├── icons/               # Placeholder icons; replace before any public release
├── package.json
└── tests/               # JSDOM-mocked tests for content + popup + manifest
```

## Permissions explained

| Permission | Why |
|---|---|
| `activeTab` | Required to read the current page's DOM when you click Capture. Granted on click, not persistent. |
| `host_permissions: ["http://localhost:3847/*"]` | Required so `fetch` from the popup can reach the intake server. Locked to localhost — the extension cannot talk to any other host. |

## Troubleshooting

| Symptom | Fix |
|---|---|
| Popup says "Cannot connect to intake server" | The intake server isn't running. Start it: `npx tsx tools/intake/src/cli.ts start --game ... --source ...` |
| Popup says "No active session" | The server is running but no `session.json` exists. Did you skip the `start` command? |
| `Could not extract article content from this page` | Readability couldn't find a main article on this page. Try a different URL, or paste the markdown into the source manually. |
| Tables don't appear in the captured markdown | The site uses CSS-rendered or JS-built tables that Turndown's plain-DOM extraction can't see. Capture manually or extend `htmlTableToMarkdown` in `content.js`. |
| `chrome.runtime` undefined in dev console | You're testing the extension code outside the browser. Use `npm test` (the tests mock `chrome.runtime`). |
| Capturing a page on `http://localhost:*` | By default the extension can talk to *any* page (matches `<all_urls>`) but only `fetch`es to `localhost:3847`. No cross-origin issue. |

## Vendored libraries

`lib/readability.js` and `lib/turndown.js` are vendored UMD builds, NOT installed via npm at runtime. If you need to upgrade them:

```bash
cd tools/intake-extension
npm install --no-save @mozilla/readability turndown
cp node_modules/@mozilla/readability/Readability.js lib/readability.js
cp node_modules/turndown/dist/turndown.js lib/turndown.js
# Re-add the attribution header at the top of each file
```

## Icons

The PNGs in `icons/` are simple placeholders. Before publishing to a store or sharing widely, swap them for proper branded icons at 16/48/128 pixels.
