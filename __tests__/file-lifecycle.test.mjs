/**
 * Every lane that can strand an uploaded file has to clean up after itself.
 *
 * Nothing sweeps unreferenced files: the hub's storage reconciler only reaps R2
 * objects with NO metadata row, and an abandoned upload keeps its row. So it is
 * invisible to every view in the app and still billed against the household's
 * hard storage cap, permanently.
 *
 * The three lanes here, and who owns each:
 *  - DELETE a switch      → the hub, via manifest.delete_file_list_columns
 *                           (decoded through the household codec, queued inside
 *                           the DELETE's own transaction).
 *  - REMOVE an attachment → the hub, via manifest.update_file_list_columns
 *                           (reads the pre-image, queues what the new value
 *                           drops; the outbox re-checks references against the
 *                           committed database before touching R2).
 *  - UPLOAD an attachment → the client, and ONLY here: on both paths where the
 *                           UPDATE that would reference the bytes fails to
 *                           land, no row ever took a reference, so there is
 *                           nothing for the hub's lanes to key off.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(__dirname, "../src/index.html"), "utf-8");
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));

const fn = (name, end) =>
  client.slice(client.indexOf(`async function ${name}(`), client.indexOf(end));

describe("switch deletion", () => {
  const body = fn("deleteSwitch", "// Global check-in");

  it("declares the attachment list so the hub reclaims it transactionally", () => {
    expect(manifest.delete_file_list_columns?.switches).toContain("attachment_file_ids");
  });

  it("does not reclaim the attachments from the client", () => {
    // The old call ran after the row was gone AND after a loadRows() round
    // trip; an interruption anywhere in between stranded every attachment.
    // Matched as a CALL, not a mention: the comment explaining the removal
    // names the function it replaced.
    expect(body).not.toMatch(/^[^/\n]*\bdeleteUnreferencedFiles\s*\(/m);
  });

  it("deletes the switch as a single statement, which the declaration requires", () => {
    // A declared table's DELETE cannot go through the /api/db batch form — the
    // hub refuses it rather than silently skipping the reclaim.
    expect(body).toContain('await db("DELETE FROM app_dead_mans_switch__switches WHERE id = ? AND member_id = ?"');
  });
});

describe("attachment upload", () => {
  const body = fn("uploadAttachment", "async function removeAttachment(");

  it("discards the upload when the referencing UPDATE throws", () => {
    const del = body.indexOf("method: \"DELETE\"");
    expect(del).toBeGreaterThan(-1);
    expect(body).toMatch(/catch\s*\([\s\S]*?\)\s*\{[\s\S]*?method: "DELETE"/);
  });

  it("discards the upload when the UPDATE matches no row", () => {
    // `WHERE id = ? AND member_id = ?` can match nothing — the switch may have
    // been deleted from another device mid-upload — and that returns a clean
    // response, not an error.
    expect(body).toMatch(/if \(!changed\)/);
    const guard = body.slice(body.indexOf("if (!changed)"));
    expect(guard).toContain('method: "DELETE"');
  });

  it("reads the affected-row count under the name the hub actually returns", () => {
    // The single /api/db form returns { rows, changed } — `changes` is the
    // BATCH form's spelling. Destructuring the wrong key yields undefined,
    // which is falsy, which would delete every successfully attached file.
    expect(body).toContain("({ changed } = await db(");
    expect(body).not.toContain("changes }");
  });
});

describe("attachment removal", () => {
  const body = fn("removeAttachment", "// The client no longer reclaims");

  it("declares the update lane so the hub reclaims the detached file", () => {
    expect(manifest.update_file_list_columns?.switches).toContain("attachment_file_ids");
  });

  it("does not reclaim from the client", () => {
    // Matched as a CALL, not a mention: the comment explaining the removal
    // names the function it replaced.
    expect(body).not.toMatch(/^[^/\n]*\bdeleteUnreferencedFiles\s*\(/m);
  });

  it("detaches as a single statement, which the declaration requires", () => {
    // A declared table's UPDATE cannot go through the /api/db batch form.
    expect(body).toContain('await db(\n        "UPDATE app_dead_mans_switch__switches SET attachment_file_ids = ?');
  });
});

describe("client-side reclaim", () => {
  it("keeps exactly one — undoing an upload no row ever referenced", () => {
    // Every other lane is the hub's now. A new client-side delete here would
    // be a lane quietly taken back from the outbox.
    const calls = client.match(/method: "DELETE" \}/g) ?? [];
    expect(calls).toHaveLength(2); // both inside uploadAttachment
    expect(client).not.toMatch(/^[^/\n]*\bdeleteUnreferencedFiles\s*\(/m);
  });
});
