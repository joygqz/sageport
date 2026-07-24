import { describe, expect, it } from "vitest";

import { isValidCron, nextCronTime, parseCron } from "./cron";

describe("parseCron", () => {
  it("accepts common expressions", () => {
    for (const expr of [
      "* * * * *",
      "0 3 * * *",
      "0 */6 * * *",
      "0 9 * * 1-5",
      "*/15 0-6 1,15 * 0",
      "0 0 * * 7",
    ]) {
      expect(isValidCron(expr), expr).toBe(true);
    }
  });

  it("rejects malformed expressions", () => {
    for (const expr of [
      "",
      "* * * *",
      "* * * * * *",
      "60 * * * *",
      "* 24 * * *",
      "* * 0 * *",
      "* * * 13 *",
      "* * * * 8",
      "*/0 * * * *",
      "5-1 * * * *",
      "abc * * * *",
      "5/10 * * * *",
      "* * * * 1-",
    ]) {
      expect(isValidCron(expr), expr).toBe(false);
    }
  });

  it("treats weekday 7 as Sunday", () => {
    const fields = parseCron("0 0 * * 7");
    expect(fields?.dow.has(0)).toBe(true);
    expect(fields?.dow.has(7)).toBe(false);
  });
});

describe("nextCronTime", () => {
  it("returns the next daily occurrence", () => {
    const from = new Date(2026, 0, 1, 12, 30, 0);
    const next = nextCronTime("0 3 * * *", from);
    expect(next).toEqual(new Date(2026, 0, 2, 3, 0, 0));
  });

  it("fires later the same day when still ahead", () => {
    const from = new Date(2026, 0, 1, 1, 0, 0);
    const next = nextCronTime("0 3 * * *", from);
    expect(next).toEqual(new Date(2026, 0, 1, 3, 0, 0));
  });

  it("advances strictly past an exact boundary", () => {
    const from = new Date(2026, 0, 1, 3, 0, 0);
    const next = nextCronTime("0 3 * * *", from);
    expect(next).toEqual(new Date(2026, 0, 2, 3, 0, 0));
  });

  it("steps across a month boundary", () => {
    const from = new Date(2026, 0, 31, 12, 0, 0);
    const next = nextCronTime("0 3 1 * *", from);
    expect(next).toEqual(new Date(2026, 1, 1, 3, 0, 0));
  });

  it("picks the next matching weekday", () => {
    // 2026-01-01 is a Thursday; next weekday-9am run is the same day at 09:00.
    const from = new Date(2026, 0, 1, 8, 0, 0);
    expect(nextCronTime("0 9 * * 1-5", from)).toEqual(
      new Date(2026, 0, 1, 9, 0, 0),
    );
    // Saturday 2026-01-03 rolls to Monday 2026-01-05.
    const weekend = new Date(2026, 0, 3, 10, 0, 0);
    expect(nextCronTime("0 9 * * 1-5", weekend)).toEqual(
      new Date(2026, 0, 5, 9, 0, 0),
    );
  });

  it("unions day-of-month and day-of-week when both are restricted", () => {
    // Fires on the 15th OR any Monday.
    const from = new Date(2026, 0, 1, 0, 0, 0); // Thursday
    expect(nextCronTime("0 0 15 * 1", from)).toEqual(
      new Date(2026, 0, 5, 0, 0, 0), // first Monday
    );
  });

  it("returns null when a schedule never fires", () => {
    expect(nextCronTime("0 0 30 2 *", new Date(2026, 0, 1))).toBeNull();
    expect(nextCronTime("not a cron", new Date(2026, 0, 1))).toBeNull();
  });
});
