// Background service worker — tab tracking, event buffering, API upload, WebSocket bridge
// Uses chrome.alarms for reliable scheduling (service workers can be terminated)

const FLUSH_ALARM = 'flush-events';
const FLUSH_INTERVAL_MINUTES = 0.5; // 30 seconds
const BUFFER_MAX = 50;
const WS_PORT = 47832;
const DEFAULT_CONFIG = {
  apiBase: 'http://localhost:3000',
  authToken: '',
  deviceId: '',
  employeeId: '',
  companyId: '',
  paused: false,
};

// ── Alarms ───────────────────────────────────────────────────────────────────

chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_INTERVAL_MINUTES });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) {
    flushEvents();
    attemptWsHeartbeat();
  }
});

// ── Tab tracking ─────────────────────────────────────────────────────────────

let previousTab = null;

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const config = await getConfig();
  if (config.paused) return;

  const newTab = await chrome.tabs.get(tabId).catch(() => null);
  if (!newTab) return;

  if (previousTab) {
    await bufferEvent({
      event_type: 'tab_switch',
      timestamp: new Date().toISOString(),
      source: 'chrome_extension',
      from_url: previousTab.url || '',
      from_title: previousTab.title || '',
      to_url: newTab.url || '',
      to_title: newTab.title || '',
    });
  }

  previousTab = newTab;
});

// Track the active tab on startup
chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  if (tab) previousTab = tab;
});

// ── Navigation tracking ───────────────────────────────────────────────────────

const recentNavigations = new Map(); // tabId → last URL (debounce)

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' && !changeInfo.url) return;

  const config = await getConfig();
  if (config.paused) return;

  const url = changeInfo.url || tab.url;
  if (!url || url === 'about:blank' || url.startsWith('chrome://')) return;

  const lastUrl = recentNavigations.get(tabId);
  if (lastUrl === url) return;
  recentNavigations.set(tabId, url);

  // Clean up map after 5s to allow re-navigation to same URL
  setTimeout(() => {
    if (recentNavigations.get(tabId) === url) recentNavigations.delete(tabId);
  }, 5000);

  let domain = '';
  let path = '';
  try {
    const parsed = new URL(url);
    domain = parsed.hostname;
    path = parsed.pathname + parsed.search;
  } catch (_) {}

  await bufferEvent({
    event_type: 'navigation',
    timestamp: new Date().toISOString(),
    source: 'chrome_extension',
    url,
    title: tab.title || '',
    domain,
    path,
  });
});

// ── Click events from content script ────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'click_event') {
    getConfig().then((config) => {
      if (!config.paused) {
        bufferEvent(message.payload).then(() => {
          maybeFlushOnSize();
        });
      }
    });
    sendResponse({ ok: true });
  }

  if (message.type === 'navigation_event') {
    getConfig().then((config) => {
      if (!config.paused) {
        bufferEvent(message.payload).then(() => {
          maybeFlushOnSize();
        });
      }
    });
    sendResponse({ ok: true });
  }

  if (message.type === 'get_stats') {
    getStats().then(sendResponse);
    return true; // async response
  }

  if (message.type === 'set_paused') {
    chrome.storage.sync.set({ paused: message.paused });
    sendResponse({ ok: true });
  }
});

// ── Event buffer ─────────────────────────────────────────────────────────────

async function bufferEvent(event) {
  const data = await chrome.storage.local.get(['eventBuffer', 'eventsTodayCount']);
  const buffer = data.eventBuffer || [];
  const count = data.eventsTodayCount || 0;

  buffer.push(event);

  // Reset daily count at midnight
  const todayKey = new Date().toDateString();
  const savedKey = data.todayKey;
  const newCount = savedKey === todayKey ? count + 1 : 1;

  await chrome.storage.local.set({
    eventBuffer: buffer,
    eventsTodayCount: newCount,
    todayKey,
  });
}

async function maybeFlushOnSize() {
  const data = await chrome.storage.local.get('eventBuffer');
  const buffer = data.eventBuffer || [];
  if (buffer.length >= BUFFER_MAX) {
    await flushEvents();
  }
}

async function flushEvents() {
  const data = await chrome.storage.local.get('eventBuffer');
  const buffer = data.eventBuffer || [];
  if (buffer.length === 0) return;

  // Optimistically clear buffer
  await chrome.storage.local.set({ eventBuffer: [] });

  const config = await getConfig();
  if (!config.apiBase || !config.authToken) return;

  if (!config.deviceId) {
    // Generate a device ID on first use
    const id = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await chrome.storage.sync.set({ deviceId: id });
    config.deviceId = id;
  }

  try {
    const res = await fetch(`${config.apiBase}/api/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.authToken,
      },
      body: JSON.stringify({
        device_id: config.deviceId,
        employee_id: config.employeeId || '',
        company_id: config.companyId || '',
        events: buffer.map((e) => ({
          event_type: e.event_type,
          timestamp: e.timestamp,
          source: e.source,
          payload: e,
        })),
      }),
    });

    if (!res.ok) {
      // Put events back in buffer on failure
      const current = await chrome.storage.local.get('eventBuffer');
      const existing = current.eventBuffer || [];
      await chrome.storage.local.set({ eventBuffer: [...buffer, ...existing] });
    } else {
      await chrome.storage.local.set({ lastUploadTime: new Date().toISOString(), uploadError: null });
    }
  } catch (err) {
    // Network failure — restore buffer
    const current = await chrome.storage.local.get('eventBuffer');
    const existing = current.eventBuffer || [];
    await chrome.storage.local.set({
      eventBuffer: [...buffer, ...existing],
      uploadError: err.message,
    });
  }
}

// ── WebSocket bridge to desktop agent ────────────────────────────────────────
// MV3 service workers can't keep persistent WebSockets.
// We attempt connection on each alarm tick (every 30s) and send a heartbeat.

let ws = null;

async function attemptWsHeartbeat() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }));
    await chrome.storage.session.set({ desktopConnected: true });
    return;
  }

  // Try to (re)connect
  try {
    ws = new WebSocket(`ws://localhost:${WS_PORT}`);

    ws.addEventListener('open', async () => {
      ws.send(JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }));
      await chrome.storage.session.set({ desktopConnected: true });
    });

    ws.addEventListener('close', async () => {
      ws = null;
      await chrome.storage.session.set({ desktopConnected: false });
    });

    ws.addEventListener('error', async () => {
      ws = null;
      await chrome.storage.session.set({ desktopConnected: false });
    });
  } catch (_) {
    await chrome.storage.session.set({ desktopConnected: false });
  }
}

// ── Config helpers ────────────────────────────────────────────────────────────

async function getConfig() {
  const data = await chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG));
  return { ...DEFAULT_CONFIG, ...data };
}

async function getStats() {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(['eventsTodayCount', 'lastUploadTime', 'uploadError', 'eventBuffer']),
    chrome.storage.session.get('desktopConnected'),
  ]);
  return {
    eventsTodayCount: local.eventsTodayCount || 0,
    bufferSize: (local.eventBuffer || []).length,
    lastUploadTime: local.lastUploadTime || null,
    uploadError: local.uploadError || null,
    desktopConnected: session.desktopConnected || false,
  };
}

// Attempt initial WS connection
attemptWsHeartbeat();
