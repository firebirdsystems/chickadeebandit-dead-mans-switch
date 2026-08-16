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
 *  - UPLOAD an attachment → the client, on both paths where the UPDATE that
 *                           would reference the bytes fails to land.
 *  - REMOVE an attachment → the client, after re-deriving references from
 *                           freshly loaded rows.
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
  const body = fn("removeAttachment", "// Delete stored files that no switch");

  it("re-derives references from freshly loaded rows before deleting", () => {
    // Ordering matters: unlink, reload, then reclaim. If the UPDATE did not
    // land, the reloaded row still names the file and the reclaim skips it.
    const update = body.indexOf("UPDATE app_dead_mans_switch__switches");
    const reload = body.indexOf("loadRows()");
    const reclaim = body.indexOf("deleteUnreferencedFiles");
    expect(update).toBeLessThan(reload);
    expect(reload).toBeLessThan(reclaim);
  });

  it("keeps the reference check rather than deleting the id outright", () => {
    expect(body).toContain("deleteUnreferencedFiles([fileId])");
  });
});
