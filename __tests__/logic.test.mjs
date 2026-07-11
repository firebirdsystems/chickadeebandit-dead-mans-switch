import { describe, it, expect } from "vitest";
import {
  HOURS_PER_WEEK, MIN_WEEKS, MAX_WEEKS, MAX_EXTERNAL_RECIPIENTS,
  weeksToHours, hoursToWeeks, intervalLabel,
  switchStatus, formatRemaining, validateConfig, recipientsSummary, switchTitle,
  isValidEmail, normalizeEmail,
} from "../src/logic.js";

const now = new Date("2026-07-07T12:00:00Z");

describe("weeks <-> hours", () => {
  it("converts whole weeks to hours and back", () => {
    expect(weeksToHours(1)).toBe(168);
    expect(weeksToHours(6)).toBe(1008);
    expect(hoursToWeeks(168)).toBe(1);
    expect(hoursToWeeks(1008)).toBe(6);
  });

  it("hoursToWeeks never falls below the 1-week minimum", () => {
    expect(hoursToWeeks(0)).toBe(MIN_WEEKS);
    expect(hoursToWeeks(72)).toBe(MIN_WEEKS); // legacy sub-week value rounds up to the floor
  });
});

describe("intervalLabel", () => {
  it("labels in weeks, singular and plural", () => {
    expect(intervalLabel(168)).toBe("1 week");
    expect(intervalLabel(336)).toBe("2 weeks");
    expect(intervalLabel(weeksToHours(6))).toBe("6 weeks");
  });
});

describe("switchStatus", () => {
  const base = { active: 1, interval_hours: 168, last_checkin_at: "2026-07-04T12:00:00Z" }; // 3d elapsed of 7d

  it("disarmed / unstarted", () => {
    expect(switchStatus(null, now).state).toBe("disarmed");
    expect(switchStatus({ ...base, active: 0 }, now).state).toBe("disarmed");
    expect(switchStatus({ ...base, last_checkin_at: null }, now).state).toBe("unstarted");
    expect(switchStatus({ ...base, last_checkin_at: "garbage" }, now).state).toBe("unstarted");
  });

  it("ok with time remaining", () => {
    const s = switchStatus(base, now); // 72h elapsed of 168h
    expect(s.state).toBe("ok");
    expect(s.remainingMs).toBe((168 - 72) * 3600_000);
  });

  it("due_soon inside the last quarter of the window", () => {
    // 6d 4h elapsed of 7d → under 25% (42h) left
    const s = switchStatus({ ...base, last_checkin_at: "2026-07-01T08:00:00Z" }, now);
    expect(s.state).toBe("due_soon");
  });

  it("overdue past the deadline", () => {
    const s = switchStatus({ ...base, last_checkin_at: "2026-06-28T12:00:00Z" }, now); // 9d elapsed
    expect(s.state).toBe("overdue");
  });
});

describe("formatRemaining", () => {
  it("formats coarse countdowns including weeks", () => {
    expect(formatRemaining(0)).toBe("now");
    expect(formatRemaining(40 * 60_000)).toBe("40m");
    expect(formatRemaining(3 * 3600_000 + 12 * 60_000)).toBe("3h 12m");
    expect(formatRemaining(2 * 24 * 3600_000 + 4 * 3600_000)).toBe("2d 4h");
    expect(formatRemaining(3 * 7 * 24 * 3600_000 + 2 * 24 * 3600_000)).toBe("3w 2d");
  });
});

describe("validateConfig", () => {
  const adults = [{ id: "a1", role: "adult" }, { id: "a2", role: "adult" }];

  it("accepts a sane config", () => {
    expect(validateConfig({ label: "Family", intervalWeeks: 2, message: "hi", recipientIds: ["a1"] }, adults)).toBeNull();
    expect(validateConfig({ label: "", intervalWeeks: 1, message: "", recipientIds: [] }, adults)).toBeNull();
  });

  it("rejects sub-week / non-integer / over-max intervals", () => {
    expect(validateConfig({ intervalWeeks: 0, recipientIds: [] }, adults)).toMatch(/at least 1 week/);
    expect(validateConfig({ intervalWeeks: 1.5, recipientIds: [] }, adults)).toMatch(/at least 1 week/);
    expect(validateConfig({ intervalWeeks: MAX_WEEKS + 1, recipientIds: [] }, adults)).toMatch(/longer than/);
  });

  it("rejects oversize names/messages and non-adult recipients", () => {
    expect(validateConfig({ label: "x".repeat(61), intervalWeeks: 1, recipientIds: [] }, adults)).toMatch(/Name is too long/);
    expect(validateConfig({ intervalWeeks: 1, message: "x".repeat(2001), recipientIds: [] }, adults)).toMatch(/too long/);
    expect(validateConfig({ intervalWeeks: 1, message: "", recipientIds: ["kid-1"] }, adults)).toMatch(/adult/);
  });

  it("accepts valid external recipient emails", () => {
    expect(validateConfig({ intervalWeeks: 1, recipientIds: [], recipientEmails: ["a@b.com", "c@d.org"] }, adults)).toBeNull();
    expect(validateConfig({ intervalWeeks: 1, recipientIds: [], recipientEmails: [] }, adults)).toBeNull();
  });

  it("rejects malformed emails, too many, or a non-list", () => {
    expect(validateConfig({ intervalWeeks: 1, recipientIds: [], recipientEmails: ["not-an-email"] }, adults)).toMatch(/valid email/);
    expect(validateConfig({ intervalWeeks: 1, recipientIds: [], recipientEmails: "a@b.com" }, adults)).toMatch(/must be a list/);
    const tooMany = Array.from({ length: MAX_EXTERNAL_RECIPIENTS + 1 }, (_, i) => `p${i}@x.com`);
    expect(validateConfig({ intervalWeeks: 1, recipientIds: [], recipientEmails: tooMany }, adults)).toMatch(/up to/);
  });
});

describe("email helpers", () => {
  it("validates email shape", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
    expect(isValidEmail(" a@b.com ")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
  it("normalizes to trimmed lowercase", () => {
    expect(normalizeEmail("  A@B.Com ")).toBe("a@b.com");
  });
});

describe("recipientsSummary", () => {
  const members = [
    { id: "me", name: "Me", role: "adult" },
    { id: "a2", name: "Jordan", role: "adult" },
    { id: "k1", name: "Kid", role: "child" },
  ];

  it("names explicit recipients, falls back to all adults minus self", () => {
    expect(recipientsSummary(["a2"], members, "me")).toBe("Jordan");
    expect(recipientsSummary([], members, "me")).toBe("Jordan (all adults)");
  });

  it("appends a count of external contacts", () => {
    expect(recipientsSummary(["a2"], members, "me", ["x@y.com"])).toBe("Jordan + 1 external contact");
    expect(recipientsSummary([], members, "me", ["x@y.com", "z@w.com"])).toBe("Jordan (all adults) + 2 external contacts");
  });
});

describe("switchTitle", () => {
  const members = [
    { id: "me", name: "Me", role: "adult" },
    { id: "a2", name: "Jordan", role: "adult" },
  ];

  it("uses the label when set", () => {
    expect(switchTitle({ label: "Close family", interval_hours: 168, recipient_member_ids: "[]" }, members, "me")).toBe("Close family");
  });

  it("falls back to interval + recipients when unlabeled", () => {
    expect(switchTitle({ label: "", interval_hours: 336, recipient_member_ids: '["a2"]' }, members, "me")).toBe("2 weeks → Jordan");
  });
});

describe("constants", () => {
  it("exposes a sane week range", () => {
    expect(HOURS_PER_WEEK).toBe(168);
    expect(MIN_WEEKS).toBe(1);
    expect(MAX_WEEKS).toBeGreaterThan(MIN_WEEKS);
  });
});

describe("attachments", () => {
  it("parseAttachmentIds parses a JSON array and degrades junk to []", async () => {
    const { parseAttachmentIds } = await import("../src/logic.js");
    expect(parseAttachmentIds('["f-1","f-2"]')).toEqual(["f-1", "f-2"]);
    expect(parseAttachmentIds(null)).toEqual([]);
    expect(parseAttachmentIds("not json")).toEqual([]);
    expect(parseAttachmentIds('{"a":1}')).toEqual([]);
    expect(parseAttachmentIds('[1, "f-1", null]')).toEqual(["f-1"]);
  });

  it("formatFileSize renders human-readable sizes", async () => {
    const { formatFileSize, MAX_ATTACHMENTS } = await import("../src/logic.js");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(MAX_ATTACHMENTS).toBeGreaterThan(0);
  });
});
