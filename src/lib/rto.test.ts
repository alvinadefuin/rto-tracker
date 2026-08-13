import { describe, it, expect } from "vitest";
import { computeMonthStats, monthWeekdays, isWeekend } from "./rto";

// Jan 2026: 31 days, starts Thu, 22 weekdays. ceil(0.4*22)=9.
describe("monthWeekdays", () => {
  it("returns 22 weekdays for Jan 2026", () => {
    const days = monthWeekdays(2026, 1);
    expect(days).toHaveLength(22);
    expect(days[0]).toBe("2026-01-01"); // Thu
    expect(days[1]).toBe("2026-01-02"); // Fri
    expect(days[2]).toBe("2026-01-05"); // Mon (skips weekend)
  });
});

describe("isWeekend", () => {
  it("flags Sat/Sun only", () => {
    expect(isWeekend("2026-01-03")).toBe(true); // Sat
    expect(isWeekend("2026-01-04")).toBe(true); // Sun
    expect(isWeekend("2026-01-05")).toBe(false); // Mon
  });
});

describe("computeMonthStats", () => {
  it("empty month: all weekdays eligible, 40% target rounded up", () => {
    const s = computeMonthStats(2026, 1, {});
    expect(s.eligibleDays).toBe(22);
    expect(s.officeDays).toBe(0);
    expect(s.requiredDays).toBe(9); // ceil(8.8)
    expect(s.remainingNeeded).toBe(9);
    expect(s.percent).toBe(0);
  });

  it("holidays and leaves reduce eligible days and the target", () => {
    const s = computeMonthStats(2026, 1, {
      "2026-01-01": "holiday",
      "2026-01-02": "leave",
    });
    expect(s.eligibleDays).toBe(20);
    expect(s.requiredDays).toBe(8); // ceil(0.4*20)
  });

  it("office days count toward percent", () => {
    const s = computeMonthStats(2026, 1, {
      "2026-01-05": "office",
      "2026-01-06": "office",
    });
    expect(s.officeDays).toBe(2);
    expect(s.percent).toBeCloseTo(2 / 22);
    expect(s.remainingNeeded).toBe(7);
  });

  it("ignores weekend entries defensively", () => {
    const s = computeMonthStats(2026, 1, { "2026-01-03": "office" }); // Sat
    expect(s.officeDays).toBe(0);
    expect(s.eligibleDays).toBe(22);
  });

  it("splits weeks at Mon boundaries with partial edges", () => {
    const s = computeMonthStats(2026, 1, {});
    // Jan 2026 starts Thu → first chunk is Thu 1 – Fri 2
    expect(s.weeks[0]).toMatchObject({
      start: "2026-01-01",
      end: "2026-01-02",
      eligibleDays: 2,
      officeDays: 0,
    });
    expect(s.weeks[1].start).toBe("2026-01-05");
    expect(s.weeks.at(-1)!.end).toBe("2026-01-30"); // Fri 30 (31st is Sat)
  });

  it("all days on leave: zero eligible, zero required, percent 0", () => {
    const entries: Record<string, "leave"> = {};
    for (const d of monthWeekdays(2026, 1)) entries[d] = "leave";
    const s = computeMonthStats(2026, 1, entries);
    expect(s.eligibleDays).toBe(0);
    expect(s.requiredDays).toBe(0);
    expect(s.percent).toBe(0); // no divide-by-zero
  });
});
