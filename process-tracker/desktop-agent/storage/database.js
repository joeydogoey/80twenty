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
};
