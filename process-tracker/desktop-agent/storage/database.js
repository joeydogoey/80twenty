'use strict';

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

let db;

/**
 * Initialize the SQLite database.
 * Must be called once before any other database function.
 * @param {string} userDataPath - Electron app.getPath('userData')
 */
function initDatabase(userDataPath) {
  const Database = require('better-sqlite3');
  const dbPath = path.join(userDataPath, 'tracker.db');

  db = new Database(dbPath);

  // WAL mode: allows concurrent reads from renderer + main process
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL'); // Safe with WAL, much faster than FULL

  runMigrations();
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

function runMigrations() {
  const migrationPath = path.join(__dirname, 'migrations', '001_initial.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  db.exec(sql);
}

// ── Events ────────────────────────────────────────────────────────────────────

function insertEvent({ event_type, timestamp, source, payload, screenshot_id }) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO events
      (event_id, event_type, timestamp, source, payload, screenshot_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    uuidv4(),
    event_type,
    timestamp || new Date().toISOString(),
    source,
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    screenshot_id || null
  );
}

function getUnuploadedEvents(limit = 100) {
  return getDb().prepare(`
    SELECT id, event_id, event_type, timestamp, source, payload, screenshot_id
    FROM events
    WHERE uploaded = 0 AND upload_attempts < 10
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit);
}

function markEventsUploaded(ids) {
  if (!ids || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  getDb().prepare(`UPDATE events SET uploaded = 1 WHERE id IN (${placeholders})`).run(...ids);
}

function incrementEventUploadAttempts(ids) {
  if (!ids || ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(', ');
  getDb().prepare(
    `UPDATE events SET upload_attempts = upload_attempts + 1 WHERE id IN (${placeholders})`
  ).run(...ids);
}

function deleteOldEvents(daysOld = 7) {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  return getDb().prepare(
    `DELETE FROM events WHERE uploaded = 1 AND created_at < ?`
  ).run(cutoff);
}

// ── Screenshots ───────────────────────────────────────────────────────────────

function insertScreenshot({ id, timestamp, trigger_type, app_name, window_title, click_x, click_y, local_path, file_size_bytes }) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO screenshots
      (id, timestamp, trigger_type, app_name, window_title, click_x, click_y, local_path, file_size_bytes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    id,
    timestamp || new Date().toISOString(),
    trigger_type,
    app_name || null,
    window_title || null,
    click_x != null ? click_x : null,
    click_y != null ? click_y : null,
    local_path,
    file_size_bytes || null
  );
}

function getUnuploadedScreenshots(limit = 10) {
  return getDb().prepare(`
    SELECT *
    FROM screenshots
    WHERE uploaded = 0 AND upload_attempts < 10
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit);
}

function markScreenshotUploaded(id, remoteUrl, remoteKey) {
  getDb().prepare(`
    UPDATE screenshots
    SET uploaded = 1, remote_url = ?, remote_key = ?, uploaded_at = ?
    WHERE id = ?
  `).run(remoteUrl || null, remoteKey || null, new Date().toISOString(), id);
}

function incrementScreenshotUploadAttempts(id) {
  getDb().prepare(
    `UPDATE screenshots SET upload_attempts = upload_attempts + 1 WHERE id = ?`
  ).run(id);
}

function getScreenshotForCleanup(olderThanMs = 24 * 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  return getDb().prepare(`
    SELECT id, local_path
    FROM screenshots
    WHERE uploaded = 1 AND uploaded_at < ? AND local_path IS NOT NULL
  `).all(cutoff);
}

function clearScreenshotLocalPath(id) {
  getDb().prepare(`UPDATE screenshots SET local_path = NULL WHERE id = ?`).run(id);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function getStats() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    eventsToday: getDb().prepare(
      `SELECT COUNT(*) as n FROM events WHERE timestamp >= ?`
    ).get(`${today}T00:00:00.000Z`).n,
    eventsPending: getDb().prepare(
      `SELECT COUNT(*) as n FROM events WHERE uploaded = 0`
    ).get().n,
    screenshotsToday: getDb().prepare(
      `SELECT COUNT(*) as n FROM screenshots WHERE timestamp >= ?`
    ).get(`${today}T00:00:00.000Z`).n,
    screenshotsPending: getDb().prepare(
      `SELECT COUNT(*) as n FROM screenshots WHERE uploaded = 0`
    ).get().n,
  };
}

// ── Dashboard queries ─────────────────────────────────────────────────────────

function getDashboardScreenshots({ limit = 50, offset = 0, date = null } = {}) {
  let where = '';
  const params = [];
  if (date) {
    where = `WHERE timestamp >= ? AND timestamp < ?`;
    params.push(`${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`);
  }
  params.push(limit, offset);
  return getDb().prepare(`
    SELECT id, timestamp, trigger_type, app_name, window_title,
           click_x, click_y, local_path, remote_url, uploaded, file_size_bytes
    FROM screenshots
    ${where}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(...params);
}

function getDashboardEvents({ limit = 200, offset = 0, date = null, appName = null, eventType = null } = {}) {
  const conditions = [];
  const params = [];

  if (date) {
    conditions.push(`timestamp >= ? AND timestamp < ?`);
    params.push(`${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`);
  }
  if (appName) {
    conditions.push(`json_extract(payload, '$.app_name') = ?`);
    params.push(appName);
  }
  if (eventType) {
    conditions.push(`event_type = ?`);
    params.push(eventType);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  return getDb().prepare(`
    SELECT id, event_id, event_type, timestamp, source, payload, screenshot_id
    FROM events
    ${where}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(...params);
}

function getEventsAroundTime(timestamp, windowMs = 10000) {
  const ts = new Date(timestamp).getTime();
  const from = new Date(ts - windowMs).toISOString();
  const to   = new Date(ts + windowMs).toISOString();
  return getDb().prepare(`
    SELECT id, event_type, timestamp, source, payload, screenshot_id
    FROM events
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(from, to);
}

function getDistinctApps() {
  return getDb().prepare(`
    SELECT DISTINCT json_extract(payload, '$.app_name') as app_name
    FROM events
    WHERE json_extract(payload, '$.app_name') IS NOT NULL
    ORDER BY app_name ASC
  `).all().map(r => r.app_name).filter(Boolean);
}

function getAvailableDates() {
  return getDb().prepare(`
    SELECT DISTINCT substr(timestamp, 1, 10) as date
    FROM events
    ORDER BY date DESC
    LIMIT 30
  `).all().map(r => r.date);
}

// ── Summary queries ───────────────────────────────────────────────────────────

/**
 * Aggregate active time per app for a given date.
 * Returns [{app_name, web_app_name, active_seconds, total_seconds, switch_count}]
 * sorted by active_seconds descending.
 */
function getAppTimeSummary(date) {
  const rows = getDb().prepare(`
    SELECT
      json_extract(payload, '$.app_name')          AS app_name,
      json_extract(payload, '$.web_app_name')       AS web_app_name,
      SUM(CAST(COALESCE(json_extract(payload, '$.active_duration_seconds'), 0) AS INTEGER))   AS active_seconds,
      SUM(CAST(COALESCE(json_extract(payload, '$.duration_on_previous_seconds'), 0) AS INTEGER)) AS total_seconds,
      COUNT(*) AS switch_count
    FROM events
    WHERE event_type = 'window_change'
      AND timestamp >= ?
      AND timestamp < ?
    GROUP BY app_name
    ORDER BY active_seconds DESC
  `).all(`${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`);
  return rows.filter(r => r.app_name);
}

/**
 * Group window_change events for a date into workflow sequences.
 * A gap of >= 5 minutes between consecutive events starts a new workflow.
 * Returns [{startTime, endTime, totalActiveSeconds, apps: [{name, webAppName, activeSeconds}]}]
 */
function getWorkflowSequences(date) {
  const GAP_MS = 5 * 60 * 1000; // 5-minute gap = new workflow

  const rows = getDb().prepare(`
    SELECT
      timestamp,
      json_extract(payload, '$.app_name')          AS app_name,
      json_extract(payload, '$.web_app_name')       AS web_app_name,
      CAST(COALESCE(json_extract(payload, '$.active_duration_seconds'), 0) AS INTEGER) AS active_seconds
    FROM events
    WHERE event_type = 'window_change'
      AND timestamp >= ?
      AND timestamp < ?
    ORDER BY timestamp ASC
  `).all(`${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`);

  if (rows.length === 0) return [];

  const sequences = [];
  let current = null;

  for (const row of rows) {
    if (!row.app_name) continue;
    const ts = new Date(row.timestamp).getTime();

    if (!current || ts - current.lastTs >= GAP_MS) {
      if (current) sequences.push(current);
      current = { startTime: row.timestamp, endTime: row.timestamp, lastTs: ts, totalActiveSeconds: 0, apps: [] };
    }

    current.endTime = row.timestamp;
    current.lastTs = ts;
    current.totalActiveSeconds += row.active_seconds;
    current.apps.push({ name: row.app_name, webAppName: row.web_app_name || '', activeSeconds: row.active_seconds });
  }
  if (current) sequences.push(current);

  // Remove lastTs from output
  return sequences.map(({ lastTs: _, ...s }) => s);
}

module.exports = {
  initDatabase,
  getDb,
  insertEvent,
  getUnuploadedEvents,
  markEventsUploaded,
  incrementEventUploadAttempts,
  deleteOldEvents,
  insertScreenshot,
  getUnuploadedScreenshots,
  markScreenshotUploaded,
  incrementScreenshotUploadAttempts,
  getScreenshotForCleanup,
  clearScreenshotLocalPath,
  getStats,
  getDashboardScreenshots,
  getDashboardEvents,
  getEventsAroundTime,
  getDistinctApps,
  getAvailableDates,
  getAppTimeSummary,
  getWorkflowSequences,
};
