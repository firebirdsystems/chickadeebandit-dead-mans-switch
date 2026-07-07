-- One switch per member. The hub's dead_mans_switch protocol owns the
-- check-in flow: last_checkin_at is stamped by POST /run/dead-mans-switch/api/check-in
-- (server clock, entitlement-gated) and last_alerted_at is stamped by the
-- hub's hourly cron when an overdue alert is emailed.
CREATE TABLE IF NOT EXISTS app_dead_mans_switch__switches (
  id                   TEXT    NOT NULL,
  member_id            TEXT    NOT NULL,
  active               INTEGER NOT NULL DEFAULT 0,     -- 0 = disarmed, 1 = armed
  interval_hours       INTEGER NOT NULL DEFAULT 72,    -- silence window before the alert fires
  message              TEXT    NOT NULL DEFAULT '',    -- included in the alert email
  recipient_member_ids TEXT    NOT NULL DEFAULT '[]',  -- JSON array; empty = all adults
  last_checkin_at      TEXT,                           -- ISO, endpoint-stamped
  last_alerted_at      TEXT,                           -- ISO, cron-stamped (dedupe)
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL,
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS switches_unique_member
  ON app_dead_mans_switch__switches (member_id);
