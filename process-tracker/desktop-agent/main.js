'use strict';

const { app, ipcMain, shell, Notification, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// ── Single instance lock ──────────────────────────────────────────────────────
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log('[main] Another instance is already running. Quitting.');
  app.quit();
  process.exit(0);
}

// ── Module imports (after lock check) ────────────────────────────────────────
const {
  initDatabase, getStats,
  getDashboardScreenshots, getDashboardEvents,
  getDistinctApps, getAvailableDates,
  getAppTimeSummary, getWorkflowSequences,
} = require('./storage/database');
const { initAutoUpdater, checkForUpdates, installUpdate } = require('./updater');
const { initSettings, loadSettings, saveSettings } = require('./settings');
const { initActivityLog, logSystem, getLogPath } = require('./privacy/activity-log');
const { setUserBlocklist } = require('./privacy/filter');
const { setupTray, setTrayState, isPausedState, setUpdateReady } = require('./tray');
const { startWebSocketServer } = require('./websocket/extension-bridge');
const { startWindowTracker, stopWindowTracker, pauseTracking, resumeTracking } = require('./tracker/window-tracker');
const { startClickDetector, stopClickDetector, pauseClickDetector, resumeClickDetector } = require('./tracker/click-detector');
const { initScreenshots, captureScreenshot, setQuality } = require('./tracker/screenshot');
const { startIdleDetector, stopIdleDetector } = require('./tracker/idle-detector');
const { startSession, endSession } = require('./tracker/session');
const { startEventUploader, stopEventUploader, flushEvents } = require('./upload/event-uploader');
const { startScreenshotUploader, stopScreenshotUploader } = require('./upload/screenshot-uploader');

// ── App ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(initialize).catch((err) => {
  console.error('[main] Fatal initialization error:', err);
  app.quit();
});

async function initialize() {
  // macOS: hide from Dock — this is a menu bar only app
  if (app.dock) app.dock.hide();

  const userDataPath = app.getPath('userData');
  console.log(`[main] User data path: ${userDataPath}`);

  // ── Settings ──────────────────────────────────────────────────────────────
  initSettings(userDataPath);
  const settings = loadSettings();

  // ── Activity log ─────────────────────────────────────────────────────────
  initActivityLog(userDataPath);
  logSystem('Process Tracker starting up');

  // ── Database ──────────────────────────────────────────────────────────────
  initDatabase(userDataPath);

  // ── Privacy filter ────────────────────────────────────────────────────────
  setUserBlocklist(settings.blockedApps || []);

  // ── Screenshots ───────────────────────────────────────────────────────────
  initScreenshots(userDataPath, { quality: settings.screenshotQuality });

  // ── Tray icon ─────────────────────────────────────────────────────────────
  setupTray({
    onPauseChange: handlePauseChange,
  });

  // ── WebSocket bridge (Chrome extension coordination) ─────────────────────
  startWebSocketServer((connected) => {
    console.log(`[main] Extension ${connected ? 'connected' : 'disconnected'}`);
    setTrayState(connected ? 'active' : 'active');
  });

  // ── Window tracker ────────────────────────────────────────────────────────
  await startWindowTracker({
    onWindowChange: ({ appName, title }) => {
      // Take screenshot when switching to a new non-browser window
      captureScreenshot({ trigger: 'window_switch' });
    },
  });

  // ── Click detector ────────────────────────────────────────────────────────
  startClickDetector();

  // ── Idle detector ─────────────────────────────────────────────────────────
  startIdleDetector({
    onIdleChange: ({ idle }) => {
      if (idle) {
        setTrayState('paused');
      } else {
        setTrayState(isPausedState() ? 'paused' : 'active');
      }
    },
  });

  // ── Session ───────────────────────────────────────────────────────────────
  startSession();

  // ── Upload queues ─────────────────────────────────────────────────────────
  startEventUploader({
    onAlert: (msg) => {
      console.error('[main] Upload alert:', msg);
      setTrayState('error');
      if (Notification.isSupported()) {
        new Notification({
          title: 'Process Tracker — Upload Error',
          body: msg,
        }).show();
      }
    },
  });

  startScreenshotUploader({
    onAlert: (msg) => {
      console.error('[main] Screenshot upload alert:', msg);
      setTrayState('error');
    },
  });

  // ── Auto-updater ──────────────────────────────────────────────────────────
  initAutoUpdater({
    onUpdateReady: (version) => {
      // Tell the tray to show a "Restart to Update" item
      setUpdateReady(version);
    },
  });

  // ── macOS: auto-start at login ────────────────────────────────────────────
  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: settings.startAtLogin || false });
  }

  // ── Login item check on permission ────────────────────────────────────────
  checkMacOSPermissions();

  logSystem('Startup complete — tracking active');
  console.log('[main] Process Tracker initialized successfully');
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-settings', () => loadSettings());

ipcMain.handle('save-settings', (event, newSettings) => {
  saveSettings(newSettings);

  // Apply relevant settings immediately
  const settings = loadSettings();
  setUserBlocklist(settings.blockedApps || []);
  setQuality(settings.screenshotQuality || 50);

  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: settings.startAtLogin || false });
  }

  return { ok: true };
});

ipcMain.handle('get-stats', () => {
  try {
    return getStats();
  } catch (_) {
    return {};
  }
});

ipcMain.handle('open-activity-log', () => {
  const logPath = getLogPath();
  if (logPath) shell.openPath(logPath);
});

// ── Dashboard IPC ─────────────────────────────────────────────────────────────

ipcMain.handle('dashboard-get-screenshots', (event, opts = {}) => {
  try {
    return getDashboardScreenshots(opts);
  } catch (_) { return []; }
});

ipcMain.handle('dashboard-get-events', (event, opts = {}) => {
  try {
    return getDashboardEvents(opts);
  } catch (_) { return []; }
});

ipcMain.handle('dashboard-get-screenshot-image', (event, screenshotId) => {
  try {
    const screenshots = getDashboardScreenshots({ limit: 1000 });
    const screenshot = screenshots.find(s => s.id === screenshotId);
    if (!screenshot || !screenshot.local_path) return null;
    if (!fs.existsSync(screenshot.local_path)) return null;
    const data = fs.readFileSync(screenshot.local_path);
    return `data:image/jpeg;base64,${data.toString('base64')}`;
  } catch (_) { return null; }
});

ipcMain.handle('dashboard-get-distinct-apps', () => {
  try { return getDistinctApps(); } catch (_) { return []; }
});

ipcMain.handle('dashboard-get-available-dates', () => {
  try { return getAvailableDates(); } catch (_) { return []; }
});

ipcMain.handle('dashboard-get-app-summary', (_, date) => {
  try { return getAppTimeSummary(date || new Date().toISOString().slice(0, 10)); } catch (_) { return []; }
});

ipcMain.handle('dashboard-get-workflow-sequences', (_, date) => {
  try { return getWorkflowSequences(date || new Date().toISOString().slice(0, 10)); } catch (_) { return []; }
});

// ── Dashboard window ──────────────────────────────────────────────────────────

let dashboardWindow = null;

function openDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.focus();
    return;
  }

  dashboardWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Process Tracker — Dashboard',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  dashboardWindow.loadFile(path.join(__dirname, 'ui', 'dashboard.html'));
  dashboardWindow.setMenu(null);

  dashboardWindow.on('closed', () => { dashboardWindow = null; });
}

// Expose so tray.js can call it
module.exports = { openDashboardWindow };

// ── Pause/resume ──────────────────────────────────────────────────────────────

function handlePauseChange(paused) {
  if (paused) {
    pauseTracking();
    pauseClickDetector();
    logSystem('Tracking paused by user');
  } else {
    resumeTracking();
    resumeClickDetector();
    logSystem('Tracking resumed by user');
  }
}

// ── App quit ──────────────────────────────────────────────────────────────────

app.on('before-quit', async () => {
  console.log('[main] App quitting — flushing events...');
  logSystem('Process Tracker shutting down');

  endSession('app_quit');
  stopWindowTracker();
  stopClickDetector();
  stopIdleDetector();

  try {
    await flushEvents();
  } catch (err) {
    console.error('[main] Error flushing events on quit:', err.message);
  }

  stopEventUploader();
  stopScreenshotUploader();
});

// Prevent app from quitting when all windows are closed (menu bar app behavior)
app.on('window-all-closed', () => {
  // Do nothing — keep running as menu bar app
});

// ── macOS permission checks ───────────────────────────────────────────────────

function checkMacOSPermissions() {
  if (process.platform !== 'darwin') return;

  try {
    const { systemPreferences } = require('electron');

    const screenStatus = systemPreferences.getMediaAccessStatus('screen');
    if (screenStatus !== 'granted') {
      console.warn('[main] Screen Recording permission not granted. Screenshots will fail.');
      console.warn('[main] Go to: System Settings → Privacy & Security → Screen Recording');
    }
  } catch (err) {
    console.warn('[main] Could not check permissions:', err.message);
  }
}
