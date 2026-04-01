# Process Discovery Collector

A two-part activity tracking system for business process discovery: a macOS Electron menu bar app and a Chrome extension. They work together to capture everything an employee does — which apps they use, what they click, how long they spend, and what's on screen at key moments.

## Architecture

```
chrome-extension/          Manifest V3 extension — tracks all browser activity
desktop-agent/             Electron macOS app — tracks non-browser apps + screenshots  
api-server/                Express API — receives events, manages screenshot uploads to R2
```

### Data Flow

```
Chrome Extension (content.js)
  ─► click/nav events ─► background.js buffer ─► POST /api/v1/events
  ─► WebSocket heartbeat ─► ws://localhost:47832 (desktop agent)

Desktop Agent
  ─► window_change events ─► SQLite ─► POST /api/v1/events
  ─► desktop_click events + screenshot ─► SQLite + local JPEG
  ─► screenshot-uploader ─► POST /upload-url ─► PUT to R2 ─► POST /confirm
```

### Coordination

The Chrome extension maintains a WebSocket connection to `ws://localhost:47832` on the desktop agent. While the extension is connected, the desktop agent **skips** window tracking and screenshots for any browser window — the extension handles all browser activity with richer data.

---

## Setup

### 1. API Server

```bash
cd api-server
npm install
cp .env.example .env
# Edit .env with your PostgreSQL URL, R2 credentials, API key
npm start
```

Requires:
- PostgreSQL 14+
- Cloudflare R2 bucket (or any S3-compatible storage)

### 2. Chrome Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `chrome-extension/` directory
4. Click the extension icon → configure API endpoint and auth token

### 3. Desktop Agent (macOS only)

```bash
cd desktop-agent
npm install
# Note: postinstall runs electron-rebuild for better-sqlite3
npm start
```

**Required macOS permissions** (prompted on first run):
- **Screen Recording** — System Settings → Privacy & Security → Screen Recording
- **Accessibility** — System Settings → Privacy & Security → Accessibility

Click the tray icon → Settings to configure API endpoint and auth token.

---

## Event Types

| Event | Source | Description |
|-------|--------|-------------|
| `tab_switch` | chrome_extension | User switched browser tabs |
| `navigation` | chrome_extension | URL changed (including SPA routes) |
| `click` | chrome_extension | User clicked a button/link in browser |
| `window_change` | desktop_agent | Active app or window title changed |
| `desktop_click` | desktop_agent | Mouse click in non-browser app |
| `idle_start` | desktop_agent | No input for 2+ minutes |
| `idle_end` | desktop_agent | User returned from idle |
| `session_start` | desktop_agent | New session began |
| `session_end` | desktop_agent | Session ended (quit or long idle) |

---

## API Endpoints

All endpoints require `x-api-key: <your-api-key>` header.

### `POST /api/v1/events`
Ingest a batch of events.

```json
{
  "device_id": "desktop_...",
  "employee_id": "emp_alice",
  "company_id": "company_acme",
  "events": [
    {
      "event_id": "uuid",
      "event_type": "window_change",
      "timestamp": "2026-04-01T10:00:00.000Z",
      "source": "desktop_agent",
      "payload": { ... }
    }
  ]
}
```

Response: `{ "received": 47 }`

### `POST /api/v1/screenshots/upload-url`
Request a pre-signed R2 upload URL.

```json
{ "screenshot_id": "scr_...", "timestamp": "...", "trigger_type": "click", "app_name": "Figma" }
```

Response: `{ "upload_url": "https://...", "remote_key": "screenshots/2026/04/01/scr_....jpg" }`

### `POST /api/v1/screenshots/confirm`
Confirm a screenshot was uploaded.

```json
{ "screenshot_id": "scr_...", "remote_key": "screenshots/..." }
```

---

## Project Structure

```
process-tracker/
├── chrome-extension/
│   ├── manifest.json          Manifest V3
│   ├── background.js          Service worker: tab tracking, event buffer, API upload
│   ├── content.js             Click listener + SPA nav detection
│   ├── popup.html / popup.js  Status popup
│   └── icons/                 Extension icons (16, 48, 128px)
│
├── desktop-agent/
│   ├── main.js                Electron entry point
│   ├── settings.js            Settings persistence (JSON file)
│   ├── tray.js                Menu bar icon + dropdown
│   ├── preload.js             IPC bridge for settings window
│   ├── tracker/
│   │   ├── window-tracker.js  Active window polling (active-win)
│   │   ├── click-detector.js  Global mouse hooks (uiohook-napi)
│   │   ├── screenshot.js      Capture + compress + annotate (sharp)
│   │   ├── idle-detector.js   Idle detection (powerMonitor)
│   │   └── session.js         Session boundary management
│   ├── storage/
│   │   ├── database.js        SQLite via better-sqlite3
│   │   └── migrations/        001_initial.sql
│   ├── upload/
│   │   ├── queue.js           Retry queue with exponential backoff
│   │   ├── event-uploader.js  Batch event upload
│   │   └── screenshot-uploader.js  Pre-signed URL upload flow
│   ├── websocket/
│   │   └── extension-bridge.js  WebSocket server (port 47832)
│   ├── privacy/
│   │   ├── filter.js          App blocklist, password screen detection
│   │   └── activity-log.js    Human-readable local log
│   ├── ui/
│   │   ├── settings.html      Settings window
│   │   └── settings.js        Settings window renderer
│   └── native/
│       └── click-tap.swift    Reference Swift CGEventTap implementation
│
└── api-server/
    ├── server.js              Express entry point
    ├── middleware/auth.js     API key authentication
    ├── routes/
    │   ├── events.js          POST /api/v1/events
    │   └── screenshots.js     POST /api/v1/screenshots/upload-url + confirm
    └── storage/
        ├── postgres.js        PostgreSQL pool + schema init
        └── r2.js              Cloudflare R2 pre-signed URLs
```

---

## Privacy Controls

- **App blocklist**: 1Password, Keychain Access, System Settings, FaceTime, Messages, and Photos are blocked by default. Users can add more in Settings.
- **Password screen detection**: Window titles matching password/login patterns skip screenshots automatically.
- **Browser deference**: The desktop agent skips all browser window tracking when the Chrome extension is connected.
- **Local activity log**: Every tracked action is written to `~/Library/Application Support/ProcessTracker/activity.log` in a human-readable format. Employees can open this at any time.
- **No keystroke logging**: The extension captures button labels and page context only — never raw text input from text fields, `textarea`, or `contenteditable`.

---

## Screenshot Pipeline

1. Capture full screen → `screenshot-desktop`
2. Resize to 1280×720 → `sharp`
3. Compress to JPEG at configured quality (30–80%)
4. For click screenshots: overlay 8px red dot at click coordinates (scaled for Retina)
5. Save locally to `~/Library/Application Support/ProcessTracker/screenshots/`
6. Queue for upload to R2 via pre-signed URL
7. Delete local file 24 hours after confirmed upload

---

## Native Click Detection

Primary: **uiohook-napi** — a cross-platform npm package using native hooks.  
Fallback: `native/click-tap.swift` — a reference Swift CGEventTap implementation.

The Swift file can be compiled to a dylib and loaded via `ffi-napi` if uiohook-napi is incompatible with your Electron version.

---

## Build Order (for contributors)

1. Chrome extension — load unpacked, verify events log to console
2. API server — `POST /api/v1/events`, verify DB insertion
3. Connect extension to API — events flowing from browser to DB
4. Desktop agent window tracking — switch apps, verify SQLite events
5. WebSocket bridge — verify extension connected flag, browser windows skipped
6. Screenshot on window switch — verify JPEG files in screenshots dir
7. Click detection + click screenshots — red dot overlay
8. Idle detection + session boundaries
9. Menu bar UI + settings window
10. Upload retry, auto-start at login, local file cleanup
