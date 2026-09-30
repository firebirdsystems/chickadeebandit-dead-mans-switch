import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));
const html = readFileSync(join(__dirname, "../src/index.html"), "utf-8");
const norm = (s) => s.replace(/\s+/g, " ").trim();
// An app with nothing to preload (kv/none storage, or no bounded first read)
// declares no `preload`; the checks below then hold vacuously until it adds one.
const preload = manifest.preload ?? {};

// The hub runs `manifest.preload` while rendering the document and answers the
// app's matching api/db request from the embedded rows — matching on the
// statement text with whitespace collapsed. A drifted copy is not an error
// anywhere: it is a preload that silently never answers. So the manifest is
// checked against the source here.
describe("manifest.preload mirrors the app's first-render reads", () => {
  const body = norm(html);
  const prefix = `app_${manifest.id.replace(/-/g, "_")}__`;

  it("declares statements the app posts, byte-for-byte after whitespace collapse", () => {
    // The whole db("…", [params]) call, not a substring of the SQL: a declared
    // text that is only a prefix of what is posted, or the right text with the
    // wrong params, would admit fine and then never answer a request. ":me" is
    // what the hub resolves to the member id; the app posts ME.id for it.
    const argOf = (p) => (p === ":me" ? "ME.id" : JSON.stringify(p));
    for (const [name, { sql, params = [] }] of Object.entries(preload)) {
      const call = `db( "${norm(sql)}", [${params.map(argOf).join(", ")}]`;
      expect(body.includes(call), `preload.${name} is not the call src/index.html posts`).toBe(true);
    }
  });

  it("the preloaded read is the first api/db POST on the boot path", () => {
    // Any unmatched api/db POST before it invalidates the whole preload. init()
    // fires loadRows() alongside context/endpoint fetches only (none hit api/db).
    if (!preload.switches) return;
    expect(body).toMatch(/\(async function init\(\) \{ await Promise\.all\(\[ loadMembers\(\), loadRows\(\), loadEntitlement\(\), loadExternalContacts\(\), loadContactsBook\(\), loadFilesMeta\(\), \]\);/);
    const loadRows = /async function loadRows\(\) \{(.*?)\n?\}\s*async function/.exec(body)?.[1] ?? "";
    expect(loadRows).toContain(`db( "${norm(preload.switches.sql)}", [ME.id]`);
  });

  it("stays within the hub's caps and reads only this app's tables", () => {
    expect(Object.keys(preload).length).toBeLessThanOrEqual(6);
    for (const [name, { sql, params = [] }] of Object.entries(preload)) {
      expect(sql, name).toMatch(/^(SELECT|WITH) /);
      expect(sql, name).not.toMatch(/;|--/);
      for (const table of sql.match(/(?:FROM|JOIN)\s+(\w+)/g) ?? []) expect(table, name).toMatch(new RegExp(`\\s${prefix}`));
      expect((sql.match(/\?/g) ?? []).length, `${name}: placeholders vs params`).toBe(params.length);
    }
  });
});
