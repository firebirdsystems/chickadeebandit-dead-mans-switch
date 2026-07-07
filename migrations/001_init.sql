-- A member may own several switches, each with its own silence window and
-- recipient group. The hub's inactivity_alerts protocol owns the check-in
-- flow: last_checkin_at is stamped on ALL of a member's switches by
-- POST /run/dead-mans-switch/api/check-in (one check-in = "I'm alive"),
-- and last_alerted_at is stamped per-switch (by id) by the hub's hourly cron
-- when that switch's window is overdue.
CREATE TABLE IF NOT EXISTS app_dead_mans_switch__switches (
  id                   TEXT    NOT NULL,
  member_id            TEXT    NOT NULL,
  label                TEXT    NOT NULL DEFAULT '',    -- member-chosen name, e.g. "Close family"
  active               INTEGER NOT NULL DEFAULT 0,     -- 0 = disarmed, 1 = armed
  interval_hours       INTEGER NOT NULL DEFAULT 168,   -- silence window before the alert fires (min 1 week)
  message              TEXT    NOT NULL DEFAULT '',    -- included in the alert email
  recipient_member_ids TEXT    NOT NULL DEFAULT '[]',  -- JSON array of member ids; empty = all adults
  recipient_emails     TEXT    NOT NULL DEFAULT '[]',  -- JSON array of external emails; only CONFIRMED ones (hub external-contacts registry) are alerted
  last_checkin_at      TEXT,                           -- ISO, endpoint-stamped
  last_alerted_at      TEXT,                           -- ISO, cron-stamped per switch (dedupe)
  created_at           TEXT    NOT NULL,
  updated_at           TEXT    NOT NULL,
  PRIMARY KEY (id)
);

-- Members read/write their own switches; the owner_only row policy filters by
-- member_id. A plain index (no longer a uniqueness constraint) keeps those
-- lookups fast now that a member can own several switches.
CREATE INDEX IF NOT EXISTS switches_by_member
  ON app_dead_mans_switch__switches (member_id);
