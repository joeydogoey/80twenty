'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const {
  getUnuploadedScreenshots,
  markScreenshotUploaded,
  incrementScreenshotUploadAttempts,
  getScreenshotForCleanup,
  clearScreenshotLocalPath,
} = require('../storage/database');
const { UploadQueue } = require('./queue');
const { loadSettings } = require('../settings');

let queue;

/**
 * Start the screenshot upload queue.
 * @param {{ onAlert?: Function }} options
 */
function startScreenshotUploader({ onAlert } = {}) {
  queue = new UploadQueue('screenshots', uploadNextScreenshot, onAlert);
  queue.start(30 * 1000);

  // Run local file cleanup every hour
  setInterval(cleanupLocalFiles, 60 * 60 * 1000);
}

async function uploadNextScreenshot() {
  const settings = loadSettings();
  const { apiBase, authToken, deviceId, employeeId } = settings;

  if (!apiBase || !authToken) return;

  // Process one screenshot at a time to avoid hammering the network
  const [screenshot] = getUnuploadedScreenshots(1);
  if (!screenshot) return;

  // Skip if local file is missing (maybe was deleted)
  if (!screenshot.local_path || !fs.existsSync(screenshot.local_path)) {
    markScreenshotUploaded(screenshot.id, null, null);
    return;
  }

  // Step 1: Request pre-signed upload URL
  const uploadUrlBody = JSON.stringify({
    screenshot_id: screenshot.id,
    timestamp: screenshot.timestamp,
    trigger_type: screenshot.trigger_type,
    app_name: screenshot.app_name,
    file_size_bytes: screenshot.file_size_bytes,
    device_id: deviceId || '',
    employee_id: employeeId || '',
  });

  const urlResponse = await httpPost(
    `${apiBase}/api/v1/screenshots/upload-url`,
    uploadUrlBody,
    authToken
  );

  if (urlResponse.statusCode !== 200) {
    incrementScreenshotUploadAttempts(screenshot.id);
    throw new Error(`upload-url failed with HTTP ${urlResponse.statusCode}: ${urlResponse.body}`);
  }

  const { upload_url, remote_key } = JSON.parse(urlResponse.body);

  // Step 2: PUT the JPEG to the pre-signed URL
  // IMPORTANT: Do NOT send Authorization header to the pre-signed URL
  const fileBuffer = fs.readFileSync(screenshot.local_path);

  await httpPut(upload_url, fileBuffer, 'image/jpeg');

  // Step 3: Confirm the upload with our API
  const confirmBody = JSON.stringify({
    screenshot_id: screenshot.id,
    remote_key,
  });

  const confirmResponse = await httpPost(
    `${apiBase}/api/v1/screenshots/confirm`,
    confirmBody,
    authToken
  );

  if (confirmResponse.statusCode !== 200) {
    incrementScreenshotUploadAttempts(screenshot.id);
    throw new Error(`confirm failed with HTTP ${confirmResponse.statusCode}: ${confirmResponse.body}`);
  }

  // Step 4: Mark as uploaded in local DB
  const remoteUrl = `${remote_key}`; // Server builds the full URL
  markScreenshotUploaded(screenshot.id, remoteUrl, remote_key);

  console.log(`[screenshot-uploader] Uploaded ${screenshot.id}`);

  // Schedule local file deletion after 24 hours
  setTimeout(() => deleteLocalFile(screenshot.id, screenshot.local_path), 24 * 60 * 60 * 1000);
}

function deleteLocalFile(id, localPath) {
  try {
    if (localPath && fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      clearScreenshotLocalPath(id);
      console.log(`[screenshot-uploader] Deleted local file: ${localPath}`);
    }
  } catch (err) {
    console.warn(`[screenshot-uploader] Failed to delete ${localPath}:`, err.message);
  }
}

function cleanupLocalFiles() {
  const toDelete = getScreenshotForCleanup(24 * 60 * 60 * 1000);
  for (const { id, local_path } of toDelete) {
    deleteLocalFile(id, local_path);
  }
}

function stopScreenshotUploader() {
  if (queue) queue.stop();
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

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

/**
 * PUT a buffer to a pre-signed URL.
 * CRITICAL: Do NOT include Authorization headers — they will invalidate the signature.
 */
function httpPut(url, buffer, contentType) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        // NO Authorization header — pre-signed URL is self-authenticating
      },
      timeout: 60000, // 60s timeout for file upload
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: data });
        } else {
          reject(new Error(`PUT failed with HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Upload timeout')); });
    req.write(buffer);
    req.end();
  });
}

module.exports = { startScreenshotUploader, stopScreenshotUploader };
