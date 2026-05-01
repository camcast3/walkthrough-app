# Walkthrough Checklist App

A touch and controller-optimized PWA for game walkthroughs. Works on Steam Deck, ROG Ally (Bazzite), and Windows PC. Syncs progress to a self-hosted server when online; works fully offline via service worker.

## Repository layout

```
.github/copilot/skills/   Copilot walkthrough ingestion skill
.github/workflows/        CI: schema validation + k8s deploy
walkthroughs/             Curated walkthrough JSON files
webapp/                   SvelteKit PWA (TypeScript)
server/                   Go sync server
server/k8s/               Kubernetes manifests
docs/                     Device setup guides
```

---

## Deploying to Kubernetes

The CI/CD pipeline (`.github/workflows/deploy.yml`) builds the webapp, bakes it into a Docker image alongside the Go server, and deploys to your cluster on every push to `main`.

### Prerequisites

- A Kubernetes cluster with:
  - **nginx ingress controller** (`ingress-nginx`)
  - **cert-manager** (for TLS) — or remove the `tls` block from `server/k8s/ingress.yaml` if terminating TLS elsewhere
  - A default **StorageClass** that supports `ReadWriteOnce` (for the SQLite PVC)
- A GitHub repository with Actions enabled
- `kubectl` access to your cluster from your local machine

### One-time cluster setup

1. **Create the namespace:**
   ```bash
   kubectl create namespace walkthroughs
   ```

2. **Edit the ingress hostname** in `server/k8s/ingress.yaml`:
   ```yaml
   host: walkthroughs.YOUR_DOMAIN   # replace with your actual domain
   ```
   and the matching `tls.hosts` entry.

3. **Edit the image name** in `server/k8s/deployment.yaml`:
   ```yaml
   image: ghcr.io/YOUR_GITHUB_USER/walkthrough-server:latest
   ```
   Replace `YOUR_GITHUB_USER` with your GitHub username or organisation.

4. **Add the `KUBECONFIG` secret to GitHub:**
   - Base64-encode your kubeconfig: `base64 -w0 ~/.kube/config`
   - Go to **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `KUBECONFIG`, value: the base64 string

5. Push to `main`. The workflow will:
   - Build the SvelteKit webapp
   - Build and push the Docker image to `ghcr.io`
   - Apply the k8s manifests (namespace, PVC, ConfigMap, Deployment, Service, Ingress)
   - Roll out the new image and wait for readiness

### Kubernetes manifests

| File | Purpose |
|---|---|
| `server/k8s/deployment.yaml` | Single-replica Deployment; mounts PVC for SQLite and a ConfigMap for walkthrough JSONs |
| `server/k8s/service.yaml` | ClusterIP Service on port 80 → container 8080 |
| `server/k8s/ingress.yaml` | nginx Ingress with TLS (cert-manager annotation optional) |
| `server/k8s/pvc.yaml` | 1 Gi `ReadWriteOnce` PVC for `progress.sqlite` |

### Updating walkthroughs

Walkthrough JSON files in `walkthroughs/` are deployed as a Kubernetes ConfigMap (`walkthrough-files`) on every CI run. To add a new walkthrough, commit a JSON file to `walkthroughs/<game>/` and push — no image rebuild needed.

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

## Step type legend

| Icon | Type | Meaning |
|---|---|---|
| ✓ | `step` | Standard checkable action |
| ℹ | `note` | Tip or info — not checkable |
| ⚠ | `warning` | Do not miss / be careful |
| ◆ | `collectible` | Missable item or trophy |
| ☠ | `boss` | Boss fight |