import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));
const migration = readFileSync(join(__dirname, "../migrations/001_init.sql"), "utf-8");

describe("manifest.json", () => {
  it("has required string fields", () => {
    for (const field of ["id", "name", "version", "description", "entrypoint", "runtime", "icon"]) {
      expect(manifest[field], `missing field: ${field}`).toBeTruthy();
    }
  });

  it("entrypoint is index.html", () => expect(manifest.entrypoint).toBe("index.html"));
  it("runtime is static", () => expect(manifest.runtime).toBe("static"));
  it("uses db storage", () => expect(manifest.storage).toBe("db"));
  it("reads family.members and the contacts email export (prefill picker)", () => {
    expect(manifest.data_access.reads).toEqual(["family.members", "app.contacts.contact_emails"]);
    expect(manifest.data_access.writes).toEqual([]);
  });

  it("declares the paid capabilities the protocol consumes", () => {
    expect(manifest.required_capabilities).toEqual(["cron", "email"]);
    expect(manifest.requires_entitlement).toBeUndefined();
  });
});

describe("inactivity_alerts protocol config", () => {
  const cfg = manifest.inactivity_alerts;

  it("is declared with all required columns", () => {
    expect(cfg).toBeTruthy();
    for (const field of [
      "table", "member_column", "id_column", "active_column", "interval_hours_column",
      "last_checkin_column", "last_alerted_column", "message_column", "recipients_column",
    ]) {
      expect(cfg[field], `missing ${field}`).toBeTruthy();
    }
  });

  it("declares an id_column so the cron stamps each switch independently", () => {
    // Members can own several switches; per-switch stamping keeps their other
    // switches due after one fires. Without id_column the cron stamps by member.
    expect(cfg.id_column).toBe("id");
  });

  it("every configured column exists in the migration", () => {
    const prefixed = `app_dead_mans_switch__${cfg.table}`;
    expect(migration).toContain(prefixed);
    const columns = [
      cfg.id_column, cfg.member_column, cfg.active_column, cfg.interval_hours_column,
      cfg.last_checkin_column, cfg.last_alerted_column, cfg.message_column, cfg.recipients_column,
    ];
    for (const col of columns) {
      expect(migration, `migration missing column ${col}`).toMatch(new RegExp(`^\\s+${col}\\s`, "m"));
    }
  });

  it("no longer forces one switch per member (unique index removed)", () => {
    expect(migration).not.toMatch(/UNIQUE INDEX/i);
  });

  it("the switch table is owner_only so members only see their own switch", () => {
    const policy = manifest.row_policies[cfg.table];
    expect(policy).toMatchObject({ kind: "owner_only", member_column: cfg.member_column });
  });
});

describe("external contacts (double opt-in)", () => {
  const cfg = manifest.inactivity_alerts;

  it("declares the external_contacts protocol", () => {
    expect(manifest.external_contacts).toBeTruthy();
  });

  it("routes alerts to an external_recipients_column that exists in the migration", () => {
    expect(cfg.external_recipients_column).toBe("recipient_emails");
    expect(migration).toMatch(new RegExp(`^\\s+${cfg.external_recipients_column}\\s`, "m"));
  });

  it("keeps external_recipients_column distinct from the member recipients column", () => {
    expect(cfg.external_recipients_column).not.toBe(cfg.recipients_column);
  });
});

describe("trigger share link (shareable + share_item_type)", () => {
  const migration002 = readFileSync(join(__dirname, "../migrations/002_attachments.sql"), "utf-8");
  const share = manifest.shareable?.switch;

  it("declares a shareable switch item the alert cron can mint links for", () => {
    expect(share).toBeTruthy();
    expect(manifest.inactivity_alerts.share_item_type).toBe("switch");
    expect(share.table).toBe(manifest.inactivity_alerts.table);
  });

  it("projects ONLY the label, message, and attachments — never recipients or timestamps", () => {
    expect(share.title_column).toBe("label");
    expect(share.columns.map((c) => c.column)).toEqual(["message"]);
    expect(share.files.ids_column).toBe("attachment_file_ids");
  });

  it("restricts minting to the switch owner (owner_column, matching owner_only rows)", () => {
    expect(share.owner_column).toBe(manifest.row_policies.switches.member_column);
  });

  it("the attachments column exists via migration 002", () => {
    expect(migration002).toMatch(/ADD COLUMN attachment_file_ids TEXT NOT NULL DEFAULT '\[\]'/);
  });
});
