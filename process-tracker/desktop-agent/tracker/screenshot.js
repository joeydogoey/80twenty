'use strict';

const path = require('path');
const fs = require('fs');
const { insertScreenshot } = require('../storage/database');
const { shouldSkipScreenshot } = require('../privacy/filter');
const { logActivity } = require('../privacy/activity-log');
const { getCurrentWindow } = require('./window-tracker');

let screenshotsDir = null;
let screenshotQuality = 50;
let lastScreenshotTime = 0;
const MIN_SCREENSHOT_INTERVAL_MS = 3000; // Throttle: no more than 1 screenshot per 3s

// Periodic screenshot if no screenshot taken in 2 minutes
const PERIODIC_INTERVAL_MS = 2 * 60 * 1000;
let periodicTimer = null;

/**
 * Initialize screenshot module.
 * @param {string} userDataPath - Electron app.getPath('userData')
 * @param {{ quality?: number }} options
 */
function initScreenshots(userDataPath, { quality = 50 } = {}) {
  screenshotsDir = path.join(userDataPath, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  screenshotQuality = quality;

  // Start periodic screenshot timer
  resetPeriodicTimer();

  console.log(`[screenshot] Initialized. Screenshots dir: ${screenshotsDir}`);
}

function setQuality(quality) {
  screenshotQuality = Math.max(30, Math.min(80, quality));
}

function resetPeriodicTimer() {
  if (periodicTimer) clearTimeout(periodicTimer);
  periodicTimer = setTimeout(async () => {
    await captureScreenshot({ trigger: 'periodic' });
  }, PERIODIC_INTERVAL_MS);
}

/**
 * Capture a screenshot.
 * @param {{ trigger: 'click'|'window_switch'|'periodic', clickX?: number, clickY?: number, screenWidth?: number, screenHeight?: number }} opts
 * @returns {Promise<string|null>} screenshot ID, or null if skipped/failed
 */
async function captureScreenshot({ trigger = 'periodic', clickX, clickY, screenWidth, screenHeight } = {}) {
  if (!screenshotsDir) {
    console.warn('[screenshot] Not initialized');
    return null;
  }

  // Throttle rapid screenshots
  if (Date.now() - lastScreenshotTime < MIN_SCREENSHOT_INTERVAL_MS && trigger !== 'periodic') {
    return null;
  }

  // Get current window context
  const { appName, title } = getCurrentWindow();

  // Privacy check
  if (shouldSkipScreenshot(appName, title)) {
    console.log(`[screenshot] Skipping sensitive window: ${appName}`);
    return null;
  }

  const now = new Date();
  const screenshotId = generateScreenshotId(now);
  const localPath = path.join(screenshotsDir, `${screenshotId}.jpg`);

  try {
    const screenshotDesktop = require('screenshot-desktop');
    const sharp = require('sharp');

    // Capture full screen
    const imgBuffer = await screenshotDesktop({ format: 'png' });

    // Get image dimensions for coordinate scaling
    const metadata = await sharp(imgBuffer).metadata();
    const imgWidth = metadata.width || 1920;
    const imgHeight = metadata.height || 1080;

    // Target output dimensions
    const outWidth = 1280;
    const outHeight = 720;

    // Resize first to a buffer so we know the ACTUAL output dimensions.
    // fit:'inside' preserves aspect ratio, so the result may not be exactly
    // outWidth x outHeight — we must match the SVG overlay to the real size.
    const { data: resizedBuffer, info: resizeInfo } = await sharp(imgBuffer)
      .resize(outWidth, outHeight, { fit: 'inside', withoutEnlargement: false })
      .toBuffer({ resolveWithObject: true });

    const actualWidth = resizeInfo.width;
    const actualHeight = resizeInfo.height;

    let pipeline = sharp(resizedBuffer);

    // Draw red dot for click-triggered screenshots
    if (trigger === 'click' && clickX != null && clickY != null) {
      // clickX/clickY are in logical (CSS) pixels; imgWidth/imgHeight are physical pixels
      const scaleX = imgWidth / (screenWidth || imgWidth);
      const scaleY = imgHeight / (screenHeight || imgHeight);

      const physX = clickX * scaleX;
      const physY = clickY * scaleY;

      // Scale to actual resized output dimensions
      const scaledX = Math.round((physX / imgWidth) * actualWidth);
      const scaledY = Math.round((physY / imgHeight) * actualHeight);

      // SVG must match actual output dimensions exactly
      const dotSvg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${actualWidth}" height="${actualHeight}">
          <circle cx="${scaledX}" cy="${scaledY}" r="8" fill="red" fill-opacity="0.85"/>
          <circle cx="${scaledX}" cy="${scaledY}" r="12" fill="none" stroke="red" stroke-width="2" stroke-opacity="0.5"/>
        </svg>`
      );

      pipeline = sharp(resizedBuffer).composite([{ input: dotSvg, top: 0, left: 0 }]);
    }

    await pipeline.jpeg({ quality: screenshotQuality }).toFile(localPath);

    const { size: fileSizeBytes } = fs.statSync(localPath);

    // Save to DB
    insertScreenshot({
      id: screenshotId,
      timestamp: now.toISOString(),
      trigger_type: trigger,
      app_name: appName,
      window_title: title,
      click_x: clickX != null ? clickX : null,
      click_y: clickY != null ? clickY : null,
      local_path: localPath,
      file_size_bytes: fileSizeBytes,
    });

    lastScreenshotTime = Date.now();
    resetPeriodicTimer();

    logActivity(appName, title, `screenshot taken (${trigger})`);
    console.log(`[screenshot] Captured ${screenshotId} [${trigger}] ${fileSizeBytes} bytes`);

    return screenshotId;
  } catch (err) {
    console.error('[screenshot] Capture failed:', err.message);
    if (err.message && err.message.includes('screen recording')) {
      console.error('[screenshot] *** Screen Recording permission required ***');
    }
    return null;
  }
}

function generateScreenshotId(date) {
  const d = date.toISOString().replace(/[-:T.Z]/g, '').slice(0, 15);
  const rand = Math.random().toString(36).slice(2, 8);
  return `scr_${d}_${rand}`;
}

function stopScreenshots() {
  if (periodicTimer) {
    clearTimeout(periodicTimer);
    periodicTimer = null;
  }
}

module.exports = { initScreenshots, captureScreenshot, setQuality, stopScreenshots };
