'use strict';

const { Router } = require('express');
const { query } = require('../storage/postgres');
const { generateUploadUrl, buildPublicUrl } = require('../storage/r2');

const router = Router();

/**
 * POST /api/v1/screenshots/upload-url
 * Body: {
 *   screenshot_id: string,
 *   timestamp: string (ISO 8601),
 *   trigger_type: "click" | "window_switch" | "periodic",
 *   app_name: string,
 *   file_size_bytes: number,
 *   device_id?: string,
 *   employee_id?: string
 * }
 * Response: { upload_url: string, remote_key: string }
 */
router.post('/upload-url', async (req, res, next) => {
  try {
    const {
      screenshot_id,
      timestamp,
      trigger_type,
      app_name,
      file_size_bytes,
      device_id,
      employee_id,
    } = req.body;

    if (!screenshot_id || !timestamp) {
      return res.status(400).json({ error: 'screenshot_id and timestamp are required' });
    }

    // Build a structured key: screenshots/YYYY/MM/DD/{screenshot_id}.jpg
    const date = new Date(timestamp);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const remote_key = `screenshots/${yyyy}/${mm}/${dd}/${screenshot_id}.jpg`;

    // Create DB record (unconfirmed)
    await query(`
      INSERT INTO screenshots
        (id, device_id, employee_id, timestamp, trigger_type, app_name, remote_key, file_size_bytes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO NOTHING
    `, [screenshot_id, device_id || null, employee_id || null, timestamp, trigger_type || 'unknown', app_name || null, remote_key, file_size_bytes || null]);

    const upload_url = await generateUploadUrl(remote_key);

    console.log(`[screenshots] Pre-signed URL issued for ${screenshot_id}`);

    res.json({ upload_url, remote_key });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/screenshots/confirm
 * Body: { screenshot_id: string, remote_key: string }
 * Response: { ok: true }
 */
router.post('/confirm', async (req, res, next) => {
  try {
    const { screenshot_id, remote_key } = req.body;

    if (!screenshot_id) {
      return res.status(400).json({ error: 'screenshot_id is required' });
    }

    const remote_url = buildPublicUrl(remote_key);

    await query(`
      UPDATE screenshots
      SET confirmed_at = NOW(), remote_url = $1
      WHERE id = $2
    `, [remote_url, screenshot_id]);

    console.log(`[screenshots] Confirmed upload for ${screenshot_id}`);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
