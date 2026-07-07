// Pure helpers for the Check-In Switch app. No DOM, no fetch — unit-testable.

export const HOURS_PER_WEEK = 168;
export const MIN_WEEKS = 1;
export const MAX_WEEKS = 104; // two years — a sane ceiling for the weeks input
export const MAX_SWITCHES = 10; // per member; keeps the list (and email fan-out) bounded

/** Whole weeks → interval hours. */
export function weeksToHours(weeks) {
  return Math.round(Number(weeks) * HOURS_PER_WEEK);
}

/** Interval hours → whole weeks (rounded; the UI only ever stores week multiples). */
export function hoursToWeeks(hours) {
  return Math.max(MIN_WEEKS, Math.round(Number(hours) / HOURS_PER_WEEK));
}

/** "1 week" / "6 weeks" from an interval-hours value. */
export function intervalLabel(hours) {
  const weeks = hoursToWeeks(hours);
  return weeks === 1 ? "1 week" : `${weeks} weeks`;
}

/**
 * Derives the switch's display status.
 * Returns one of:
 *   { state: "disarmed" }
 *   { state: "unstarted" }                       — armed but never checked in
 *   { state: "ok",      deadline, remainingMs }
 *   { state: "due_soon", deadline, remainingMs } — under 25% of the window left
 *   { state: "overdue", deadline, overdueMs }
 */
export function switchStatus(row, now = new Date()) {
  if (!row || Number(row.active) !== 1) return { state: "disarmed" };
  if (!row.last_checkin_at) return { state: "unstarted" };
  const last = new Date(row.last_checkin_at);
  if (Number.isNaN(last.getTime())) return { state: "unstarted" };
  const intervalMs = Number(row.interval_hours) * 3600_000;
  const deadline = new Date(last.getTime() + intervalMs);
  const remainingMs = deadline.getTime() - now.getTime();
  if (remainingMs <= 0) return { state: "overdue", deadline, overdueMs: -remainingMs };
  if (remainingMs < intervalMs * 0.25) return { state: "due_soon", deadline, remainingMs };
  return { state: "ok", deadline, remainingMs };
}

/** "in 3w 2d" / "in 2d 4h" / "in 3h 12m" / "in 40m" — coarse, friendly countdown. */
export function formatRemaining(ms) {
  if (ms <= 0) return "now";
  const minutes = Math.floor(ms / 60_000);
  const weeks = Math.floor(minutes / (7 * 1440));
  const days = Math.floor((minutes % (7 * 1440)) / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (weeks > 0) return `${weeks}w ${days}d`;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Validates a config edit before saving. Returns an error string or null. */
export function validateConfig({ label, intervalWeeks, message, recipientIds }, adults) {
  const weeks = Number(intervalWeeks);
  if (!Number.isInteger(weeks) || weeks < MIN_WEEKS) return "Pick a check-in interval of at least 1 week.";
  if (weeks > MAX_WEEKS) return `Interval can't be longer than ${MAX_WEEKS} weeks.`;
  if (typeof label === "string" && label.length > 60) return "Name is too long (60 characters max).";
  if (typeof message === "string" && message.length > 2000) return "Message is too long (2000 characters max).";
  if (!Array.isArray(recipientIds)) return "Recipients must be a list.";
  const adultIds = new Set((adults ?? []).map(a => a.id));
  const unknown = recipientIds.filter(id => !adultIds.has(id));
  if (unknown.length > 0) return "Recipients must be adult household members.";
  return null;
}

/** Recipients label for the status card: names, or the all-adults default. */
export function recipientsSummary(recipientIds, members, selfId) {
  const byId = new Map((members ?? []).map(m => [m.id, m]));
  const named = (recipientIds ?? []).map(id => byId.get(id)?.name).filter(Boolean);
  if (named.length > 0) return named.join(", ");
  const adults = (members ?? []).filter(m => m.role === "adult" && m.id !== selfId).map(m => m.name);
  return adults.length > 0 ? `${adults.join(", ")} (all adults)` : "No eligible recipients yet";
}

/** Display name for a switch: its label, or a recipients-derived fallback. */
export function switchTitle(row, members, selfId) {
  const label = (row?.label ?? "").trim();
  if (label) return label;
  const recipients = recipientsSummary(JSON.parse(row?.recipient_member_ids || "[]"), members, selfId);
  return `${intervalLabel(row?.interval_hours)} → ${recipients}`;
}
