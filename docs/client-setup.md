# Client Setup

This guide covers setting up devices that connect to your walkthrough server — handhelds (Steam Deck, ROG Ally), PCs, or any browser.

## How client mode works

A client connects to your walkthrough server, lets you browse the full walkthrough catalog, and **check out** the walkthroughs you want to use on this device. Here's the typical flow:

1. **Browse & check out** — Connect to the server and check out the walkthroughs you need. Content is downloaded and cached locally for offline use.
2. **Play offline** — Use your walkthroughs without internet. Progress saves locally.
3. **Sync when online** — When the device reconnects, progress automatically syncs to the server. Any progress made on other devices is pulled down too.
4. **Check in when done** — When you're finished with a walkthrough, check it in. This stops the client from syncing progress for that walkthrough, reducing network traffic.

Under the hood:

- Fetches the walkthrough catalog from the server on a configurable interval (default: every 10 minutes)
- Only downloads full content for checked-out walkthroughs (the rest are browsable metadata)
- Caches checked-out walkthrough data to disk so the app works fully offline
- Pushes local progress changes upstream (default: every 30 seconds) — only for checked-out walkthroughs
- Pulls latest progress from the server on startup for checked-out walkthroughs

---

## Option 1: Local client server (recommended for handhelds)

Running a local client server gives you a dedicated background service that keeps walkthroughs synced even when the browser isn't open. This is the recommended setup for Steam Deck, ROG Ally, and other handhelds running Bazzite because it:

- Syncs walkthroughs in the background — data is always ready when you switch to the app mid-game
- Works fully offline without needing to have opened the browser first
- Gives you full control over caching and sync intervals

> **Power note:** The Go server binary is lightweight (~15 MB, ~10-20 MB RAM at runtime). On handhelds, the overhead is negligible compared to the games you're running.

### On a handheld running Bazzite (Steam Deck / ROG Ally)

Bazzite is an immutable (atomic) OS, so the easiest way to run the server is by extracting the pre-built binary from the container image.

**1. Extract the server binary:**

```bash
# Pull the image and copy the binary out
podman create --name wt-extract ghcr.io/camcast3/walkthrough-server:latest
podman cp wt-extract:/app/walkthrough-server ~/.local/bin/walkthrough-server
podman cp wt-extract:/static ~/.local/share/walkthrough-app/static
podman rm wt-extract

chmod +x ~/.local/bin/walkthrough-server
```

**2. Create a systemd user service:**

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/walkthroughs.service << 'EOF'
[Unit]
Description=Walkthrough client server
After=network-online.target
Wants=network-online.target

# Don't block boot — start after network is available but don't fail if it isn't
[Service]
Type=exec
ExecStart=%h/.local/bin/walkthrough-server
Environment=APP_MODE=client
Environment=REMOTE_SERVER_URL=http://walkthroughs.yourdomain.com
Environment=DB_PATH=%h/.local/share/walkthrough-app/progress.sqlite
Environment=REMOTE_CACHE_DIR=%h/.local/share/walkthrough-app
Environment=STATIC_DIR=%h/.local/share/walkthrough-app/static
Environment=LISTEN_ADDR=:8080

# Graceful startup — don't hang boot if the network or server is unreachable
TimeoutStartSec=10
TimeoutStopSec=5

# Auto-restart on failure, but with backoff to avoid spinning
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF
```

**3. Enable and start:**

```bash
mkdir -p ~/.local/share/walkthrough-app
systemctl --user daemon-reload
systemctl --user enable walkthroughs.service
systemctl --user start walkthroughs.service

# Verify it's running
systemctl --user status walkthroughs.service
curl -s http://localhost:8080/api/config | head
```

> **Boot safety:** The service uses `TimeoutStartSec=10` and `Restart=on-failure` with a 10-second backoff. If the remote server is unreachable on boot, the server starts anyway and serves cached data. It will never hang the boot process.

**4. Add to Steam Game Mode:**

1. Switch to Desktop Mode
2. Open Steam → **Games → Add a Non-Steam Game → Browse**
3. Find Chromium (e.g. `/usr/bin/chromium-browser` or `flatpak run com.github.nickvergessen.chromium`)
4. Set **Launch Options** to: `--new-window --app=http://localhost:8080`
5. Rename the shortcut to **"Walkthroughs"**

### Updating the binary

When a new version is released, re-extract from the latest image:

```bash
systemctl --user stop walkthroughs.service
podman pull ghcr.io/camcast3/walkthrough-server:latest
podman create --name wt-extract ghcr.io/camcast3/walkthrough-server:latest
podman cp wt-extract:/app/walkthrough-server ~/.local/bin/walkthrough-server
podman cp wt-extract:/static ~/.local/share/walkthrough-app/static
podman rm wt-extract
systemctl --user start walkthroughs.service
```

### On Windows

See [windows-setup.md](windows-setup.md) for running the server locally on Windows.

---

## Option 2: Browser only (no local server)

If you don't want to run a local server, you can access the app directly from your walkthrough server over the network. This is a simpler setup but requires the server to be reachable for the initial load:

1. Open **Chromium** or **Chrome** (recommended — best Gamepad API and controller support out of the box)
2. Navigate to your server URL (e.g. `https://walkthroughs.yourdomain.com`)
3. Install as a PWA: click the install icon in the address bar, or menu → **Install App**
4. The service worker caches the app and walkthrough data for offline use after first load

> **Why Chromium?** Chromium-based browsers (Chrome, Edge, Chromium) have the most complete Gamepad API implementation and support WebHID for low-latency controller input. Firefox supports the basic Gamepad API but lacks WebHID and may gate controller data behind user interaction. For handheld devices where controller navigation is primary, Chromium gives the best experience.

### Device-specific guides

| Device | Guide |
|---|---|
| Steam Deck (Bazzite) | [steam-deck-setup.md](steam-deck-setup.md) |
| ROG Ally (Bazzite) | [rog-ally-setup.md](rog-ally-setup.md) |
| Windows PC | [windows-setup.md](windows-setup.md) |

---

## Environment variables

These variables configure client mode at startup. Settings can also be changed at runtime from the webapp **Settings** page (`/settings`) without restarting the server — runtime changes are persisted to SQLite and take precedence over environment variables on subsequent restarts.

| Variable | Example | Description |
|---|---|---|
| `APP_MODE` | `client` | **Required.** Enables client mode |
| `REMOTE_SERVER_URL` | `http://walkthroughs.local.negativezone.cc` | URL of the walkthrough server (optional — can be set later from the Settings page) |
| `REMOTE_REFRESH_INTERVAL` | `10m` | How often to re-fetch walkthroughs from the server (default: `10m`) |
| `REMOTE_CACHE_DIR` | `/data` | Local directory for caching walkthrough data |
| `PROGRESS_SYNC_INTERVAL` | `30s` | How often to push progress changes to the server (default: `30s`) |

Common variables (`DB_PATH`, `STATIC_DIR`, `LISTEN_ADDR`) are documented in [server-setup.md](server-setup.md#common-variables-all-modes).

---

## Power-save mode

Handheld devices benefit from automatic power-save mode. When the server runs in client mode (`APP_MODE=client`) or is unreachable (offline), the webapp disables GPU-heavy effects:

- Background mesh animations and progress bar shimmer
- `backdrop-filter: blur()` on cards and UI elements
- Gamepad polling reduced from 60fps to ~15fps (active only when a gamepad is connected and the page is visible)

NAS/server deployments (`APP_MODE=server` or default) keep all visual effects enabled. The server exposes its mode via `GET /api/config` and the webapp reads it on load. No configuration needed on the device — it happens automatically.
