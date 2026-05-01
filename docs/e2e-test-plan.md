# E2E Test Plan: Server/Client Mode

## Overview
Test the full server ↔ client flow locally by running two instances of the Go server: one in server mode (simulating k8s) and one in client mode (simulating the ROG Ally).

## Prerequisites
- Go 1.26+ installed
- Node 22+ installed (for webapp build)
- No Docker required — tests run directly
- For private repos: `GITHUB_TOKEN` env var required (use `gh auth token`)

## Architecture Under Test
```
[GitHub Repo] → [Server :9090] ← [Client :8080] ← [Browser/curl]
```

---

## Test Cases

### 1. Server Mode — Starts and Fetches from GitHub
**Goal:** Verify server mode pulls walkthroughs from the repo.

```powershell
cd server
go build -o walkthrough-server.exe .

# Start in server mode (uses this repo as source)
$env:APP_MODE="server"
$env:GITHUB_REPO="camcast3/walkthrough-app"
$env:GITHUB_PATH="walkthroughs"
$env:GITHUB_BRANCH="main"
$env:DB_PATH="./test-data/server/progress.sqlite"
$env:GITHUB_CACHE_DIR="./test-data/server"
$env:STATIC_DIR="../webapp/build"
$env:LISTEN_ADDR=":9090"

./walkthrough-server.exe
```

**Verify:**
- [ ] Server starts without error
- [ ] Logs show `[github-source] refreshed: N walkthroughs`
- [ ] `curl http://localhost:9090/api/walkthroughs` returns JSON array with walkthrough metadata
- [ ] `curl http://localhost:9090/api/walkthroughs/<id>` returns full walkthrough JSON

---

### 2. Client Mode — Connects to Server and Caches
**Goal:** Verify client mode pulls walkthroughs from the server instance.

```powershell
# In a separate terminal
$env:APP_MODE="client"
$env:REMOTE_SERVER_URL="http://localhost:9090"
$env:DB_PATH="./test-data/client/progress.sqlite"
$env:REMOTE_CACHE_DIR="./test-data/client"
$env:STATIC_DIR="../webapp/build"
$env:LISTEN_ADDR=":8080"

./walkthrough-server.exe
```

**Verify:**
- [ ] Client starts without error
- [ ] Logs show `[remote-source] refreshed: N walkthroughs from http://localhost:9090`
- [ ] `curl http://localhost:8080/api/walkthroughs` returns same data as server
- [ ] `curl http://localhost:8080/api/walkthroughs/<id>` returns full walkthrough

---

### 3. Progress Write-Through (Client → Server)
**Goal:** Verify progress saved on client syncs upstream to server.

```powershell
# Save progress on the CLIENT
curl -X PUT http://localhost:8080/api/progress/dark-souls-1 `
  -H "Content-Type: application/json" `
  -d '{"checkedSteps":["step-1","step-2"],"updatedAt":"2026-04-30T12:00:00Z"}'
```

**Verify:**
- [ ] Client responds 200 with the saved record
- [ ] Within 30s, `curl http://localhost:9090/api/progress/dark-souls-1` returns the same progress
- [ ] Client logs show no sync errors

---

### 4. Progress Pull on Startup (Server → Client)
**Goal:** Verify client pulls existing progress from server on startup.

```powershell
# Save progress directly on the SERVER
curl -X PUT http://localhost:9090/api/progress/dark-souls-1 `
  -H "Content-Type: application/json" `
  -d '{"checkedSteps":["step-1","step-2","step-3"],"updatedAt":"2026-04-30T13:00:00Z"}'

# Restart the client (stop and start again)
# After restart:
curl http://localhost:8080/api/progress/dark-souls-1
```

**Verify:**
- [ ] Client returns the SERVER's progress (3 steps, newer timestamp)
- [ ] Local SQLite on client now has the updated record

---

### 5. Offline Resilience — Client Serves Cached Data
**Goal:** Verify client still works when server is unreachable.

```powershell
# 1. With both running, verify client has cached data
curl http://localhost:8080/api/walkthroughs  # should work

# 2. Stop the server (kill the :9090 process)

# 3. Restart the client
# Client should log: "[remote-source] initial fetch failed (serving cached data if available)"

# 4. Verify client still serves walkthroughs from disk cache
curl http://localhost:8080/api/walkthroughs  # should still return data
curl http://localhost:8080/api/walkthroughs/<id>  # should still return data
```

**Verify:**
- [ ] Client starts successfully even without server
- [ ] Walkthroughs served from disk cache (`test-data/client/remote-walkthrough-cache.json`)
- [ ] Progress reads still work (local SQLite)
- [ ] Progress writes still work locally (sync will queue and retry)

---

### 6. PWA Serves Correctly
**Goal:** Verify the webapp loads from both server and client.

```powershell
# Build webapp first
cd webapp && npm run build && cd ..
```

**Verify:**
- [ ] `curl http://localhost:8080/` returns HTML (index.html)
- [ ] `curl http://localhost:8080/some-random-path` returns index.html (SPA fallback)
- [ ] Open `http://localhost:8080` in a browser — walkthrough list loads
- [ ] Click a walkthrough — full content renders
- [ ] Check a step — progress saves (verify in API)

---

### 7. Server Conditional Refresh (No Wasted API Calls)
**Goal:** Verify server doesn't re-fetch when nothing changed.

```powershell
# Watch server logs after initial fetch
# Wait for a refresh cycle (5min default, or set GITHUB_REFRESH_INTERVAL=30s for testing)
$env:GITHUB_REFRESH_INTERVAL="30s"
```

**Verify:**
- [ ] After first fetch, subsequent refreshes log nothing (tree SHA unchanged)
- [ ] No new `refreshed:` log lines appear unless repo content actually changes

---

### 8. Client Refresh Picks Up New Content
**Goal:** Verify client gets new walkthroughs when they're added on server.

```powershell
# With both running, note current walkthrough count
curl http://localhost:8080/api/walkthroughs | jq length

# Add a new walkthrough JSON to the repo and push (or wait for server refresh)
# After server refreshes, wait for client refresh interval

curl http://localhost:8080/api/walkthroughs | jq length  # should be +1
```

**Verify:**
- [ ] New walkthrough appears on client after refresh cycle

---

## Quick-Start Test Script

Save as `test-e2e.ps1` in repo root:

```powershell
# Build
cd webapp; npm run build; cd ..
cd server; go build -o walkthrough-server.exe .; cd ..

# Clean test data
Remove-Item -Recurse -Force ./test-data -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path ./test-data/server, ./test-data/client -Force

# Start server mode
$server = Start-Process -FilePath ./server/walkthrough-server.exe -PassThru -NoNewWindow -Environment @{
    APP_MODE="server"; GITHUB_REPO="camcast3/walkthrough-app"; GITHUB_PATH="walkthroughs"
    GITHUB_BRANCH="main"; DB_PATH="./test-data/server/progress.sqlite"
    GITHUB_CACHE_DIR="./test-data/server"; STATIC_DIR="./webapp/build"; LISTEN_ADDR=":9090"
    GITHUB_REFRESH_INTERVAL="30s"
}

Start-Sleep 5  # wait for initial GitHub fetch

# Start client mode
$client = Start-Process -FilePath ./server/walkthrough-server.exe -PassThru -NoNewWindow -Environment @{
    APP_MODE="client"; REMOTE_SERVER_URL="http://localhost:9090"
    DB_PATH="./test-data/client/progress.sqlite"; REMOTE_CACHE_DIR="./test-data/client"
    STATIC_DIR="./webapp/build"; LISTEN_ADDR=":8080"
}

Start-Sleep 3  # wait for client to pull from server

Write-Host "`n=== Test: List walkthroughs (client) ==="
curl -s http://localhost:8080/api/walkthroughs

Write-Host "`n=== Test: Save progress (client) ==="
curl -s -X PUT http://localhost:8080/api/progress/test-1 -H "Content-Type: application/json" -d '{\"checkedSteps\":[\"a\",\"b\"],\"updatedAt\":\"2026-04-30T12:00:00Z\"}'

Start-Sleep 35  # wait for sync interval

Write-Host "`n=== Test: Verify progress synced to server ==="
curl -s http://localhost:9090/api/progress/test-1

# Cleanup
Stop-Process -Id $server.Id
Stop-Process -Id $client.Id
```

---

## Pass Criteria
All 8 test cases pass. The client operates independently of the server after initial cache population.
