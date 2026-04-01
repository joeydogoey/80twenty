'use strict';

// Preload script — exposes a safe, narrow IPC bridge to renderer windows.
// contextIsolation: true ensures renderer cannot access Node.js directly.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tracker', {
  // ── Settings window ────────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getStats: () => ipcRenderer.invoke('get-stats'),
  openActivityLog: () => ipcRenderer.invoke('open-activity-log'),

  // ── Dashboard ──────────────────────────────────────────────────────────────
  /** Get screenshots, optionally filtered by date */
  getScreenshots: (opts) => ipcRenderer.invoke('dashboard-get-screenshots', opts),

  /** Get events, optionally filtered by date / appName / eventType */
  getEvents: (opts) => ipcRenderer.invoke('dashboard-get-events', opts),

  /** Get a screenshot as a base64 data URL for display */
  getScreenshotImage: (screenshotId) => ipcRenderer.invoke('dashboard-get-screenshot-image', screenshotId),

  /** Get list of distinct app names seen */
  getDistinctApps: () => ipcRenderer.invoke('dashboard-get-distinct-apps'),

  /** Get list of dates that have recorded events */
  getAvailableDates: () => ipcRenderer.invoke('dashboard-get-available-dates'),

  /** Get active time per app for a given date (YYYY-MM-DD) */
  getAppTimeSummary: (date) => ipcRenderer.invoke('dashboard-get-app-summary', date),

  /** Get workflow sequences (grouped app chains) for a given date */
  getWorkflowSequences: (date) => ipcRenderer.invoke('dashboard-get-workflow-sequences', date),
});
