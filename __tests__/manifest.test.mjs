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
  it("reads only family.members", () => {
    expect(manifest.data_access.reads).toEqual(["family.members"]);
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
      "table", "member_column", "active_column", "interval_hours_column",
      "last_checkin_column", "last_alerted_column", "message_column", "recipients_column",
    ]) {
      expect(cfg[field], `missing ${field}`).toBeTruthy();
    }
  });

  it("every configured column exists in the migration", () => {
    const prefixed = `app_dead_mans_switch__${cfg.table}`;
    expect(migration).toContain(prefixed);
    const columns = [
      cfg.member_column, cfg.active_column, cfg.interval_hours_column,
      cfg.last_checkin_column, cfg.last_alerted_column, cfg.message_column, cfg.recipients_column,
    ];
    for (const col of columns) {
      expect(migration, `migration missing column ${col}`).toMatch(new RegExp(`^\\s+${col}\\s`, "m"));
    }
  });

  it("the switch table is owner_only so members only see their own switch", () => {
    const policy = manifest.row_policies[cfg.table];
    expect(policy).toMatchObject({ kind: "owner_only", member_column: cfg.member_column });
  });
});
