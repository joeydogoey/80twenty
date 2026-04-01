'use strict';

const { insertEvent } = require('../storage/database');
const { isExtensionConnected } = require('../websocket/extension-bridge');
const { isBrowser, shouldSkipScreenshot } = require('../privacy/filter');
const { captureScreenshot } = require('./screenshot');
const { getCurrentWindow } = require('./window-tracker');
const { getSessionId } = require('./session');

let uIOhook;
let isPaused = false;
let onClickCallback = null;

/**
 * Start global mouse click detection using uiohook-napi.
 * Requires macOS Accessibility permission.
 *
 * @param {{ onDesktopClick?: Function }} options
 */
function startClickDetector({ onDesktopClick } = {}) {
  onClickCallback = onDesktopClick || null;

  try {
    uIOhook = require('uiohook-napi').uIOhook;
  } catch (err) {
    console.error('[click-detector] Failed to load uiohook-napi:', err.message);
    console.error('[click-detector] Global click detection is disabled.');
    console.error('[click-detector] Install uiohook-napi and grant Accessibility permission.');
    return;
  }

  uIOhook.on('mousedown', handleMouseDown);

  uIOhook.start();
  console.log('[click-detector] Global mouse hook started');
}

async function handleMouseDown(event) {
  if (isPaused) return;

  // Only care about primary (left) button clicks
  if (event.button !== 1) return;

  const { appName, title } = getCurrentWindow();

  // Skip if active app is a browser and the Chrome extension is connected
  if (isBrowser(appName) && isExtensionConnected()) return;

  const nowIso = new Date().toISOString();
  const clickX = event.x;
  const clickY = event.y;

  // Determine screen dimensions for coordinate scaling in screenshot
  let screenWidth, screenHeight;
  try {
    const { screen } = require('electron');
    const primaryDisplay = screen.getPrimaryDisplay();
    // scaleFactor accounts for Retina displays
    const scaleFactor = primaryDisplay.scaleFactor || 1;
    // event.x/y from uiohook are in logical pixels; screenshot is in physical pixels
    screenWidth = primaryDisplay.workArea.width * scaleFactor;
    screenHeight = primaryDisplay.workArea.height * scaleFactor;
  } catch (_) {}

  // Capture screenshot with red dot (skip if sensitive)
  let screenshotId = null;
  if (!shouldSkipScreenshot(appName, title)) {
    screenshotId = await captureScreenshot({
      trigger: 'click',
      clickX,
      clickY,
      screenWidth,
      screenHeight,
    });
  }

  // Emit desktop_click event
  const payload = {
    event_type: 'desktop_click',
    timestamp: nowIso,
    source: 'desktop_agent',
    app_name: appName,
    window_title: title,
    click_x: clickX,
    click_y: clickY,
    screenshot_id: screenshotId,
    session_id: getSessionId(),
  };

  insertEvent({
    event_type: 'desktop_click',
    timestamp: nowIso,
    source: 'desktop_agent',
    payload,
    screenshot_id: screenshotId,
  });

  if (onClickCallback) {
    onClickCallback(payload);
  }
}

function pauseClickDetector() {
  isPaused = true;
}

function resumeClickDetector() {
  isPaused = false;
}

function stopClickDetector() {
  if (uIOhook) {
    try {
      uIOhook.stop();
    } catch (_) {}
  }
}

module.exports = {
  startClickDetector,
  stopClickDetector,
  pauseClickDetector,
  resumeClickDetector,
};
