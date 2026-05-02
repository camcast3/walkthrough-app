# Steam Deck Setup (Bazzite)

## Prerequisites
- Your walkthrough server is deployed and accessible (see [Kubernetes setup](../README.md#deploying-to-kubernetes))
- You have the server URL (e.g. `https://walkthroughs.yourdomain.com` or a LAN IP like `http://192.168.1.x:8080`)

## First-time setup (Desktop Mode)

1. Open **Desktop Mode** (hold Power → Switch to Desktop)
2. Open **Firefox** or **Chromium**
3. Navigate to your server URL
4. Wait for the page to fully load (this caches the app for offline use)
5. Optional: click the browser menu → **Install App** or **Add to Home Screen** to install it as a PWA

## Adding to Game Mode (one-time)

1. In Desktop Mode, open **Steam**
2. Click **Games → Add a Non-Steam Game**
3. Click **Browse** and find your browser (e.g. `/usr/bin/chromium-browser` or `flatpak run org.mozilla.firefox`)
4. Add it, then go to its **Properties**
5. Set **Launch Options** to:
   ```
   --new-window --app=https://walkthroughs.yourdomain.com
   ```
   (The `--app` flag opens it in app mode — no browser chrome)
6. Rename the shortcut to **"Walkthroughs"**
7. Optionally set a custom grid image/icon

## Using mid-game

1. Press the **Steam button**
2. Select **Switch → Walkthroughs** (or use the app switcher)
3. Your game stays running in the background

## Power-save mode

When the app connects to a server running in **client mode** (`APP_MODE=client`), it automatically enables power-save mode to reduce battery drain on the Steam Deck:

- Background animations and shimmer effects are disabled
- Backdrop blur effects on cards and UI elements are removed
- Gamepad polling drops from 60fps to ~15fps (only active when a gamepad is connected and the page is visible)

This happens automatically — no configuration needed on the device. If the server is unreachable (offline mode), power-save is also enabled by default.

> **Tip:** If you're running the server locally on the Steam Deck itself, set `APP_MODE=client` so the webapp picks up power-save mode. NAS/server deployments default to full visual effects.

## Controller navigation

| Button | Action |
|---|---|
| D-pad ↑ / ↓ | Move focus between steps |
| **A** | Check/uncheck focused step |
| **B** | Go back to walkthrough list |
| **LB** / **RB** | Switch between sections |
| Right trackpad | Mouse cursor (for scrolling / tapping) |
| R2 (right trigger) | Mouse click |

## Offline use

Once the app has been loaded at least once with internet, it works fully offline.
Progress is saved locally and will sync automatically next time you're online.
