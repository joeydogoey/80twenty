'use strict';

const { insertEvent } = require('../storage/database');
const { isExtensionConnected } = require('../websocket/extension-bridge');
const { isBrowser, shouldSkip } = require('../privacy/filter');
const { logActivity } = require('../privacy/activity-log');

const POLL_INTERVAL_MS = 2000;

let currentApp = null;
let currentTitle = null;
let windowStartTime = null;
let pollInterval = null;
let isPaused = false;
let onWindowChangeCallback = null;

// active-win v7 is CJS; dynamic import handles both v7 (CJS) and v8+ (ESM)
let activeWin;
async function loadActiveWin() {
  if (activeWin) return activeWin;
  try {
    // Try CJS require (v7)
    activeWin = require('active-win');
    // active-win v7 exports a function directly
    if (typeof activeWin !== 'function') {
      activeWin = activeWin.default || activeWin;
    }
  } catch (_) {
    // Fallback to ESM dynamic import (v8+)
    const mod = await import('active-win');
    activeWin = mod.default || mod.activeWin;
  }
  return activeWin;
}

/**
 * Start polling for active window changes.
 * @param {{ onWindowChange?: Function }} options
 */
async function startWindowTracker({ onWindowChange } = {}) {
  onWindowChangeCallback = onWindowChange || null;
  await loadActiveWin();

  pollInterval = setInterval(pollActiveWindow, POLL_INTERVAL_MS);
  console.log('[window-tracker] Started polling every 2s');
}

async function pollActiveWindow() {
  if (isPaused) return;

  let win;
  try {
    win = await activeWin();
  } catch (err) {
    // active-win throws if Screen Recording permission is not granted
    console.warn('[window-tracker] active-win error (check Screen Recording permission):', err.message);
    return;
  }

  if (!win) return;

  const appName = win.owner?.name || 'Unknown';
  const title = win.title || '';

  // Skip browsers when extension is connected (extension handles it)
  if (isBrowser(appName) && isExtensionConnected()) return;

  // Skip blocked/sensitive apps
  if (shouldSkip(appName, title)) return;

  // Only emit on change
  const hasChanged = appName !== currentApp || title !== currentTitle;
  if (!hasChanged) return;

  const now = Date.now();
  const nowIso = new Date().toISOString();

  let durationOnPreviousSeconds = 0;
  if (currentApp && windowStartTime) {
    durationOnPreviousSeconds = Math.round((now - windowStartTime) / 1000);
  }

  const event = {
    event_type: 'window_change',
    timestamp: nowIso,
    source: 'desktop_agent',
    payload: {
      event_type: 'window_change',
      timestamp: nowIso,
      source: 'desktop_agent',
      app_name: appName,
      window_title: title,
      bundle_id: win.owner?.bundleId || '',
      duration_on_previous_seconds: durationOnPreviousSeconds,
    },
  };

  insertEvent(event);
  logActivity(appName, title, 'window change');

  if (onWindowChangeCallback) {
    onWindowChangeCallback({ appName, title, bundleId: win.owner?.bundleId });
  }

  currentApp = appName;
  currentTitle = title;
  windowStartTime = now;
}

function pauseTracking() {
  isPaused = true;
  console.log('[window-tracker] Paused');
}

function resumeTracking() {
  isPaused = false;
  console.log('[window-tracker] Resumed');
}

function stopWindowTracker() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function getCurrentWindow() {
  return { appName: currentApp, title: currentTitle };
}

module.exports = {
  startWindowTracker,
  stopWindowTracker,
  pauseTracking,
  resumeTracking,
  getCurrentWindow,
};
