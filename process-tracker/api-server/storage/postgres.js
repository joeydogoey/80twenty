'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[postgres] Unexpected pool error:', err.message);
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS events (
      id          BIGSERIAL PRIMARY KEY,
      event_id    UUID        UNIQUE NOT NULL DEFAULT gen_random_uuid(),
      device_id   TEXT,
      employee_id TEXT,
      company_id  TEXT,
      event_type  TEXT        NOT NULL,
      timestamp   TIMESTAMPTZ NOT NULL,
      source      TEXT        NOT NULL,
      payload     JSONB       NOT NULL,
      screenshot_id TEXT,
      received_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_events_timestamp   ON events(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_events_employee    ON events(employee_id);
    CREATE INDEX IF NOT EXISTS idx_events_type        ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_device      ON events(device_id);

    CREATE TABLE IF NOT EXISTS screenshots (
      id              TEXT PRIMARY KEY,
      device_id       TEXT,
      employee_id     TEXT,
      timestamp       TIMESTAMPTZ NOT NULL,
      trigger_type    TEXT        NOT NULL,
      app_name        TEXT,
      remote_key      TEXT,
      remote_url      TEXT,
      file_size_bytes INTEGER,
      confirmed_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_screenshots_employee ON screenshots(employee_id);
    CREATE INDEX IF NOT EXISTS idx_screenshots_ts       ON screenshots(timestamp DESC);
  `);

  console.log('[postgres] Schema initialized');
}

module.exports = { query, pool, initSchema };
