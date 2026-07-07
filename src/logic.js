// Pure helpers for the Check-In Switch app. No DOM, no fetch — unit-testable.

export const INTERVAL_OPTIONS = [
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "1 day" },
  { hours: 48, label: "2 days" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
  { hours: 336, label: "2 weeks" },
];

export function intervalLabel(hours) {
  const opt = INTERVAL_OPTIONS.find(o => o.hours === Number(hours));
  if (opt) return opt.label;
  return `${hours} hours`;
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

/** "in 2d 4h" / "in 3h 12m" / "in 40m" — coarse, friendly countdown. */
export function formatRemaining(ms) {
  if (ms <= 0) return "now";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Validates a config edit before saving. Returns an error string or null. */
export function validateConfig({ intervalHours, message, recipientIds }, adults) {
  const hours = Number(intervalHours);
  if (!Number.isFinite(hours) || hours < 1) return "Pick a check-in interval.";
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
