# ROG Ally Setup (Bazzite)

## Prerequisites
- Same as Steam Deck — server deployed, URL ready

## First-time setup (Desktop Mode)

1. Switch to **Desktop Mode**
2. Open **Firefox** or **Chromium**  
3. Navigate to your server URL and let the page fully load (caches for offline)
4. Optional: install as PWA via the browser menu

## Adding to Game Mode

Same steps as Steam Deck:

1. Open Steam in Desktop Mode
2. **Games → Add a Non-Steam Game → Browse** → find your browser
3. Set Launch Options:
   ```
   --new-window --app=https://walkthroughs.yourdomain.com
   ```
4. Rename shortcut to **"Walkthroughs"**

## Using mid-game

1. Press the **Armoury Crate button** or use the task switcher
2. Switch to the Walkthroughs app — game stays running

## Controller navigation

Same as Steam Deck — the app uses the Gamepad API which works identically on ROG Ally:

| Button | Action |
|---|---|
| D-pad ↑ / ↓ | Move focus between steps |
| **A** | Check/uncheck focused step |
| **B** | Go back to walkthrough list |
| **LB** / **RB** | Switch between sections |
| Right stick | Scroll |

## Offline use

Works offline after first load. Progress syncs when you reconnect.
