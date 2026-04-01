'use strict';

// Preload script — exposes a safe, narrow IPC bridge to the settings window renderer.
// contextIsolation: true ensures renderer cannot access Node.js directly.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tracker', {
  /** Load current settings */
  getSettings: () => ipcRenderer.invoke('get-settings'),

  /** Save settings */
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  /** Get current stats (events, screenshots, upload status) */
  getStats: () => ipcRenderer.invoke('get-stats'),

  /** Reveal the activity log file in Finder */
  openActivityLog: () => ipcRenderer.invoke('open-activity-log'),
});
