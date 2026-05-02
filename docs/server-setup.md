# Server Setup

This guide covers deploying the walkthrough server — the authoritative hub that stores walkthroughs and syncs progress across devices.

## How server mode works

The server polls the GitHub repo for walkthrough JSON files and serves them to clients (browsers and local client instances). It is the single source of truth for walkthrough content and progress data.

- Polls the GitHub Trees API on a configurable interval (default: every 5 minutes)
- Stores all progress in a local SQLite database
- Serves the PWA webapp to browsers
- Exposes management APIs under `/api/server/` (ingest jobs, connected devices)

## Environment variables

### Server-mode variables

| Variable | Example | Description |
|---|---|---|
| `APP_MODE` | `server` | **Required.** Enables server mode |
| `GITHUB_REPO` | `camcast3/walkthrough-app` | **Required.** GitHub repo in `owner/repo` format |
| `GITHUB_BRANCH` | `main` | Branch to poll (default: `main`) |
| `GITHUB_PATH` | `walkthroughs` | Path within the repo (default: `walkthroughs`) |
| `GITHUB_TOKEN` | *(optional)* | Required for private repos |
| `GITHUB_REFRESH_INTERVAL` | `5m` | How often to check GitHub for new walkthroughs (default: `5m`) |
| `GITHUB_CACHE_DIR` | `/data` | Local directory for caching walkthrough data fetched from GitHub |

### Common variables (all modes)

| Variable | Flag | Default | Description |
|---|---|---|---|
| `DB_PATH` | `--db` | `/data/progress.sqlite` | Path to SQLite database file |
| `STATIC_DIR` | `--static` | `/static` | Path to built webapp static files |
| `LISTEN_ADDR` | `--addr` | `:8080` | Listen address |
| `WALKTHROUGHS_DIR` | `--walkthroughs` | `/walkthroughs` | Local walkthrough directory (file mode only) |

---

## Option 1: Kubernetes (recommended for always-on)

### Cluster prerequisites

| Component | Role |
|---|---|
| **ArgoCD** | GitOps — watches `server/k8s/` on `main` and applies changes automatically |
| **Argo Rollouts** | Replaces standard Deployments; `Recreate` strategy used (required for RWO PVC) |
| **Cilium Gateway API** | Ingress via `HTTPRoute` — no nginx ingress needed |
| **Rook Ceph** | Block storage for the SQLite PVC (`storageClassName: rook-ceph-block`) |

### One-time setup

**1. Register with ArgoCD** (run once from any machine with cluster access):
```bash
kubectl apply -f server/argocd/app.yaml -n argocd
```

ArgoCD will create the `walkthroughs` namespace, apply all manifests in `server/k8s/`, and watch this repo for changes going forward.

**2. Allow GitHub Actions to push commits back** (needed for manifest updates):
- Repo **Settings → Actions → General → Workflow permissions → Read and write permissions**

### How CI/CD works

On every push to `main` the workflow (`.github/workflows/deploy.yml`):
1. Builds the multi-stage Docker image (SvelteKit webapp + Go server)
2. Pushes the image to `ghcr.io/camcast3/walkthrough-server` (tagged with commit SHA)
3. Updates the image tag in `server/k8s/rollout.yaml`
4. Commits that change back to `main` with `[skip ci]`

ArgoCD detects the new commit and syncs — triggering a Rollout with `Recreate` strategy.

> **No `KUBECONFIG` secret required.** ArgoCD handles all cluster operations. Walkthroughs are fetched at runtime from GitHub (no ConfigMaps).

### Kubernetes manifests

| File | Kind | Purpose |
|---|---|---|
| `server/k8s/rollout.yaml` | `argoproj.io/v1alpha1/Rollout` | App workload; canary with maxSurge=0 for RWO PVC |
| `server/k8s/service.yaml` | `Service` | ClusterIP on port 80 → container 8080 |
| `server/k8s/httproute.yaml` | `gateway.networking.k8s.io/v1/HTTPRoute` | Cilium Gateway API routing |
| `server/k8s/pvc.yaml` | `PersistentVolumeClaim` | 1 Gi `rook-ceph-block` volume for SQLite + cache |
| `server/argocd/app.yaml` | `argoproj.io/v1alpha1/Application` | ArgoCD app definition (add to app-of-apps) |

---

## Option 2: Docker Compose

```bash
# Build the webapp first (the compose file mounts ./webapp/build)
cd webapp && npm ci && npm run build && cd ..

docker compose up
```

The server is available at `http://localhost:8080`. The default `docker-compose.yml` runs in **client mode** — to run as a server, update the environment in `docker-compose.yml`:

```yaml
environment:
  APP_MODE: server
  GITHUB_REPO: camcast3/walkthrough-app
  # ...
```

---

## Option 3: Run directly (no Docker)

Requires **Go 1.26+** and **Node 22+**.

```bash
# Build the webapp
cd webapp && npm ci && npm run build && cd ..

# Run in server mode
cd server
APP_MODE=server \
GITHUB_REPO=camcast3/walkthrough-app \
DB_PATH=../data/progress.sqlite \
STATIC_DIR=../webapp/build \
go run . --addr :8080
```

For development (file mode — reads from local `walkthroughs/` directory):

```bash
cd server
go run . \
  --addr :8080 \
  --db ../data/progress.sqlite \
  --walkthroughs ../walkthroughs \
  --static ../webapp/build
```

Open `http://localhost:8080`.

---

## Updating walkthroughs

Push JSON files to `walkthroughs/<game>/` in this repo. The server polls the GitHub Trees API and picks up changes automatically — no image rebuild or redeployment needed.

## API routes

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
