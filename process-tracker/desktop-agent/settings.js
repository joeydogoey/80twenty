'use strict';

const path = require('path');
const fs = require('fs');

const DEFAULTS = {
  apiBase: '',
  authToken: '',
  deviceId: '',
  employeeId: '',
  companyId: '',
  screenshotQuality: 50,
  showNotificationOnScreenshot: false,
  startAtLogin: false,
  blockedApps: [],
  dashboardUrl: '',
};

let settingsPath = null;
let cached = null;

function initSettings(userDataPath) {
  settingsPath = path.join(userDataPath, 'settings.json');
  cached = null; // Force reload
}

function loadSettings() {
  if (!settingsPath) {
    return { ...DEFAULTS };
  }

  if (cached) return cached;

  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      cached = { ...DEFAULTS, ...JSON.parse(raw) };
    } else {
      cached = { ...DEFAULTS };
    }
  } catch (_) {
    cached = { ...DEFAULTS };
  }

  // Generate a device ID if not set
  if (!cached.deviceId) {
    cached.deviceId = `desktop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    saveSettings(cached);
  }

  return cached;
}

function saveSettings(newSettings) {
  cached = { ...DEFAULTS, ...newSettings };

  if (!settingsPath) return;

  try {
    fs.writeFileSync(settingsPath, JSON.stringify(cached, null, 2), 'utf8');
  } catch (err) {
    console.error('[settings] Failed to save:', err.message);
  }
}

function getSetting(key) {
  return loadSettings()[key];
}

module.exports = { initSettings, loadSettings, saveSettings, getSetting };
