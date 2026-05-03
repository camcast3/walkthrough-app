# Walkthrough Checklist App

A touch and controller-optimized PWA for game walkthroughs. Works on Steam Deck, ROG Ally (Bazzite), and Windows PC. Syncs progress to a self-hosted server when online; works fully offline via service worker.

## Tech stack & versions

| Component | Version | Notes |
|---|---|---|
| **Go** | 1.26+ | Server binary (`server/`) |
| **Node.js** | 22+ | Webapp build tooling |
| **SvelteKit** | 2.x | PWA framework (Svelte 5, TypeScript 6) |
| **Vite** | 8.x | Build tool / dev server |
| **SQLite** | via `modernc.org/sqlite` | Pure-Go, no CGO required |
| **Docker** | node:22-alpine / golang:1.26.2-alpine / alpine:3.23 | Multi-stage build |

## Repository layout

```
.github/copilot/skills/   Copilot walkthrough pipeline skills (writer, reviewer, gamer, completionist, ingest)
.github/workflows/        CI: schema validation + build/push image + update manifests
walkthroughs/             Curated walkthrough JSON files
webapp/                   SvelteKit PWA (TypeScript, Svelte 5)
server/                   Go sync server
server/k8s/               Kubernetes manifests (synced by ArgoCD)
server/argocd/            ArgoCD Application manifest (bootstrap only)
docs/                     Setup guides, device guides, troubleshooting
```

## Architecture

The Go server runs in one of three modes, controlled by the `APP_MODE` environment variable:

| Mode | `APP_MODE` | Walkthrough source | Progress storage | Use case |
|---|---|---|---|---|
| **Server** | `server` | Polls GitHub Trees API | Local SQLite (authoritative) | Kubernetes / NAS — central hub |
| **Client** | `client` | Fetches from a remote server | Local SQLite + syncs upstream | Handheld devices (Steam Deck, ROG Ally) |
| **File** | *(unset)* | Reads from local `walkthroughs/` dir | Local SQLite | Local development |

See [docs/server-setup.md](docs/server-setup.md) and [docs/client-setup.md](docs/client-setup.md) for full setup instructions.

## Quick start (development)

Requires **Go 1.26+** and **Node 22+**.

```bash
# Build the webapp
cd webapp && npm ci --legacy-peer-deps && npm run build && cd ..

# Run in file mode (reads from local walkthroughs/ directory)
cd server
go run . \
  --addr :8080 \
  --db ../data/progress.sqlite \
  --walkthroughs ../walkthroughs \
  --static ../webapp/build
```

Open `http://localhost:8080`.

## Documentation

| Guide | Description |
|---|---|
| [docs/server-setup.md](docs/server-setup.md) | Deploying the server (Kubernetes, Docker Compose, bare metal) |
| [docs/client-setup.md](docs/client-setup.md) | Setting up clients (browser PWA, local client server, Bazzite handhelds) |
| [docs/steam-deck-setup.md](docs/steam-deck-setup.md) | Steam Deck device-specific guide |
| [docs/rog-ally-setup.md](docs/rog-ally-setup.md) | ROG Ally device-specific guide |
| [docs/windows-setup.md](docs/windows-setup.md) | Windows PC guide |
| [docs/adding-a-walkthrough.md](docs/adding-a-walkthrough.md) | Walkthrough creation pipeline (4-agent Copilot workflow) |
| [docs/e2e-test-plan.md](docs/e2e-test-plan.md) | Manual E2E test plan for server/client mode |
| [docs/tsg-httproute-not-accepted.md](docs/tsg-httproute-not-accepted.md) | Troubleshooting: Cilium HTTPRoute not accepted |

## Walkthrough format

Each walkthrough section supports **two complementary content modes**:

| Field | Purpose |
|---|---|
| `content` | Full walkthrough prose in Markdown with embedded milestone checkpoints |
| `checkpoints` | Array of milestone markers (`id` + `label`) referenced in the prose |
| `steps` | Granular checkable action items (classic checklist) |

When a section has `content`, the app renders the full prose as the primary view with interactive 🏁 milestone checkpoints embedded inline. Granular `steps` appear in a collapsible "Detailed steps" panel. Sections without `content` render the classic step-only checklist.

Milestone checkpoints are embedded in the Markdown prose using HTML comments:
```
<!-- checkpoint: boss-defeated | Defeated the First Boss -->
```

## Step type legend

| Icon | Type | Meaning |
|---|---|---|
| ✓ | `step` | Standard checkable action |
| ℹ | `note` | Tip or info — not checkable |
| ⚠ | `warning` | Do not miss / be careful |
| ◆ | `collectible` | Missable item or trophy |
| ☠ | `boss` | Boss fight |
