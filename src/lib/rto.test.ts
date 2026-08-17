import { describe, it, expect } from "vitest";
import {
  computeMonthStats,
  monthWeekdays,
  isWeekend,
  resolvePercent,
  periodsOverlap,
  countMonthsInPeriod,
  formatMonth,
  formatPeriodRange,
  DEFAULT_RTO_PERCENT,
  type TargetPeriod,
} from "./rto";

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

describe("resolvePercent", () => {
  const closed: TargetPeriod[] = [
    { startMonth: "2022-06", endMonth: "2023-12", percent: 20 },
  ];

  it("returns the period percent for a month inside it", () => {
    expect(resolvePercent("2023-03", closed)).toBe(20);
  });

  it("includes both boundary months", () => {
    expect(resolvePercent("2022-06", closed)).toBe(20);
    expect(resolvePercent("2023-12", closed)).toBe(20);
  });

  it("falls back to the default before and after the period", () => {
    expect(resolvePercent("2022-05", closed)).toBe(DEFAULT_RTO_PERCENT);
    expect(resolvePercent("2024-01", closed)).toBe(DEFAULT_RTO_PERCENT);
  });

  it("treats a null endMonth as ongoing", () => {
    const ongoing: TargetPeriod[] = [
      { startMonth: "2026-08", endMonth: null, percent: 25 },
    ];
    expect(resolvePercent("2026-08", ongoing)).toBe(25);
    expect(resolvePercent("2099-01", ongoing)).toBe(25);
    expect(resolvePercent("2026-07", ongoing)).toBe(DEFAULT_RTO_PERCENT);
  });

  it("falls back to the default when there are no periods", () => {
    expect(resolvePercent("2026-08", [])).toBe(DEFAULT_RTO_PERCENT);
  });
});

describe("periodsOverlap", () => {
  const p = (
    startMonth: string,
    endMonth: string | null,
    percent = 20
  ): TargetPeriod => ({ startMonth, endMonth, percent });

  it("is true for identical periods", () => {
    expect(periodsOverlap(p("2022-06", "2023-12"), p("2022-06", "2023-12"))).toBe(
      true
    );
  });

  it("is true when they share exactly one boundary month", () => {
    expect(periodsOverlap(p("2022-06", "2023-12"), p("2023-12", "2024-06"))).toBe(
      true
    );
  });

  it("is false for adjacent periods that do not touch", () => {
    expect(periodsOverlap(p("2022-06", "2023-12"), p("2024-01", "2024-06"))).toBe(
      false
    );
  });

  it("is true when an ongoing period starts before the other ends", () => {
    expect(periodsOverlap(p("2022-06", "2023-12"), p("2023-01", null))).toBe(true);
  });

  it("is false when an ongoing period starts after the other ends", () => {
    expect(periodsOverlap(p("2022-06", "2023-12"), p("2024-01", null))).toBe(
      false
    );
  });

  it("is true when both are ongoing", () => {
    expect(periodsOverlap(p("2022-06", null), p("2030-01", null))).toBe(true);
  });

  it("is order-independent", () => {
    const a = p("2022-06", "2023-12");
    const b = p("2023-01", null);
    expect(periodsOverlap(a, b)).toBe(periodsOverlap(b, a));
  });
});

describe("countMonthsInPeriod", () => {
  it("counts inclusive months for a closed period", () => {
    expect(
      countMonthsInPeriod({
        startMonth: "2022-06",
        endMonth: "2023-12",
        percent: 20,
      })
    ).toBe(19);
  });

  it("counts a single-month period as 1", () => {
    expect(
      countMonthsInPeriod({
        startMonth: "2022-06",
        endMonth: "2022-06",
        percent: 20,
      })
    ).toBe(1);
  });

  it("counts across a year boundary", () => {
    expect(
      countMonthsInPeriod({
        startMonth: "2022-11",
        endMonth: "2023-02",
        percent: 20,
      })
    ).toBe(4);
  });

  it("returns null for an ongoing period", () => {
    expect(
      countMonthsInPeriod({
        startMonth: "2022-06",
        endMonth: null,
        percent: 20,
      })
    ).toBeNull();
  });
});

describe("formatMonth", () => {
  it("renders a YYYY-MM key as an abbreviated month and year", () => {
    expect(formatMonth("2022-06")).toBe("Jun 2022");
    expect(formatMonth("2023-12")).toBe("Dec 2023");
    expect(formatMonth("2026-01")).toBe("Jan 2026");
  });
});

describe("formatPeriodRange", () => {
  it("renders a closed period as a range", () => {
    expect(
      formatPeriodRange({
        startMonth: "2022-06",
        endMonth: "2023-12",
        percent: 20,
      })
    ).toBe("Jun 2022 – Dec 2023");
  });

  it("marks an ongoing period", () => {
    expect(
      formatPeriodRange({
        startMonth: "2022-06",
        endMonth: null,
        percent: 20,
      })
    ).toBe("Jun 2022 – ongoing");
  });
});
