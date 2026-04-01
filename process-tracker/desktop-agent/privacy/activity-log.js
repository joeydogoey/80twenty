'use strict';

const fs = require('fs');
const path = require('path');

const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

let logPath = null;

/**
 * Initialize the activity log at the given file path.
 * @param {string} userDataPath
 */
function initActivityLog(userDataPath) {
  logPath = path.join(userDataPath, 'activity.log');
}

/**
 * Append a human-readable entry to the activity log.
 *
 * When called with a transition context object (from window-tracker on switch):
 *   logActivity(toApp, toTitle, { fromApp, fromTitle, activeSeconds })
 *   → [10:04:12] Google Chrome → Figma  "Tech Pack SC-4521"  (active 12m 30s)
 *
 * When called with a plain string note (screenshots, clicks, etc.):
 *   logActivity(appName, windowTitle, 'screenshot taken')
 *   → [10:04:12] Figma — "Tech Pack SC-4521"  (screenshot taken)
 *
 * @param {string} appName
 * @param {string} windowTitle
 * @param {string|{fromApp?:string, fromTitle?:string, activeSeconds?:number}} [note]
 */
function logActivity(appName, windowTitle, note) {
  if (!logPath) return;

  try {
    // Rotate log if > 10MB
    if (fs.existsSync(logPath)) {
      const { size } = fs.statSync(logPath);
      if (size > MAX_LOG_SIZE_BYTES) {
        const rotatedPath = logPath.replace('.log', `-${Date.now()}.log`);
        fs.renameSync(logPath, rotatedPath);
      }
    }

    const now = new Date();
    const time = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    let line;
    if (note && typeof note === 'object') {
      // Rich transition log: FromApp → ToApp "Title" (active Xm Ys)
      const { fromApp, activeSeconds } = note;
      const from = fromApp ? `${fromApp} → ` : '';
      const titlePart = windowTitle ? `  "${windowTitle}"` : '';
      const activePart = activeSeconds != null ? `  (active ${fmtDuration(activeSeconds)})` : '';
      line = `[${time}] ${from}${appName}${titlePart}${activePart}\n`;
    } else {
      const notePart = note ? ` (${note})` : '';
      const titlePart = windowTitle ? ` — "${windowTitle}"` : '';
      line = `[${time}] ${appName}${titlePart}${notePart}\n`;
    }

    fs.appendFileSync(logPath, line, 'utf8');
  } catch (err) {
    // Don't crash the app if logging fails
    console.warn('[activity-log] Failed to write:', err.message);
  }
}

function fmtDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Write a system event to the log (session start/end, idle, etc.)
 * @param {string} message
 */
function logSystem(message) {
  if (!logPath) return;
  try {
    const now = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    fs.appendFileSync(logPath, `[${now}] *** ${message} ***\n`, 'utf8');
  } catch (_) {}
}

/**
 * Returns the path to the activity log file.
 */
function getLogPath() {
  return logPath;
}

module.exports = { initActivityLog, logActivity, logSystem, getLogPath };
