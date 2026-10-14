// Pure helpers for the Check-In Switch app. No DOM, no fetch — unit-testable.

export const HOURS_PER_WEEK = 168;
export const MIN_WEEKS = 1;
export const MAX_WEEKS = 104; // two years — a sane ceiling for the weeks input
export const MAX_SWITCHES = 10; // per member; keeps the list (and email fan-out) bounded
export const MAX_EXTERNAL_RECIPIENTS = 10; // per switch; bounds the external email fan-out
export const MAX_ATTACHMENTS = 10; // per switch; files shared through the trigger link

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Basic email-shape check used before inviting an external contact. */
export function isValidEmail(email) {
  return typeof email === "string" && EMAIL_RE.test(email.trim());
}

/** Trim + lowercase, matching how the hub normalizes external-contact emails. */
export function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

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

/**
 * Validates a config edit before saving. Returns an error string or null.
 * recipientEmails (optional) are external addresses — each must be a valid
 * email; they still require double-opt-in confirmation hub-side before any
 * alert reaches them.
 */
export function validateConfig({ label, intervalWeeks, message, recipientIds, recipientEmails }, adults) {
  const weeks = Number(intervalWeeks);
  if (!Number.isInteger(weeks) || weeks < MIN_WEEKS) return "Pick a check-in interval of at least 1 week.";
  if (weeks > MAX_WEEKS) return `Interval can't be longer than ${MAX_WEEKS} weeks.`;
  if (typeof label === "string" && label.length > 60) return "Name is too long (60 characters max).";
  if (typeof message === "string" && message.length > 2000) return "Message is too long (2000 characters max).";
  if (!Array.isArray(recipientIds)) return "Recipients must be a list.";
  const adultIds = new Set((adults ?? []).map(a => a.id));
  const unknown = recipientIds.filter(id => !adultIds.has(id));
  if (unknown.length > 0) return "Recipients must be adult household members.";
  if (recipientEmails !== undefined) {
    if (!Array.isArray(recipientEmails)) return "External recipients must be a list.";
    if (recipientEmails.length > MAX_EXTERNAL_RECIPIENTS) return `You can add up to ${MAX_EXTERNAL_RECIPIENTS} external contacts per switch.`;
    if (recipientEmails.some(e => !isValidEmail(e))) return "Every external contact must be a valid email address.";
  }
  return null;
}

/**
 * True when this switch names household recipients and NONE of them are still
 * on the roster — every one has left or been removed. This is the state the
 * card has to shout about: the member deliberately chose who to notify, and
 * that choice is now gone.
 */
export function recipientsUnresolved(recipientIds, members) {
  const ids = (recipientIds ?? []).filter(Boolean);
  if (ids.length === 0) return false;
  const known = new Set((members ?? []).map(m => m.id));
  return !ids.some(id => known.has(id));
}

/**
 * Recipients label for the status card: household names (or the all-adults
 * default) plus a count of external contacts.
 *
 * The "(all adults)" wording is reserved for a switch that never named anyone —
 * where falling back to every adult is the setting the member chose. A switch
 * whose named recipients have ALL left the household previously rendered the
 * same text, so the card cheerfully reported "Alerts go to: Jordan (all adults)"
 * about a person the member had never picked, while hiding that the person they
 * did pick was gone. It now says so, and says where the alert will actually go.
 */
export function recipientsSummary(recipientIds, members, selfId, recipientEmails) {
  const byId = new Map((members ?? []).map(m => [m.id, m]));
  const named = (recipientIds ?? []).map(id => byId.get(id)?.name).filter(Boolean);
  const emails = (recipientEmails ?? []).filter(Boolean);
  const externalLabel = emails.length > 0
    ? `${emails.length} external contact${emails.length === 1 ? "" : "s"}`
    : "";
  const adults = (members ?? []).filter(m => m.role === "adult" && m.id !== selfId).map(m => m.name);

  if (recipientsUnresolved(recipientIds, members)) {
    // The hub falls back to household adults here rather than sending nothing
    // (inactivity_alerts on_no_recipients: "adults"), so say that — but never
    // dressed up as the member's own choice.
    const fallback = emails.length > 0
      ? `${externalLabel} only`
      : adults.length > 0
        ? `every adult instead — ${adults.join(", ")}`
        : "nobody — alerts will not send";
    return `⚠️ the people you chose are no longer in this household, so alerts go to ${fallback}`;
  }

  let base;
  if (named.length > 0) {
    base = named.join(", ");
  } else {
    base = adults.length > 0 ? `${adults.join(", ")} (all adults)` : (externalLabel ? "" : "No eligible recipients yet");
  }
  return [base, externalLabel].filter(Boolean).join(" + ");
}

/** Parse a switches row's attachment_file_ids cell into a string array. */
export function parseAttachmentIds(raw) {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    if (Array.isArray(parsed)) return parsed.filter(v => typeof v === "string");
  } catch { /* fall through */ }
  return [];
}

/** "512 B" / "3.4 KB" / "1.2 MB" for the attachment list. */
export function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Display name for a switch: its label, or a recipients-derived fallback. */
export function switchTitle(row, members, selfId) {
  const label = (row?.label ?? "").trim();
  if (label) return label;
  const recipients = recipientsSummary(
    JSON.parse(row?.recipient_member_ids || "[]"),
    members,
    selfId,
    JSON.parse(row?.recipient_emails || "[]"),
  );
  return `${intervalLabel(row?.interval_hours)} → ${recipients}`;
}

/**
 * Whether `me` may read or change the household's external-contact registry.
 *
 * MUST mirror the hub's gate on `api/external-contacts/*`: an admin, or a
 * member whose role is adult. A child or guest is refused with a 403, so the
 * app must not ask on their behalf — the request can only fail, and it lands
 * in the console as an error on every open.
 *
 * @param {object|null} me       `window.__CURRENT_MEMBER`
 * @param {boolean} [isAdmin]    `window.__IS_ADMIN`
 */
export function canManageExternalContacts(me, isAdmin = false) {
  return !!me && (isAdmin === true || me.role === "adult");
}

/**
 * The line a failed write shows, from the error's status — never the hub's
 * text. "Try again" only where trying again can work.
 */
export function failureLine(e, { action, thing } = {}) {
  if (e?.forUser) return e.message;
  if (e?.code === "UNIQUE_CONSTRAINT" || /UNIQUE constraint failed/i.test(String(e?.message ?? ""))) return `That ${thing} already exists.`;
  if (e?.status === 403) return `You don’t have permission to ${action}.`;
  if (e?.status === 507) return "The household’s storage is full — free up space first.";
  if (e?.status === 429) return "Too many tries — wait a minute and try again.";
  if (e?.status === 404) return `This ${thing} has been removed.`;
  if (e?.status === 409) return `This ${thing} was changed by someone else — check it first.`;
  return `Couldn’t ${action} — try again.`;
}

/** A file the files endpoint refused: 413 too large, 415 a type it will not
 *  store; the rest (429, 507, …) follow the table. */
export function uploadFailureLine(e) {
  if (e?.status === 413) return "That file is too large.";
  if (e?.status === 415) return "That kind of file can’t be uploaded.";
  return failureLine(e, { action: "upload the file", thing: "file" });
}

/**
 * An external-contact invite the hub refused. Its 409 names the refusal with
 * `code`: `unsubscribed`, `contact_limit`, or `contact_changed` (a lost race
 * with another invite; retrying works); any other failure is a 500. An older
 * hub answered 409 with no `code` for every throw of the invite, so a codeless
 * 409 is told apart by the error's text (only to pick a line, never shown) and
 * any other codeless 409 hedges. Its 429 is the monthly email allowance; the
 * rest follow the table.
 */
export function inviteFailureLine(e) {
  const text = String(e?.message ?? "");
  const unsubscribed = "That address has unsubscribed from this household’s emails.";
  const atLimit = "The household has reached its limit of external contacts. Remove one that is no longer needed first.";
  if (e?.code === "unsubscribed") return unsubscribed;
  if (e?.code === "contact_limit") return atLimit;
  if (e?.code === "contact_changed") return "Couldn’t send the invite — try again.";
  if (e?.status === 409 && !e?.code && /unsubscribed/i.test(text)) return unsubscribed;
  if (e?.status === 409 && !e?.code && /limit/i.test(text)) return atLimit;
  if (e?.status === 409 && !e?.code) return "Couldn’t send the invite. The address may have unsubscribed, or the household may have reached its limit of email contacts — try again later.";
  if (e?.status === 409) return "Couldn’t send the invite — try again.";
  if (e?.status === 429) return "The household’s emails for this month are used up — send the invite next month.";
  return failureLine(e, { action: "send the invite", thing: "contact" });
}
