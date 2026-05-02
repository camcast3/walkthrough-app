# Windows PC Setup

## Prerequisites
- Server is deployed and accessible (see [server setup](server-setup.md))
- You have the server URL

## Install as PWA (recommended)

1. Open **Chrome** or **Edge**
2. Navigate to your server URL
3. Click the install icon in the address bar (or menu → **Install App**)
4. The app installs as a standalone window with its own taskbar icon

## Offline use

The service worker caches the app and walkthrough data on first load.
After that, it works offline. Progress syncs to your k8s server when you reconnect.

## Running the server locally (optional)

If you want to run the sync server locally on Windows for development:

```powershell
cd server
go build -o walkthrough-server.exe .
.\walkthrough-server.exe `
  -db C:\walkthrough-data\progress.sqlite `
  -walkthroughs ..\walkthroughs `
  -static ..\webapp\build `
  -addr :8080
```

To auto-start on login, create a Task Scheduler task:
- **Trigger**: At log on
- **Action**: Start program → path to `walkthrough-server.exe` with the arguments above
- **Run whether user is logged on or not**: No (keep it simple)

## Controller support (optional)

If you have an Xbox controller or similar connected, the Gamepad API works in Chrome/Edge:

| Button | Action |
|---|---|
| D-pad ↑ / ↓ | Move focus between steps |
| **A** | Check/uncheck step |
| **B** | Back to list |
| **LB** / **RB** | Switch sections |
