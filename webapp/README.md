# Walkthrough App — Webapp

SvelteKit PWA frontend for the walkthrough checklist app. Built with **Svelte 5** (runes mode), **TypeScript 6**, and **Vite 8**. Outputs a fully static site via `adapter-static` that is served by the Go backend.

## Prerequisites

- **Node.js 22+** (matches the Dockerfile build stage)
- npm (included with Node.js)

## Quick start

```bash
# Install dependencies
npm install --legacy-peer-deps

# Start dev server (hot-reload at http://localhost:5173)
npm run dev

# Type-check
npm run check

# Production build (outputs to ./build)
npm run build
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Production build → `./build/` |
| `npm run preview` | Preview the production build locally |
| `npm run check` | `svelte-kit sync` + `svelte-check` (type checking) |
| `npm run check:watch` | Same as `check` but in watch mode |

## Architecture

The webapp is a single-page app with a service worker for offline support. It communicates with the Go server via REST APIs (`/api/*`).

```
src/
├── lib/             Shared state, types, utilities
│   ├── assets/      Static assets (icons, images)
│   ├── gamepad.ts   Gamepad API integration
│   ├── index.ts     Barrel exports
│   ├── state.ts     Global app state (runes-based)
│   ├── sync.ts      Offline sync / service worker logic
│   └── types.ts     TypeScript type definitions
├── routes/          SvelteKit pages and layouts
└── app.html         HTML shell
```

### Key features

- **PWA with offline support** — service worker caches the app and walkthrough data
- **Gamepad navigation** — full controller support (D-pad, A/B buttons, LB/RB)
- **Power-save mode** — automatically reduces GPU effects on handheld devices
- **Responsive design** — optimized for touch, controller, and mouse input
- **Markdown rendering** — full prose walkthroughs with embedded milestone checkpoints

### Build output

`npm run build` produces a static site in `./build/` using `adapter-static` with `fallback: 'index.html'` for SPA routing. The Go server serves these files and handles the `/api/*` routes.

## Dependencies

### Runtime
- **[marked](https://github.com/markedjs/marked)** — Markdown → HTML rendering
- **[idb-keyval](https://github.com/jakearchibald/idb-keyval)** — IndexedDB key-value store for offline data

### Dev
- **SvelteKit 2** / **Svelte 5** — component framework (runes mode)
- **TypeScript 6** — type checking
- **Vite 8** — build tool
- **vite-plugin-pwa** — service worker generation
