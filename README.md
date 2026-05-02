# Walkthrough Checklist App

A touch and controller-optimized PWA for game walkthroughs. Works on Steam Deck, ROG Ally (Bazzite), and Windows PC. Syncs progress to a self-hosted server when online; works fully offline via service worker.

## Repository layout

```
.github/copilot/skills/   Copilot walkthrough ingestion skill
.github/workflows/        CI: schema validation + build/push image + update manifests
walkthroughs/             Curated walkthrough JSON files
webapp/                   SvelteKit PWA (TypeScript)
server/                   Go sync server
server/k8s/               Kubernetes manifests (synced by ArgoCD)
server/argocd/            ArgoCD Application manifest (bootstrap only)
docs/                     Device setup guides
```

---

## Deploying to Kubernetes

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

ArgoCD will create the `walkthroughs` namespace, apply all manifests in `server/k8s/`, and watch this repo for changes going forward. No need to add anything to `the-basement`.

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

### Updating walkthroughs

Push JSON files to `walkthroughs/<game>/` in this repo. The server (running in `server` mode on the cluster) polls the GitHub Trees API every 5 minutes and picks up changes automatically — no image rebuild or redeployment needed.

---

## Running locally (without Docker)

Requires Go 1.21+ and Node 18+.

```bash
# Build the webapp
cd webapp && npm ci && npm run build && cd ..

# Run the server
cd server
go run . \
  --addr :8080 \
  --db ../data/progress.sqlite \
  --walkthroughs ../walkthroughs \
  --static ../webapp/build
```

Open `http://localhost:8080`.

## Running with Docker Compose

```bash
# Build the webapp first (the compose file mounts ./webapp/build)
cd webapp && npm ci && npm run build && cd ..

docker compose up
```

The server is available at `http://localhost:8080`.

---

## Device setup guides

| Device | Guide |
|---|---|
| Windows PC | [docs/windows-setup.md](docs/windows-setup.md) |
| Steam Deck (Bazzite) | [docs/steam-deck-setup.md](docs/steam-deck-setup.md) |
| ROG Ally (Bazzite) | [docs/rog-ally-setup.md](docs/rog-ally-setup.md) |

---

## Adding walkthroughs

See [docs/adding-a-walkthrough.md](docs/adding-a-walkthrough.md) for the manual process, or use the **Copilot walkthrough ingestion skill** (`.github/copilot/skills/walkthrough-ingest.md`) to have Copilot convert any online walkthrough into the correct JSON format automatically.

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
