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
| **Docker** | node:22-alpine / golang:1.26.2-alpine | Multi-stage build |

## Repository layout

```
.github/copilot/skills/   Copilot walkthrough pipeline skills (writer, reviewer, gamer, completionist)
.github/workflows/        CI: schema validation + build/push image + update manifests
walkthroughs/             Curated walkthrough JSON files
webapp/                   SvelteKit PWA (TypeScript, Svelte 5)
server/                   Go sync server
server/k8s/               Kubernetes manifests (synced by ArgoCD)
server/argocd/            ArgoCD Application manifest (bootstrap only)
docs/                     Device & troubleshooting guides
```

---

## Architecture: server mode vs client mode

The Go server runs in one of three modes, controlled by the `APP_MODE` environment variable:

| Mode | `APP_MODE` | Walkthrough source | Progress storage | Use case |
|---|---|---|---|---|
| **Server** | `server` | Polls GitHub Trees API | Local SQLite (authoritative) | Kubernetes / NAS — central hub |
| **Client** | `client` | Fetches from a remote server | Local SQLite + syncs upstream | Handheld devices (Steam Deck, ROG Ally) |
| **File** | *(unset)* | Reads from local `walkthroughs/` dir | Local SQLite | Local development |

### Server mode

The server is the authoritative source of truth. It runs on your Kubernetes cluster (or any always-on machine) and:

- Polls the GitHub repo for walkthrough JSON files every 5 minutes (configurable via `GITHUB_REFRESH_INTERVAL`)
- Stores progress in a local SQLite database
- Serves the PWA webapp to browsers
- Exposes management APIs under `/api/server/` (ingest jobs, connected devices)

**Required environment variables:**

| Variable | Example | Description |
|---|---|---|
| `APP_MODE` | `server` | Enables server mode |
| `GITHUB_REPO` | `camcast3/walkthrough-app` | GitHub repo in `owner/repo` format |
| `GITHUB_BRANCH` | `main` | Branch to poll (default: `main`) |
| `GITHUB_PATH` | `walkthroughs` | Path within the repo (default: `walkthroughs`) |
| `GITHUB_TOKEN` | *(optional)* | Required for private repos |
| `GITHUB_REFRESH_INTERVAL` | `5m` | How often to check for new walkthroughs (default: `5m`) |
| `GITHUB_CACHE_DIR` | `/data` | Directory for cached walkthrough data |

### Client mode

Clients connect to a remote server instance. They cache walkthroughs locally so they work offline, and sync progress bi-directionally:

- Fetches the walkthrough list and content from the remote server every 10 minutes (configurable via `REMOTE_REFRESH_INTERVAL`)
- Caches walkthrough data to disk for offline use
- Pushes local progress changes upstream every 30 seconds (configurable via `PROGRESS_SYNC_INTERVAL`)
- Pulls latest progress from the server on startup
- Only syncs walkthroughs that are "checked out" on the device

**Required environment variables:**

| Variable | Example | Description |
|---|---|---|
| `APP_MODE` | `client` | Enables client mode |
| `REMOTE_SERVER_URL` | `http://walkthroughs.local.negativezone.cc` | URL of the server instance |
| `REMOTE_REFRESH_INTERVAL` | `10m` | How often to re-fetch walkthroughs (default: `10m`) |
| `REMOTE_CACHE_DIR` | `/data` | Directory for cached walkthrough data |
| `PROGRESS_SYNC_INTERVAL` | `30s` | How often to push progress upstream (default: `30s`) |

### Common environment variables (all modes)

| Variable | Flag | Default | Description |
|---|---|---|---|
| `DB_PATH` | `--db` | `/data/progress.sqlite` | Path to SQLite database file |
| `STATIC_DIR` | `--static` | `/static` | Path to built webapp static files |
| `LISTEN_ADDR` | `--addr` | `:8080` | Listen address |
| `WALKTHROUGHS_DIR` | `--walkthroughs` | `/walkthroughs` | Local walkthrough directory (file mode only) |

### API routes

| Endpoint | Method | Description | Mode |
|---|---|---|---|
| `/api/config` | GET | App configuration (mode, features) | All |
| `/api/walkthroughs` | GET | List all walkthrough metadata | All |
| `/api/walkthroughs/{id}` | GET | Get full walkthrough content | All |
| `/api/progress/{id}` | GET | Get progress for a walkthrough | All |
| `/api/progress/{id}` | PUT | Save progress for a walkthrough | All |
| `/api/checkouts` | GET | List checked-out walkthroughs | All |
| `/api/checkouts/{id}` | PUT | Check out a walkthrough | All |
| `/api/checkouts/{id}` | DELETE | Remove a checkout | All |
| `/api/server/ingest` | POST | Start a walkthrough ingest job | Server only |
| `/api/server/ingest` | GET | List ingest jobs | Server only |
| `/api/server/ingest/{id}` | GET | Get ingest job status | Server only |
| `/api/server/devices` | GET | List connected devices | Server only |

---

## Setting up the server

### Option 1: Kubernetes (recommended for always-on)

#### Cluster prerequisites

| Component | Role |
|---|---|
| **ArgoCD** | GitOps — watches `server/k8s/` on `main` and applies changes automatically |
| **Argo Rollouts** | Replaces standard Deployments; `Recreate` strategy used (required for RWO PVC) |
| **Cilium Gateway API** | Ingress via `HTTPRoute` — no nginx ingress needed |
| **Rook Ceph** | Block storage for the SQLite PVC (`storageClassName: rook-ceph-block`) |

#### One-time setup

**1. Register with ArgoCD** (run once from any machine with cluster access):
```bash
kubectl apply -f server/argocd/app.yaml -n argocd
```

ArgoCD will create the `walkthroughs` namespace, apply all manifests in `server/k8s/`, and watch this repo for changes going forward.

**2. Allow GitHub Actions to push commits back** (needed for manifest updates):
- Repo **Settings → Actions → General → Workflow permissions → Read and write permissions**

#### How CI/CD works

On every push to `main` the workflow (`.github/workflows/deploy.yml`):
1. Builds the multi-stage Docker image (SvelteKit webapp + Go server)
2. Pushes the image to `ghcr.io/camcast3/walkthrough-server` (tagged with commit SHA)
3. Updates the image tag in `server/k8s/rollout.yaml`
4. Commits that change back to `main` with `[skip ci]`

ArgoCD detects the new commit and syncs — triggering a Rollout with `Recreate` strategy.

> **No `KUBECONFIG` secret required.** ArgoCD handles all cluster operations. Walkthroughs are fetched at runtime from GitHub (no ConfigMaps).

#### Kubernetes manifests

| File | Kind | Purpose |
|---|---|---|
| `server/k8s/rollout.yaml` | `argoproj.io/v1alpha1/Rollout` | App workload; canary with maxSurge=0 for RWO PVC |
| `server/k8s/service.yaml` | `Service` | ClusterIP on port 80 → container 8080 |
| `server/k8s/httproute.yaml` | `gateway.networking.k8s.io/v1/HTTPRoute` | Cilium Gateway API routing |
| `server/k8s/pvc.yaml` | `PersistentVolumeClaim` | 1 Gi `rook-ceph-block` volume for SQLite + cache |
| `server/argocd/app.yaml` | `argoproj.io/v1alpha1/Application` | ArgoCD app definition (add to app-of-apps) |

### Option 2: Docker Compose

```bash
# Build the webapp first (the compose file mounts ./webapp/build)
cd webapp && npm ci && npm run build && cd ..

docker compose up
```

The server is available at `http://localhost:8080`. The default `docker-compose.yml` runs in **client mode** — set `APP_MODE=server` and add `GITHUB_REPO` to run as a server.

### Option 3: Run directly (no Docker)

Requires **Go 1.26+** and **Node 22+**.

```bash
# Build the webapp
cd webapp && npm ci && npm run build && cd ..

# Run in file mode (reads from local walkthroughs/ directory)
cd server
go run . \
  --addr :8080 \
  --db ../data/progress.sqlite \
  --walkthroughs ../walkthroughs \
  --static ../webapp/build
```

Open `http://localhost:8080`.

To run in server mode instead:

```bash
APP_MODE=server \
GITHUB_REPO=camcast3/walkthrough-app \
DB_PATH=../data/progress.sqlite \
STATIC_DIR=../webapp/build \
go run . --addr :8080
```

#### Updating walkthroughs

Push JSON files to `walkthroughs/<game>/` in this repo. The server (running in `server` mode) polls the GitHub Trees API every 5 minutes and picks up changes automatically — no image rebuild or redeployment needed.

---

## Setting up clients

Clients run on devices where you play games. They connect to your server, cache walkthroughs for offline use, and sync progress.

### Option 1: Browser only (no local server)

If your server is accessible over the network, just open the URL in a browser:

1. Navigate to your server URL (e.g. `https://walkthroughs.yourdomain.com`)
2. Install as a PWA via the browser menu for a native app experience
3. The service worker caches the app for offline use after first load

### Option 2: Local client server (recommended for handhelds)

Running a local client server on the device gives you full offline support with background sync. This is the recommended setup for Steam Deck, ROG Ally, and other handhelds running Bazzite.

#### On a handheld running Bazzite (Steam Deck / ROG Ally)

**Prerequisites:**
- Bazzite installed on the device
- Your walkthrough server deployed and accessible on the network
- `podman` available (pre-installed on Bazzite)

**1. Pull and run the container:**

```bash
podman pull ghcr.io/camcast3/walkthrough-server:latest

podman run -d \
  --name walkthroughs \
  --restart unless-stopped \
  -p 8080:8080 \
  -e APP_MODE=client \
  -e REMOTE_SERVER_URL=http://walkthroughs.yourdomain.com \
  -e DB_PATH=/data/progress.sqlite \
  -e REMOTE_CACHE_DIR=/data \
  -e STATIC_DIR=/static \
  -v walkthrough-data:/data \
  ghcr.io/camcast3/walkthrough-server:latest
```

**2. Auto-start on boot (systemd user service):**

```bash
mkdir -p ~/.config/systemd/user
podman generate systemd --name walkthroughs --new > ~/.config/systemd/user/walkthroughs.service
systemctl --user enable walkthroughs.service
systemctl --user start walkthroughs.service
```

**3. Add to Steam Game Mode:**

1. Switch to Desktop Mode
2. Open Steam → **Games → Add a Non-Steam Game → Browse**
3. Find your browser (e.g. `/usr/bin/chromium-browser` or `flatpak run org.mozilla.firefox`)
4. Set **Launch Options** to: `--new-window --app=http://localhost:8080`
5. Rename the shortcut to **"Walkthroughs"**

Now you can switch to the Walkthroughs app mid-game using the Steam button.

#### On Windows

See [docs/windows-setup.md](docs/windows-setup.md) for running the server locally on Windows.

### Device setup guides

| Device | Guide |
|---|---|
| Windows PC | [docs/windows-setup.md](docs/windows-setup.md) |
| Steam Deck (Bazzite) | [docs/steam-deck-setup.md](docs/steam-deck-setup.md) |
| ROG Ally (Bazzite) | [docs/rog-ally-setup.md](docs/rog-ally-setup.md) |

### Power-save mode

Handheld devices (ROG Ally, Steam Deck) benefit from automatic power-save mode. When the server is running with `APP_MODE=client` (or is unreachable/offline), the webapp disables GPU-heavy effects:

- Background mesh animations and progress bar shimmer
- `backdrop-filter: blur()` on cards and UI elements
- Gamepad polling reduced from 60fps to ~15fps (active only when a gamepad is connected and the page is visible)

NAS/server deployments (`APP_MODE=server` or default) keep all visual effects enabled. The server exposes its mode via `GET /api/config` and the webapp reads it on load.

---

## Adding walkthroughs

See [docs/adding-a-walkthrough.md](docs/adding-a-walkthrough.md) for the full walkthrough pipeline, or use the **Copilot walkthrough ingestion skill** (`.github/copilot/skills/walkthrough-ingest.md`) for a quick single-pass conversion.

The full pipeline uses four Copilot agents:

```
Writer  →  Reviewer  →  Gamer  →  Completionist
```

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
