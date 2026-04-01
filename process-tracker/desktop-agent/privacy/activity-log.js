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
 * Format: [HH:MM:SS] AppName — "Window Title" (note)
 * @param {string} appName
 * @param {string} windowTitle
 * @param {string} [note]  - e.g. "screenshot taken", "window change", "click"
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

    const notePart = note ? ` (${note})` : '';
    const title = windowTitle ? ` — "${windowTitle}"` : '';
    const line = `[${time}] ${appName}${title}${notePart}\n`;

    fs.appendFileSync(logPath, line, 'utf8');
  } catch (err) {
    // Don't crash the app if logging fails
    console.warn('[activity-log] Failed to write:', err.message);
  }
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
