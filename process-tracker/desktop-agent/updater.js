'use strict';

// Auto-updater — checks GitHub Releases for new versions of the app.
// Uses electron-updater which integrates with electron-builder's publish config.
//
// Flow:
//   1. On startup (after 10s delay): check GitHub for a newer version
//   2. If found: download silently in background
//   3. When downloaded: show a tray notification prompting to restart
//   4. Also checks every 4 hours while running
//   5. User can trigger a manual check from tray menu

const { autoUpdater } = require('electron-updater');
const { Notification, app } = require('electron');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_DELAY_MS  = 10 * 1000;           // 10 seconds after launch

let onUpdateReadyCallback = null;
let checkInterval = null;

/**
 * Initialize the auto-updater.
 * @param {{ onUpdateReady?: Function }} options
 *   onUpdateReady is called when an update is downloaded and ready to install.
 */
function initAutoUpdater({ onUpdateReady } = {}) {
  // Skip auto-update in dev mode (running from source with `npm start`)
  if (!app.isPackaged) {
    console.log('[updater] Running in dev mode — auto-update disabled');
    return;
  }

  onUpdateReadyCallback = onUpdateReady || null;

  // Don't auto-install — let the user choose when to restart
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoDownload = true;

  // ── Event handlers ──────────────────────────────────────────────────────────

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] Update available: v${info.version}`);
    if (Notification.isSupported()) {
      new Notification({
        title: 'Process Tracker Update',
        body: `v${info.version} is available — downloading in background…`,
      }).show();
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] App is up to date');
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent);
    if (pct % 25 === 0) { // Log at 0%, 25%, 50%, 75%, 100%
      console.log(`[updater] Downloading update: ${pct}%`);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] Update downloaded: v${info.version} — ready to install`);

    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'Process Tracker — Update Ready',
        body: `v${info.version} downloaded. Click to restart and install.`,
        actions: [{ type: 'button', text: 'Restart Now' }],
      });
      n.on('action', () => autoUpdater.quitAndInstall());
      n.show();
    }

    // Notify the tray so it can update the menu to show "Restart to Update"
    if (onUpdateReadyCallback) {
      onUpdateReadyCallback(info.version);
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] Update check failed:', err.message);
  });

  // ── Schedule checks ─────────────────────────────────────────────────────────

  // First check after 10s (let the app fully start first)
  setTimeout(() => checkForUpdates(), INITIAL_DELAY_MS);

  // Then every 4 hours
  checkInterval = setInterval(() => checkForUpdates(), CHECK_INTERVAL_MS);
}

/**
 * Manually trigger an update check (e.g. from tray menu).
 */
async function checkForUpdates() {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.error('[updater] checkForUpdates error:', err.message);
  }
}

/**
 * Quit the app and install the downloaded update immediately.
 */
function installUpdate() {
  autoUpdater.quitAndInstall();
}

function stopAutoUpdater() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

module.exports = { initAutoUpdater, checkForUpdates, installUpdate, stopAutoUpdater };
