# Walkthrough App — Server

Go HTTP server that serves the walkthrough PWA, manages progress data in SQLite, and synchronizes walkthroughs from GitHub or a remote server instance.

## Prerequisites

- **Go 1.26+** (see `go.mod`)
- No CGO required — uses pure-Go SQLite (`modernc.org/sqlite`)

## Quick start

```bash
# Build
go build -o walkthrough-server .

# Run in file mode (development — reads walkthroughs from local directory)
./walkthrough-server \
  --addr :8080 \
  --db ../data/progress.sqlite \
  --walkthroughs ../walkthroughs \
  --static ../webapp/build
```

## Build & test

```bash
# Build
go build ./...

# Run tests
go test ./...

# Build binary (Linux — for Docker/k8s)
GOOS=linux GOARCH=amd64 go build -o walkthrough-server .

# Build binary (Windows)
go build -o walkthrough-server.exe .
```

## Operating modes

The server supports three modes via the `APP_MODE` environment variable. See the [root README](../README.md#architecture-server-mode-vs-client-mode) for full details.

| Mode | `APP_MODE` | Description |
|---|---|---|
| **Server** | `server` | Polls GitHub for walkthroughs, serves as authoritative source |
| **Client** | `client` | Fetches from a remote server, syncs progress upstream |
| **File** | *(unset)* | Reads walkthroughs from local filesystem |

## Project structure

```
main.go              Entry point, routing, mode selection
handlers/
├── handlers.go      HTTP handler implementations (CRUD, config, checkouts)
└── ingest.go        Walkthrough ingestion pipeline (server mode only)
source/              Walkthrough data sources (GitHub, remote, file)
store/               SQLite database layer (progress, checkouts, local walkthroughs)
upstream/            Progress sync client (client mode → server)
k8s/                 Kubernetes manifests
argocd/              ArgoCD application manifest
Dockerfile           Multi-stage build (webapp + server)
```

## Docker

The `Dockerfile` is a multi-stage build that compiles both the SvelteKit webapp and the Go server:

```bash
# Build from repo root
docker build -f server/Dockerfile -t walkthrough-server .

# Run
docker run -p 8080:8080 \
  -e APP_MODE=server \
  -e GITHUB_REPO=camcast3/walkthrough-app \
  -v walkthrough-data:/data \
  walkthrough-server
```

## Environment variables

See the [root README](../README.md#architecture-server-mode-vs-client-mode) for the full environment variable reference.
