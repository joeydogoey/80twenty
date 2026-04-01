'use strict';

const https = require('https');
const http = require('http');
const {
  getUnuploadedEvents,
  markEventsUploaded,
  incrementEventUploadAttempts,
} = require('../storage/database');
const { UploadQueue } = require('./queue');
const { loadSettings } = require('../settings');

let queue;

/**
 * Start the event upload queue.
 * @param {{ onAlert?: Function }} options
 */
function startEventUploader({ onAlert } = {}) {
  queue = new UploadQueue('events', uploadBatch, onAlert);
  queue.start(30 * 1000); // Every 30 seconds
}

async function uploadBatch() {
  const settings = loadSettings();
  const { apiBase, authToken, deviceId, employeeId, companyId } = settings;

  if (!apiBase || !authToken) {
    // Skip silently — user hasn't configured API yet
    return;
  }

  const events = getUnuploadedEvents(100);
  if (events.length === 0) return;

  const ids = events.map((e) => e.id);

  const body = JSON.stringify({
    device_id: deviceId || '',
    employee_id: employeeId || '',
    company_id: companyId || '',
    events: events.map((e) => ({
      event_id: e.event_id,
      event_type: e.event_type,
      timestamp: e.timestamp,
      source: e.source,
      payload: safeParseJson(e.payload, {}),
      screenshot_id: e.screenshot_id || undefined,
    })),
  });

  const response = await httpPost(`${apiBase}/api/v1/events`, body, authToken);

  if (response.statusCode === 200) {
    markEventsUploaded(ids);
    const data = safeParseJson(response.body, {});
    console.log(`[event-uploader] Uploaded ${ids.length} events (server received: ${data.received})`);
  } else {
    incrementEventUploadAttempts(ids);
    throw new Error(`HTTP ${response.statusCode}: ${response.body}`);
  }
}

/** Flush all pending events immediately (called on app quit). */
async function flushEvents() {
  if (queue) await queue.flush();
}

function stopEventUploader() {
  if (queue) queue.stop();
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function httpPost(url, body, authToken) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': authToken,
      },
      timeout: 15000,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

function safeParseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = { startEventUploader, stopEventUploader, flushEvents };
