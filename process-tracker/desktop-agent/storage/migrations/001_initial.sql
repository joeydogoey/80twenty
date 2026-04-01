-- Process Tracker — SQLite schema (desktop agent local storage)

CREATE TABLE IF NOT EXISTS events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id         TEXT    UNIQUE NOT NULL,
  event_type       TEXT    NOT NULL,
  timestamp        TEXT    NOT NULL,
  source           TEXT    NOT NULL,
  payload          TEXT    NOT NULL,  -- JSON string
  screenshot_id    TEXT,
  uploaded         INTEGER DEFAULT 0,
  upload_attempts  INTEGER DEFAULT 0,
  created_at       TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_events_uploaded    ON events(uploaded);
CREATE INDEX IF NOT EXISTS idx_events_timestamp   ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_upload_atts ON events(upload_attempts);

CREATE TABLE IF NOT EXISTS screenshots (
  id               TEXT    PRIMARY KEY,
  timestamp        TEXT    NOT NULL,
  trigger_type     TEXT    NOT NULL,  -- 'click' | 'window_switch' | 'periodic'
  app_name         TEXT,
  window_title     TEXT,
  click_x          INTEGER,
  click_y          INTEGER,
  local_path       TEXT    NOT NULL,
  remote_url       TEXT,
  remote_key       TEXT,
  uploaded         INTEGER DEFAULT 0,
  upload_attempts  INTEGER DEFAULT 0,
  file_size_bytes  INTEGER,
  created_at       TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  uploaded_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_screenshots_uploaded ON screenshots(uploaded);
CREATE INDEX IF NOT EXISTS idx_screenshots_ts       ON screenshots(timestamp);
