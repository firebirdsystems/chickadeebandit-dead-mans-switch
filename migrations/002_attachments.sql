-- Files the owner leaves for their contacts: a JSON array of hub file ids
-- (uploaded via api/files). When a switch triggers, the hub's alert email
-- carries an external share link exposing the switch's message and these
-- files (manifest shareable.switch + inactivity_alerts.share_item_type);
-- the owner's next check-in revokes every alert-minted link.
ALTER TABLE app_dead_mans_switch__switches
  ADD COLUMN attachment_file_ids TEXT NOT NULL DEFAULT '[]';
