import { describe, it, expect } from "vitest";
import { failureLine, uploadFailureLine, inviteFailureLine } from "../src/logic.js";

const err = (props, message = "hub text") => Object.assign(new Error(message), props);
const words = { action: "save this switch", thing: "switch" };

describe("failureLine", () => {
  it("names a duplicate by code, or by the hub's text while production lags", () => {
    expect(failureLine(err({ status: 400, code: "UNIQUE_CONSTRAINT" }), words)).toBe("That switch already exists.");
    expect(failureLine(err({ status: 400 }, "UNIQUE constraint failed: x.id"), words)).toBe("That switch already exists.");
  });
  it("names a refusal without asking for a retry", () => {
    expect(failureLine(err({ status: 403 }), words)).toBe("You don’t have permission to save this switch.");
    expect(failureLine(err({ status: 507 }), words)).toBe("The household’s storage is full — free up space first.");
    expect(failureLine(err({ status: 429 }), words)).toBe("Too many tries — wait a minute and try again.");
    expect(failureLine(err({ status: 404 }), words)).toBe("This switch has been removed.");
    expect(failureLine(err({ status: 409 }), words)).toBe("This switch was changed by someone else — check it first.");
  });
  it("asks for a retry only when retrying can work", () => {
    for (const e of [err({}), err({ status: 500 }), err({ status: 502 }), err({ status: 400 }), new TypeError("Failed to fetch"), undefined]) {
      expect(failureLine(e, words)).toBe("Couldn’t save this switch — try again.");
    }
  });
  it("keeps a line the app wrote for the user, and never shows hub text", () => {
    const mine = err({ forUser: true }, "This switch no longer exists. Reopen the app to see your switches.");
    expect(failureLine(mine, words)).toBe(mine.message);
    expect(failureLine(err({ status: 500 }, "D1_ERROR: boom"), words)).not.toMatch(/D1_ERROR/);
  });
});

describe("uploadFailureLine", () => {
  it("names what the files endpoint refused", () => {
    expect(uploadFailureLine({ status: 413 })).toBe("That file is too large.");
    expect(uploadFailureLine({ status: 415 })).toBe("That kind of file can’t be uploaded.");
    expect(uploadFailureLine({ status: 507 })).toBe("The household’s storage is full — free up space first.");
    expect(uploadFailureLine({ status: 429 })).toBe("Too many tries — wait a minute and try again.");
  });
  it("asks for a retry when the upload got no answer or the hub failed", () => {
    expect(uploadFailureLine(new TypeError("Failed to fetch"))).toBe("Couldn’t upload the file — try again.");
    expect(uploadFailureLine({ status: 500 })).toBe("Couldn’t upload the file — try again.");
  });
});

describe("inviteFailureLine", () => {
  it("names the invite refusals a member can act on", () => {
    expect(inviteFailureLine({ status: 409, message: "This address has unsubscribed from this household" })).toBe("That address has unsubscribed from this household’s emails.");
    expect(inviteFailureLine({ status: 409, message: "External contact limit reached (50)" })).toBe("The household has reached its limit of external contacts. Remove one that is no longer needed first.");
    expect(inviteFailureLine({ status: 409, code: "unsubscribed", message: "x" })).toBe("That address has unsubscribed from this household’s emails.");
    expect(inviteFailureLine({ status: 409, code: "contact_limit", message: "x" })).toBe("The household has reached its limit of external contacts. Remove one that is no longer needed first.");
    expect(inviteFailureLine({ status: 409, code: "contact_changed", message: "unsubscribed limit" })).toBe("Couldn’t send the invite — try again.");
    // An older hub's codeless 409 falls back to the text, then hedges.
    expect(inviteFailureLine({ status: 409, message: "This contact changed while the invite was being refreshed; retry" })).toBe("Couldn’t send the invite. The address may have unsubscribed, or the household may have reached its limit of email contacts — try again later.");
    expect(inviteFailureLine({ status: 409 })).toBe("Couldn’t send the invite. The address may have unsubscribed, or the household may have reached its limit of email contacts — try again later.");
    expect(inviteFailureLine({ status: 429 })).toBe("The household’s emails for this month are used up — send the invite next month.");
    expect(inviteFailureLine({ status: 403 })).toBe("You don’t have permission to send the invite.");
  });
  it("asks for a retry when the email could not be sent", () => {
    expect(inviteFailureLine({ status: 502 })).toBe("Couldn’t send the invite — try again.");
    expect(inviteFailureLine({ status: 500, message: "Failed to add contact" })).toBe("Couldn’t send the invite — try again.");
    expect(inviteFailureLine(new TypeError("Failed to fetch"))).toBe("Couldn’t send the invite — try again.");
  });
});
