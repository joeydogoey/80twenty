'use strict';

const { Tray, Menu, nativeImage, app, shell, BrowserWindow } = require('electron');
const path = require('path');
const { getStats } = require('./storage/database');
const { loadSettings } = require('./settings');

// Tray icon states
const ICON_STATES = {
  active:    'icon-active.png',
  paused:    'icon-paused.png',
  uploading: 'icon-uploading.png',
  error:     'icon-error.png',
};

let tray = null;
let currentState = 'active';
let isPaused = false;
let onPauseChangeCallback = null;
let settingsWindow = null;
let pendingUpdateVersion = null;

/**
 * Create the menu bar tray icon and menu.
 * @param {{ onPauseChange?: Function }} options
 */
function setupTray({ onPauseChange } = {}) {
  onPauseChangeCallback = onPauseChange || null;

  const iconPath = getIconPath('active');
  const icon = nativeImage.createFromPath(iconPath);

  // On macOS, use template image for proper dark/light mode adaptation
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  tray.setToolTip('Process Tracker');

  updateTrayMenu();

  console.log('[tray] Tray icon created');
  return tray;
}

function updateTrayMenu() {
  if (!tray) return;

  let stats = { eventsToday: 0, screenshotsToday: 0, eventsPending: 0 };
  try {
    stats = getStats();
  } catch (_) {}

  const statusLabel = isPaused ? '⏸  Tracking Paused' : '✅ Tracking Active';

  const template = [
    { label: statusLabel, enabled: false },
    {
      label: `Today: ${stats.eventsToday.toLocaleString()} events | ${stats.screenshotsToday.toLocaleString()} screenshots`,
      enabled: false,
    },
    { type: 'separator' },
    ...(pendingUpdateVersion ? [
      {
        label: `🆕 Restart to install v${pendingUpdateVersion}`,
        click: () => { const { installUpdate } = require('./updater'); installUpdate(); },
      },
      { type: 'separator' },
    ] : []),
    {
      label: isPaused ? '▶  Resume Tracking' : '⏸  Pause Tracking',
      click: togglePause,
    },
    {
      label: '📊 Open Dashboard',
      click: openDashboard,
    },
    {
      label: '📋 View Activity Log',
      click: openActivityLog,
    },
    {
      label: '🔄 Check for Updates',
      click: () => { const { checkForUpdates } = require('./updater'); checkForUpdates(); },
    },
    {
      label: '⚙  Settings',
      click: openSettings,
    },
    { type: 'separator' },
    {
      label: 'Quit Process Tracker',
      click: () => app.quit(),
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  tray.setContextMenu(menu);
}

function setTrayState(state) {
  currentState = state;
  if (!tray) return;

  const iconPath = getIconPath(state);
  const icon = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray.setImage(icon);

  updateTrayMenu();
}

function togglePause() {
  isPaused = !isPaused;
  setTrayState(isPaused ? 'paused' : 'active');
  if (onPauseChangeCallback) onPauseChangeCallback(isPaused);
  console.log(`[tray] Tracking ${isPaused ? 'paused' : 'resumed'}`);
}

function openDashboard() {
  // Open the local Electron dashboard window
  try {
    const { openDashboardWindow } = require('./main');
    openDashboardWindow();
  } catch (err) {
    console.error('[tray] Failed to open dashboard:', err.message);
    // Fallback: open external URL if configured
    const settings = loadSettings();
    const url = settings.dashboardUrl;
    if (url && url.startsWith('http')) shell.openExternal(url);
  }
}

function openActivityLog() {
  const { getLogPath } = require('./privacy/activity-log');
  const logPath = getLogPath();
  if (logPath) {
    shell.openPath(logPath);
  }
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 620,
    title: 'Process Tracker Settings',
    resizable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'ui', 'settings.html'));
  settingsWindow.setMenu(null);

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function getIconPath(state) {
  const iconDir = path.join(__dirname, 'icons');
  return path.join(iconDir, ICON_STATES[state] || ICON_STATES.active);
}

function isPausedState() {
  return isPaused;
}

// Refresh the menu every 60 seconds to update stats
setInterval(updateTrayMenu, 60 * 1000);

/**
 * Called when an update has been downloaded and is ready to install.
 * Adds a "Restart to install" item to the tray menu.
 */
function setUpdateReady(version) {
  pendingUpdateVersion = version;
  updateTrayMenu();
}

module.exports = { setupTray, setTrayState, updateTrayMenu, isPausedState, setUpdateReady };
