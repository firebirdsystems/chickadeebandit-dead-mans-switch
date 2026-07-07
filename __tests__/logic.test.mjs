import { describe, it, expect } from "vitest";
import {
  INTERVAL_OPTIONS, intervalLabel, switchStatus, formatRemaining,
  validateConfig, recipientsSummary,
} from "../src/logic.js";

const now = new Date("2026-07-07T12:00:00Z");

describe("switchStatus", () => {
  const base = { active: 1, interval_hours: 24, last_checkin_at: "2026-07-07T00:00:00Z" };

  it("disarmed / unstarted", () => {
    expect(switchStatus(null, now).state).toBe("disarmed");
    expect(switchStatus({ ...base, active: 0 }, now).state).toBe("disarmed");
    expect(switchStatus({ ...base, last_checkin_at: null }, now).state).toBe("unstarted");
    expect(switchStatus({ ...base, last_checkin_at: "garbage" }, now).state).toBe("unstarted");
  });

  it("ok with time remaining", () => {
    const s = switchStatus(base, now); // 12h elapsed of 24h
    expect(s.state).toBe("ok");
    expect(s.remainingMs).toBe(12 * 3600_000);
  });

  it("due_soon inside the last quarter of the window", () => {
    const s = switchStatus({ ...base, last_checkin_at: "2026-07-06T17:00:00Z" }, now); // 19h elapsed, 5h left
    expect(s.state).toBe("due_soon");
  });

  it("overdue past the deadline", () => {
    const s = switchStatus({ ...base, last_checkin_at: "2026-07-06T00:00:00Z" }, now); // 36h elapsed
    expect(s.state).toBe("overdue");
    expect(s.overdueMs).toBe(12 * 3600_000);
  });
});

describe("formatRemaining", () => {
  it("formats coarse countdowns", () => {
    expect(formatRemaining(0)).toBe("now");
    expect(formatRemaining(40 * 60_000)).toBe("40m");
    expect(formatRemaining(3 * 3600_000 + 12 * 60_000)).toBe("3h 12m");
    expect(formatRemaining(2 * 24 * 3600_000 + 4 * 3600_000)).toBe("2d 4h");
  });
});

describe("validateConfig", () => {
  const adults = [{ id: "a1", role: "adult" }, { id: "a2", role: "adult" }];

  it("accepts a sane config", () => {
    expect(validateConfig({ intervalHours: 72, message: "hi", recipientIds: ["a1"] }, adults)).toBeNull();
    expect(validateConfig({ intervalHours: 24, message: "", recipientIds: [] }, adults)).toBeNull();
  });

  it("rejects bad intervals, oversize messages, and non-adult recipients", () => {
    expect(validateConfig({ intervalHours: 0, message: "", recipientIds: [] }, adults)).toMatch(/interval/);
    expect(validateConfig({ intervalHours: 24, message: "x".repeat(2001), recipientIds: [] }, adults)).toMatch(/too long/);
    expect(validateConfig({ intervalHours: 24, message: "", recipientIds: ["kid-1"] }, adults)).toMatch(/adult/);
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
});

describe("interval options", () => {
  it("labels every option and echoes unknown hour counts", () => {
    for (const o of INTERVAL_OPTIONS) expect(intervalLabel(o.hours)).toBe(o.label);
    expect(intervalLabel(7)).toBe("7 hours");
  });
});
