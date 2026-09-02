import { describe, it, expect } from "vitest";
import {
  computeMonthStats,
  monthWeekdays,
  isWeekend,
  resolvePercent,
  periodsOverlap,
  countMonthsInPeriod,
  countWeekdaysInMandate,
  formatMonth,
  formatPeriodRange,
  formatFinancialYear,
  formatDate,
  formatMandateRange,
  formatDays,
  isValidDateKey,
  toMonthKey,
  DEFAULT_RTO_PERCENT,
  isMandated,
  mandatesOverlap,
  isEligible,
  financialYearOf,
  financialYearBounds,
  shiftMonthKey,
  monthsBetween,
  mandateTouchesMonth,
  aggregateMonths,
  fyWindowStart,
  computeFyStats,
  fyFillPercent,
  fyVerdict,
  monthMeter,
  type Entries,
  type TargetPeriod,
  type WfhMandate,
  type FyBaseline,
  type MonthsAggregate,
  type FyStats,
  type MonthStats,
} from "./rto";

// Jan 2026: 31 days, starts Thu, 22 weekdays. 22 × 40% = 8.8.
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
  it("empty month: all weekdays eligible, 40% target un-rounded", () => {
    const s = computeMonthStats(2026, 1, {});
    expect(s.eligibleDays).toBe(22);
    expect(s.officeDays).toBe(0);
    expect(s.requiredPoints).toBe(22 * 40);
    expect(formatDays(s.requiredPoints)).toBe("8.8");
    expect(formatDays(s.remainingPoints)).toBe("8.8");
    expect(s.achievedPercent).toBe(0);
  });

  it("holidays and leaves reduce eligible days and the target", () => {
    const s = computeMonthStats(2026, 1, {
      "2026-01-01": "holiday",
      "2026-01-02": "leave",
    });
    expect(s.eligibleDays).toBe(20);
    expect(s.requiredPoints).toBe(20 * 40); // 20 × 40% = 8 days exactly
  });

  it("office days count toward percent", () => {
    const s = computeMonthStats(2026, 1, {
      "2026-01-05": "office",
      "2026-01-06": "office",
    });
    expect(s.officeDays).toBe(2);
    expect(s.achievedPercent).toBe(9); // round(9.09)
    expect(formatDays(s.remainingPoints)).toBe("6.8");
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
    expect(s.requiredPoints).toBe(0);
    expect(s.achievedPercent).toBe(0); // no divide-by-zero
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

describe("computeMonthStats target rate", () => {
  it("defaults to the 40% requirement", () => {
    const s = computeMonthStats(2026, 1, {});
    expect(s.targetPercent).toBe(DEFAULT_RTO_PERCENT);
    expect(formatDays(s.requiredPoints)).toBe("8.8");
  });

  it("applies an explicit reduced rate", () => {
    const s = computeMonthStats(2026, 1, {}, 20);
    expect(s.targetPercent).toBe(20);
    expect(formatDays(s.requiredPoints)).toBe("4.4");
    expect(formatDays(s.remainingPoints)).toBe("4.4");
  });

  it("treats a 0% rate as no requirement", () => {
    const s = computeMonthStats(2026, 1, {}, 0);
    expect(s.requiredPoints).toBe(0);
    expect(s.remainingPoints).toBe(0);
  });

  it("reports achievedPercent as a whole number", () => {
    const s = computeMonthStats(2026, 1, { "2026-01-05": "office" });
    expect(s.achievedPercent).toBe(5); // round(1/22 * 100) = 5
  });
});

describe("isMandated", () => {
  const closed: WfhMandate[] = [
    { startDate: "2026-08-12", endDate: "2026-08-20" },
  ];

  it("is true for a date inside a closed mandate", () => {
    expect(isMandated("2026-08-17", closed)).toBe(true);
  });

  it("includes both boundary dates", () => {
    expect(isMandated("2026-08-12", closed)).toBe(true);
    expect(isMandated("2026-08-20", closed)).toBe(true);
  });

  it("is false one day either side", () => {
    expect(isMandated("2026-08-11", closed)).toBe(false);
    expect(isMandated("2026-08-21", closed)).toBe(false);
  });

  it("treats a null endDate as until further notice", () => {
    const ongoing: WfhMandate[] = [
      { startDate: "2026-08-12", endDate: null },
    ];
    expect(isMandated("2026-08-12", ongoing)).toBe(true);
    expect(isMandated("2099-01-01", ongoing)).toBe(true);
    expect(isMandated("2026-08-11", ongoing)).toBe(false);
  });

  it("is false when there are no mandates", () => {
    expect(isMandated("2026-08-17", [])).toBe(false);
  });

  it("matches any mandate in the list", () => {
    const two: WfhMandate[] = [
      { startDate: "2026-03-02", endDate: "2026-03-06" },
      { startDate: "2026-08-12", endDate: null },
    ];
    expect(isMandated("2026-03-04", two)).toBe(true);
    expect(isMandated("2026-08-31", two)).toBe(true);
    expect(isMandated("2026-05-04", two)).toBe(false);
  });

  it("ignores the reason field", () => {
    expect(
      isMandated("2026-08-17", [
        { startDate: "2026-08-12", endDate: null, reason: "flood incident" },
      ])
    ).toBe(true);
  });
});

describe("mandatesOverlap", () => {
  const m = (startDate: string, endDate: string | null): WfhMandate => ({
    startDate,
    endDate,
  });

  it("is true for identical mandates", () => {
    expect(
      mandatesOverlap(m("2026-08-12", "2026-08-20"), m("2026-08-12", "2026-08-20"))
    ).toBe(true);
  });

  it("is true when they share exactly one boundary day", () => {
    expect(
      mandatesOverlap(m("2026-08-12", "2026-08-20"), m("2026-08-20", "2026-08-25"))
    ).toBe(true);
  });

  it("is false for adjacent mandates that do not touch", () => {
    expect(
      mandatesOverlap(m("2026-08-12", "2026-08-20"), m("2026-08-21", "2026-08-25"))
    ).toBe(false);
  });

  it("is true when an open-ended mandate starts before the other ends", () => {
    expect(
      mandatesOverlap(m("2026-08-12", "2026-08-20"), m("2026-08-15", null))
    ).toBe(true);
  });

  it("is false when an open-ended mandate starts after the other ends", () => {
    expect(
      mandatesOverlap(m("2026-08-12", "2026-08-20"), m("2026-08-21", null))
    ).toBe(false);
  });

  it("is true when both are open-ended", () => {
    expect(mandatesOverlap(m("2026-08-12", null), m("2030-01-01", null))).toBe(
      true
    );
  });

  it("is order-independent", () => {
    const a = m("2026-08-12", "2026-08-20");
    const b = m("2026-08-15", null);
    expect(mandatesOverlap(a, b)).toBe(mandatesOverlap(b, a));
  });
});

describe("countWeekdaysInMandate", () => {
  it("counts weekdays inclusively, skipping the weekend", () => {
    // Wed 12 Aug 2026 – Thu 20 Aug: 12,13,14,17,18,19,20 = 7 weekdays
    expect(
      countWeekdaysInMandate({
        startDate: "2026-08-12",
        endDate: "2026-08-20",
      })
    ).toBe(7);
  });

  it("counts a single weekday as 1", () => {
    expect(
      countWeekdaysInMandate({
        startDate: "2026-08-12", // Wed
        endDate: "2026-08-12",
      })
    ).toBe(1);
  });

  it("counts a Sat-Sun span as 0", () => {
    expect(
      countWeekdaysInMandate({
        startDate: "2026-08-15", // Sat
        endDate: "2026-08-16", // Sun
      })
    ).toBe(0);
  });

  it("counts a full Mon-Sun week as 5", () => {
    expect(
      countWeekdaysInMandate({
        startDate: "2026-08-17", // Mon
        endDate: "2026-08-23", // Sun
      })
    ).toBe(5);
  });

  it("counts across a month boundary", () => {
    // Mon 31 Aug 2026 + Tue 1 Sep + Wed 2 Sep
    expect(
      countWeekdaysInMandate({
        startDate: "2026-08-31",
        endDate: "2026-09-02",
      })
    ).toBe(3);
  });

  it("counts across a year boundary", () => {
    // Wed 30 Dec 2026, Thu 31 Dec, Fri 1 Jan 2027 (Sat 2, Sun 3 skipped), Mon 4
    expect(
      countWeekdaysInMandate({
        startDate: "2026-12-30",
        endDate: "2027-01-04",
      })
    ).toBe(4);
  });

  it("returns null for an open-ended mandate", () => {
    expect(
      countWeekdaysInMandate({ startDate: "2026-08-12", endDate: null })
    ).toBeNull();
  });
});

describe("formatDate", () => {
  it("renders a YYYY-MM-DD key as day, abbreviated month, year", () => {
    expect(formatDate("2026-08-12")).toBe("12 Aug 2026");
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDate("2027-12-31")).toBe("31 Dec 2027");
  });

  it("strips the leading zero from the day", () => {
    expect(formatDate("2026-08-05")).toBe("5 Aug 2026");
  });
});

describe("formatMandateRange", () => {
  it("renders a closed mandate as a range", () => {
    expect(
      formatMandateRange({ startDate: "2026-08-12", endDate: "2026-08-20" })
    ).toBe("12 Aug 2026 – 20 Aug 2026");
  });

  it("marks an open-ended mandate as until further notice", () => {
    expect(
      formatMandateRange({ startDate: "2026-08-12", endDate: null })
    ).toBe("12 Aug 2026 – until further notice");
  });
});

describe("isValidDateKey", () => {
  it("accepts a real calendar day", () => {
    expect(isValidDateKey("2026-08-12")).toBe(true);
    expect(isValidDateKey("2026-02-28")).toBe(true);
  });

  it("accepts a real leap day", () => {
    expect(isValidDateKey("2024-02-29")).toBe(true);
  });

  // Guards the century rule against a future hand-rolled "% 4" replacement:
  // today it rides on Date.UTC's calendar math and cannot get this wrong.
  it("applies the century leap-year rule", () => {
    expect(isValidDateKey("2000-02-29")).toBe(true); // divisible by 400
    expect(isValidDateKey("1900-02-29")).toBe(false); // by 100, not 400
  });

  it("rejects a day that does not exist in that month", () => {
    expect(isValidDateKey("2026-02-30")).toBe(false);
    expect(isValidDateKey("2026-02-29")).toBe(false); // 2026 is not a leap year
    expect(isValidDateKey("2026-04-31")).toBe(false);
  });

  it("rejects an out-of-range month or day", () => {
    expect(isValidDateKey("2026-13-01")).toBe(false);
    expect(isValidDateKey("2026-00-10")).toBe(false);
    expect(isValidDateKey("2026-08-32")).toBe(false);
    expect(isValidDateKey("2026-08-00")).toBe(false);
  });

  it("rejects anything that is not a zero-padded YYYY-MM-DD key", () => {
    expect(isValidDateKey("")).toBe(false);
    expect(isValidDateKey("2026-8-12")).toBe(false);
    expect(isValidDateKey("2026-08")).toBe(false);
    expect(isValidDateKey("12/08/2026")).toBe(false);
    expect(isValidDateKey("2026-08-12T00:00:00Z")).toBe(false);
  });
});

describe("isEligible", () => {
  const none: WfhMandate[] = [];
  const mandate: WfhMandate[] = [{ startDate: "2026-08-12", endDate: null }];

  it("counts an untouched weekday", () => {
    expect(isEligible("2026-08-11", {}, none)).toBe(true);
  });

  it("counts an office day", () => {
    expect(isEligible("2026-08-11", { "2026-08-11": "office" }, none)).toBe(true);
  });

  it("excludes leave and holiday", () => {
    expect(isEligible("2026-08-11", { "2026-08-11": "leave" }, none)).toBe(false);
    expect(isEligible("2026-08-11", { "2026-08-11": "holiday" }, none)).toBe(
      false
    );
  });

  it("excludes a mandated day with no status", () => {
    expect(isEligible("2026-08-12", {}, mandate)).toBe(false);
  });

  it("excludes a mandated day even when stamped as office", () => {
    expect(isEligible("2026-08-12", { "2026-08-12": "office" }, mandate)).toBe(
      false
    );
  });

  it("excludes a mandated day also marked as leave", () => {
    expect(isEligible("2026-08-12", { "2026-08-12": "leave" }, mandate)).toBe(
      false
    );
  });
});

// Aug 2026: 21 weekdays. A mandate from Wed 12 Aug covers 14 of them,
// leaving 7 eligible → 7 × 40% = 2.8 required.
describe("computeMonthStats with mandates", () => {
  const fromAug12: WfhMandate[] = [{ startDate: "2026-08-12", endDate: null }];

  it("scores an unmandated August at full strength", () => {
    const s = computeMonthStats(2026, 8, {});
    expect(s.eligibleDays).toBe(21);
    expect(formatDays(s.requiredPoints)).toBe("8.4");
    expect(s.mandatedDays).toBe(0);
  });

  it("prorates a partially mandated month", () => {
    const s = computeMonthStats(2026, 8, {}, DEFAULT_RTO_PERCENT, fromAug12);
    expect(s.eligibleDays).toBe(7);
    expect(s.mandatedDays).toBe(14);
    expect(formatDays(s.requiredPoints)).toBe("2.8");
    expect(formatDays(s.remainingPoints)).toBe("2.8");
  });

  it("counts office days before the mandate normally", () => {
    const s = computeMonthStats(
      2026,
      8,
      { "2026-08-03": "office", "2026-08-04": "office" },
      DEFAULT_RTO_PERCENT,
      fromAug12
    );
    expect(s.officeDays).toBe(2);
    expect(formatDays(s.remainingPoints)).toBe("0.8");
    expect(s.achievedPercent).toBe(29); // round(2/7 * 100)
  });

  it("reports no requirement for a fully mandated month", () => {
    const all: WfhMandate[] = [
      { startDate: "2026-09-01", endDate: "2026-09-30" },
    ];
    const s = computeMonthStats(2026, 9, {}, DEFAULT_RTO_PERCENT, all);
    expect(s.eligibleDays).toBe(0);
    expect(s.requiredPoints).toBe(0);
    expect(s.remainingPoints).toBe(0);
    expect(s.achievedPercent).toBe(0);
    expect(s.mandatedDays).toBe(22); // Sep 2026 weekdays
  });

  it("ignores an office stamp inside a mandate", () => {
    const all: WfhMandate[] = [
      { startDate: "2026-09-01", endDate: "2026-09-30" },
    ];
    const s = computeMonthStats(
      2026,
      9,
      { "2026-09-08": "office" },
      DEFAULT_RTO_PERCENT,
      all
    );
    expect(s.officeDays).toBe(0);
    expect(s.achievedPercent).toBe(0); // cannot exceed 100 with 0 eligible
  });

  it("counts a mandated leave day once, as mandated", () => {
    const withLeave = computeMonthStats(
      2026,
      8,
      { "2026-08-13": "leave" },
      DEFAULT_RTO_PERCENT,
      fromAug12
    );
    const without = computeMonthStats(2026, 8, {}, DEFAULT_RTO_PERCENT, fromAug12);
    expect(withLeave.eligibleDays).toBe(without.eligibleDays);
    expect(withLeave.mandatedDays).toBe(without.mandatedDays);
  });

  it("shrinks week denominators, to zero for a fully mandated week", () => {
    const s = computeMonthStats(2026, 8, {}, DEFAULT_RTO_PERCENT, fromAug12);
    // Aug 2026 starts Sat 1, and monthWeekdays drops weekends, so the FIRST
    // chunk is Mon 3 - Fri 7. There is no partial chunk at this month's edge.
    expect(s.weeks[0]).toMatchObject({
      start: "2026-08-03",
      eligibleDays: 5,
      officeDays: 0,
    });
    // Mon 17 - Fri 21 is entirely inside the mandate
    const fullyMandated = s.weeks.find((w) => w.start === "2026-08-17");
    expect(fullyMandated).toMatchObject({ eligibleDays: 0, officeDays: 0 });
  });

  it("splits a week the mandate starts mid-way through", () => {
    const s = computeMonthStats(2026, 8, {}, DEFAULT_RTO_PERCENT, fromAug12);
    // Mon 10 and Tue 11 are eligible; Wed 12 - Fri 14 are mandated
    const transition = s.weeks.find((w) => w.start === "2026-08-10");
    expect(transition).toMatchObject({ eligibleDays: 2, officeDays: 0 });
  });

  it("resumes eligibility after a closed mandate ends", () => {
    // Wed 12 - Fri 14 Aug only: 3 mandated, 18 of August's 21 still eligible
    const shortMandate: WfhMandate[] = [
      { startDate: "2026-08-12", endDate: "2026-08-14" },
    ];
    const s = computeMonthStats(
      2026,
      8,
      { "2026-08-17": "office" },
      DEFAULT_RTO_PERCENT,
      shortMandate
    );
    expect(s.mandatedDays).toBe(3);
    expect(s.eligibleDays).toBe(18);
    expect(formatDays(s.requiredPoints)).toBe("7.2");
    expect(s.officeDays).toBe(1); // Mon 17 is past the mandate, so it counts
  });

  it("scores a month-spanning mandate correctly from both sides", () => {
    // Wed 28 Jan 2026 - Tue 3 Feb: 28,29,30 in Jan (Sat 31 skipped),
    // then 2,3 in Feb (Sun 1 skipped).
    const spanning: WfhMandate[] = [
      { startDate: "2026-01-28", endDate: "2026-02-03" },
    ];
    const jan = computeMonthStats(2026, 1, {}, DEFAULT_RTO_PERCENT, spanning);
    const feb = computeMonthStats(2026, 2, {}, DEFAULT_RTO_PERCENT, spanning);
    expect(jan.mandatedDays).toBe(3);
    expect(jan.eligibleDays).toBe(22 - 3);
    expect(feb.mandatedDays).toBe(2);
    expect(feb.eligibleDays).toBe(20 - 2); // Feb 2026 has 20 weekdays
    // The same mandate array is passed to both months and neither leaks days
    // into the other.
    expect(jan.mandatedDays + feb.mandatedDays).toBe(5);
  });

  it("is a no-op when no mandates are passed", () => {
    const bare = computeMonthStats(2026, 1, {});
    const explicit = computeMonthStats(2026, 1, {}, DEFAULT_RTO_PERCENT, []);
    expect(bare).toEqual(explicit);
    expect(bare.mandatedDays).toBe(0);
  });
});

describe("toMonthKey", () => {
  it("passes a month key through unchanged", () => {
    expect(toMonthKey("2026-08")).toBe("2026-08");
  });

  it("truncates a day key to its month", () => {
    expect(toMonthKey("2026-08-12")).toBe("2026-08");
    expect(toMonthKey("2026-08-01")).toBe("2026-08");
    expect(toMonthKey("2026-12-31")).toBe("2026-12");
  });

  it("rejects an impossible day rather than truncating it", () => {
    // The regex alone would admit this; isValidDateKey is what catches it.
    expect(toMonthKey("2026-02-30")).toBeNull();
  });

  it("rejects a bad month, junk, and empty input", () => {
    expect(toMonthKey("2026-13")).toBeNull();
    expect(toMonthKey("2026-00")).toBeNull();
    expect(toMonthKey("26-08")).toBeNull();
    expect(toMonthKey("august")).toBeNull();
    expect(toMonthKey("")).toBeNull();
  });
});

describe("financialYearOf", () => {
  it("names the FY for the calendar year it ends in", () => {
    // FY2027 runs Aug 2026 - Jul 2027.
    expect(financialYearOf("2026-08")).toBe(2027);
    expect(financialYearOf("2026-12")).toBe(2027);
    expect(financialYearOf("2027-01")).toBe(2027);
    expect(financialYearOf("2027-07")).toBe(2027);
  });

  it("flips at the July/August boundary", () => {
    expect(financialYearOf("2026-07")).toBe(2026);
    expect(financialYearOf("2026-08")).toBe(2027);
    expect(financialYearOf("2027-07")).toBe(2027);
    expect(financialYearOf("2027-08")).toBe(2028);
  });
});

describe("financialYearBounds", () => {
  it("returns August of the previous year through July", () => {
    expect(financialYearBounds(2027)).toEqual({
      startMonth: "2026-08",
      endMonth: "2027-07",
    });
  });

  it("round-trips with financialYearOf at both ends", () => {
    const { startMonth, endMonth } = financialYearBounds(2027);
    expect(financialYearOf(startMonth)).toBe(2027);
    expect(financialYearOf(endMonth)).toBe(2027);
    // One month either side belongs to the neighbouring years.
    expect(financialYearOf("2026-07")).toBe(2026);
    expect(financialYearOf("2027-08")).toBe(2028);
  });
});

describe("shiftMonthKey", () => {
  it("steps forward and back within a year", () => {
    expect(shiftMonthKey("2026-08", 1)).toBe("2026-09");
    expect(shiftMonthKey("2026-08", -1)).toBe("2026-07");
    expect(shiftMonthKey("2026-08", 0)).toBe("2026-08");
  });

  it("crosses year boundaries in both directions", () => {
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
  });

  it("handles multi-year shifts", () => {
    expect(shiftMonthKey("2026-03", -14)).toBe("2025-01");
    expect(shiftMonthKey("2026-03", 24)).toBe("2028-03");
  });

  it("keeps months zero-padded so string comparison stays valid", () => {
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthKey("2026-12", 9)).toBe("2027-09");
  });
});

describe("monthsBetween", () => {
  it("walks inclusively across a year boundary", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("returns a single month when start equals end", () => {
    expect(monthsBetween("2026-08", "2026-08")).toEqual(["2026-08"]);
  });

  it("returns an empty list when start is after end", () => {
    expect(monthsBetween("2026-09", "2026-08")).toEqual([]);
  });

  it("covers a whole financial year in twelve months", () => {
    const { startMonth, endMonth } = financialYearBounds(2027);
    const months = monthsBetween(startMonth, endMonth);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-08");
    expect(months[11]).toBe("2027-07");
  });
});

describe("mandateTouchesMonth", () => {
  it("is true for a mandate contained in the month", () => {
    const m: WfhMandate = { startDate: "2026-08-12", endDate: "2026-08-20" };
    expect(mandateTouchesMonth(m, "2026-08")).toBe(true);
  });

  it("is true for a mandate spanning into the month from either side", () => {
    const before: WfhMandate = { startDate: "2026-07-28", endDate: "2026-08-03" };
    const after: WfhMandate = { startDate: "2026-08-28", endDate: "2026-09-04" };
    expect(mandateTouchesMonth(before, "2026-08")).toBe(true);
    expect(mandateTouchesMonth(after, "2026-08")).toBe(true);
  });

  it("is true on the first and last day of the month", () => {
    const first: WfhMandate = { startDate: "2026-08-01", endDate: "2026-08-01" };
    const last: WfhMandate = { startDate: "2026-08-31", endDate: "2026-08-31" };
    expect(mandateTouchesMonth(first, "2026-08")).toBe(true);
    expect(mandateTouchesMonth(last, "2026-08")).toBe(true);
  });

  it("is false for a mandate wholly before or after the month", () => {
    const before: WfhMandate = { startDate: "2026-07-01", endDate: "2026-07-31" };
    const after: WfhMandate = { startDate: "2026-09-01", endDate: "2026-09-30" };
    expect(mandateTouchesMonth(before, "2026-08")).toBe(false);
    expect(mandateTouchesMonth(after, "2026-08")).toBe(false);
  });

  it("treats a null endDate as reaching every later month", () => {
    const open: WfhMandate = { startDate: "2026-08-12", endDate: null };
    expect(mandateTouchesMonth(open, "2026-08")).toBe(true);
    expect(mandateTouchesMonth(open, "2027-03")).toBe(true);
    expect(mandateTouchesMonth(open, "2026-07")).toBe(false);
  });

  it("handles a short month, where the -31 upper bound is not a real day", () => {
    const feb: WfhMandate = { startDate: "2026-02-27", endDate: "2026-02-28" };
    expect(mandateTouchesMonth(feb, "2026-02")).toBe(true);
  });
});

describe("aggregateMonths", () => {
  // Aug 2026 has 21 weekdays, Sep 2026 has 22.
  const AUG_SEP = ["2026-08", "2026-09"];

  it("sums weighted eligible days at the default rate", () => {
    expect(aggregateMonths(AUG_SEP, {}, [], [])).toEqual({
      officeDays: 0,
      weightedEligible: (21 + 22) * 40,
    });
  });

  it("resolves the percentage per month, not once for the window", () => {
    const periods: TargetPeriod[] = [
      { startMonth: "2026-09", endMonth: "2026-09", percent: 60 },
    ];
    // August falls outside the period and keeps the 40% default.
    expect(aggregateMonths(AUG_SEP, {}, periods, []).weightedEligible).toBe(
      21 * 40 + 22 * 60
    );
  });

  it("counts office days across the whole window", () => {
    const entries: Entries = {
      "2026-08-03": "office", // Mon
      "2026-08-04": "office", // Tue
      "2026-09-01": "office", // Tue
    };
    expect(aggregateMonths(AUG_SEP, entries, [], []).officeDays).toBe(3);
  });

  it("drops leave, holiday and training days from the weighted total", () => {
    const entries: Entries = {
      "2026-08-05": "leave", // Wed
      "2026-08-06": "training", // Thu
      "2026-09-01": "holiday", // Tue
    };
    // August keeps 19 of its 21 weekdays, September 21 of its 22.
    expect(aggregateMonths(AUG_SEP, entries, [], []).weightedEligible).toBe(
      19 * 40 + 21 * 40
    );
  });

  it("contributes nothing for a fully mandated month", () => {
    const mandates: WfhMandate[] = [
      { startDate: "2026-08-01", endDate: "2026-08-31" },
    ];
    // An office stamp inside the mandate is still excluded, exactly as
    // computeMonthStats excludes it.
    const entries: Entries = { "2026-08-03": "office" };
    expect(aggregateMonths(AUG_SEP, entries, [], mandates)).toEqual({
      officeDays: 0,
      weightedEligible: 22 * 40,
    });
  });

  it("returns zeros for an empty month list", () => {
    expect(aggregateMonths([], {}, [], [])).toEqual({
      officeDays: 0,
      weightedEligible: 0,
    });
  });
});

describe("fyWindowStart", () => {
  // Oct 2026 sits in FY2027, which starts Aug 2026.
  const OCT = "2026-10";
  const FY_START = "2026-08";

  it("returns null when nothing was ever recorded", () => {
    expect(fyWindowStart(OCT, FY_START, null)).toBeNull();
  });

  it("returns null when the record starts after the displayed month", () => {
    expect(fyWindowStart(OCT, FY_START, "2026-11")).toBeNull();
  });

  it("counts from the displayed month when the record starts in it", () => {
    expect(fyWindowStart(OCT, FY_START, OCT)).toBe(OCT);
  });

  it("counts from the record's start when it falls inside the FY", () => {
    expect(fyWindowStart(OCT, FY_START, "2026-09")).toBe("2026-09");
  });

  it("counts from the FY's start when the record predates it", () => {
    expect(fyWindowStart(OCT, FY_START, "2025-03")).toBe(FY_START);
    expect(fyWindowStart(OCT, FY_START, FY_START)).toBe(FY_START);
  });
});

describe("computeFyStats", () => {
  // Aug + Sep 2026 fully eligible at 40%: (21 + 22) * 40 = 1720 percent-points.
  const PRIOR_AUG_SEP: MonthsAggregate = {
    officeDays: 23,
    weightedEligible: 1720,
  };

  // Six office days in Oct 2026, all weekdays.
  const OCT_OFFICE: Entries = {
    "2026-10-01": "office",
    "2026-10-02": "office",
    "2026-10-05": "office",
    "2026-10-06": "office",
    "2026-10-07": "office",
    "2026-10-08": "office",
  };

  // Aug 2026 is the FY's own start, so this window is the whole year.
  function baseline(prior: MonthsAggregate): FyBaseline {
    return { windowStartMonth: "2026-08", prior };
  }

  it("derives the year and its bounds from the displayed month", () => {
    const october = computeMonthStats(2026, 10, OCT_OFFICE, 40);
    const fy = computeFyStats("2026-10", baseline(PRIOR_AUG_SEP), october);
    expect(fy.fy).toBe(2027);
    expect(fy.fyStartMonth).toBe("2026-08");
    expect(fy.fyEndMonth).toBe("2027-07");
  });

  it("keeps the FY total un-rounded, never summing per-month round-ups", () => {
    const october = computeMonthStats(2026, 10, OCT_OFFICE, 40);
    const fy = computeFyStats("2026-10", baseline(PRIOR_AUG_SEP), october);
    // 1720 + 22*40 = 2600 percent-points -> exactly 26 days, held as points.
    expect(fy.cumulativeRequiredPoints).toBe(2600);
    // Summing monthly ceils would owe 27: ceil(8.4)+ceil(8.8)+ceil(8.8).
    const monthlySum =
      Math.ceil((21 * 40) / 100) +
      Math.ceil((22 * 40) / 100) +
      Math.ceil((22 * 40) / 100);
    expect(monthlySum).toBe(27);
    expect(fy.cumulativeRequiredPoints).toBeLessThan(monthlySum * 100);
  });

  it("adds the displayed month's office days to the prior window", () => {
    const october = computeMonthStats(2026, 10, OCT_OFFICE, 40);
    const fy = computeFyStats("2026-10", baseline(PRIOR_AUG_SEP), october);
    expect(fy.cumulativeOffice).toBe(29);
    expect(fy.balancePoints).toBe(300);
    expect(fy.remainingNeededPoints).toBe(0);
    expect(fy.fy).toBe(2027);
  });

  it("carries a shortfall forward as days still owed", () => {
    const october = computeMonthStats(2026, 10, OCT_OFFICE, 40);
    const fy = computeFyStats(
      "2026-10",
      baseline({ officeDays: 5, weightedEligible: 1720 }),
      october
    );
    expect(fy.cumulativeOffice).toBe(11);
    expect(fy.cumulativeRequiredPoints).toBe(2600);
    expect(fy.balancePoints).toBe(-1500);
    expect(fy.remainingNeededPoints).toBe(1500);
  });

  it("banks the fraction a whole month worked from home leaves over", () => {
    // 11 required against 20 stamped through June: 9 days banked.
    const prior: MonthsAggregate = { officeDays: 20, weightedEligible: 1100 };
    // Jul 2027 has 22 weekdays and nothing stamped.
    const july = computeMonthStats(2027, 7, {}, 40);
    const fy = computeFyStats("2027-07", baseline(prior), july);
    expect(formatDays(july.requiredPoints)).toBe("8.8"); // the month alone asks for 8.8
    // 1100 + 880, never ceil'd up to 20.
    expect(fy.cumulativeRequiredPoints).toBe(1980);
    expect(fy.cumulativeOffice).toBe(20);
    // The old ceil called this exactly level. The year really owes 19.8, so the
    // twentieth stamp is a 0.2 surplus, and the FY is where it is credited.
    expect(fy.balancePoints).toBe(20);
    expect(fy.remainingNeededPoints).toBe(0);
    expect(fy.isFinalMonth).toBe(true);
  });

  it("flags the final month only in July", () => {
    const june = computeMonthStats(2027, 6, {}, 40);
    const notFinal = computeFyStats(
      "2027-06",
      baseline({ officeDays: 0, weightedEligible: 0 }),
      june
    );
    expect(notFinal.isFinalMonth).toBe(false);
  });

  it("reports a shortfall standing in the final month", () => {
    // 19.8 required through July against 14 stamped: the year ends 5.8 short,
    // where the ceil reported a round 6.
    const july = computeMonthStats(2027, 7, {}, 40);
    const fy = computeFyStats(
      "2027-07",
      baseline({ officeDays: 14, weightedEligible: 1100 }),
      july
    );
    expect(fy.isFinalMonth).toBe(true);
    expect(fy.cumulativeRequiredPoints).toBe(1980);
    expect(fy.balancePoints).toBe(-580);
    expect(fy.remainingNeededPoints).toBe(580);
  });

  it("flags a partial window when tracking began mid-year", () => {
    const october = computeMonthStats(2026, 10, OCT_OFFICE, 40);
    const partial = computeFyStats(
      "2026-10",
      { windowStartMonth: "2026-09", prior: PRIOR_AUG_SEP },
      october
    );
    expect(partial.isPartialWindow).toBe(true);
    expect(partial.windowStartMonth).toBe("2026-09");
    expect(
      computeFyStats("2026-10", baseline(PRIOR_AUG_SEP), october).isPartialWindow
    ).toBe(false);
  });

  it("handles an all-mandated window without dividing by zero", () => {
    const mandates: WfhMandate[] = [
      { startDate: "2026-10-01", endDate: "2026-10-31" },
    ];
    const october = computeMonthStats(2026, 10, {}, 40, mandates);
    const fy = computeFyStats(
      "2026-10",
      baseline({ officeDays: 0, weightedEligible: 0 }),
      october
    );
    expect(fy.cumulativeRequiredPoints).toBe(0);
    expect(fy.cumulativeOffice).toBe(0);
    expect(fy.balancePoints).toBe(0);
    expect(fy.remainingNeededPoints).toBe(0);
  });

  it("leaves the met/not-met boundary exactly where the old ceil put it", () => {
    // 104.4 owed for the year. ceil(104.4) was 105 and 105 whole days is still
    // what clears it — an integer day count cannot land on 104.4. Only the
    // reported magnitude got finer. This is the property the change rests on.
    const july = computeMonthStats(2027, 7, {}, 0); // 0% — contributes nothing
    const at104 = computeFyStats(
      "2027-07",
      baseline({ officeDays: 104, weightedEligible: 10440 }),
      july
    );
    const at105 = computeFyStats(
      "2027-07",
      baseline({ officeDays: 105, weightedEligible: 10440 }),
      july
    );
    expect(at104.remainingNeededPoints).toBe(40); // 0.4 short
    expect(at105.remainingNeededPoints).toBe(0);
    expect(at105.balancePoints).toBe(60); // 0.6 banked, where ceil reported 0
  });

  it(
    "agrees with the old ceil on whether the year is owed, at every count",
    () => {
      // The property the whole change rests on: for an integer day count,
      // `office × 100 ≥ P` is exactly `office ≥ ceil(P / 100)`. Swept across
      // a whole requirement and two fractional ones, and either side of each,
      // so it is asserted rather than argued — this is what keeps
      // owedForYear's colour muting in stats.tsx unchanged.
      const july = computeMonthStats(2027, 7, {}, 0); // 0% — no contribution
      for (const weightedEligible of [10400, 10440, 10499]) {
        for (let officeDays = 100; officeDays <= 110; officeDays++) {
          const fy = computeFyStats(
            "2027-07",
            baseline({ officeDays, weightedEligible }),
            july
          );
          const oldCeilSaidOwed =
            officeDays < Math.ceil(weightedEligible / 100);
          expect(fy.remainingNeededPoints > 0).toBe(oldCeilSaidOwed);
        }
      }
    }
  );

  it(
    "reports a part-day shortfall rather than rounding it to a whole day",
    () => {
      // August: 13 eligible at 40% is 5.2 owed, 5 stamped. Viewed from
      // September, the year says 0.2 — the number the month card showed, not
      // a whole day.
      // 0% — no contribution
      const september = computeMonthStats(2026, 9, {}, 0);
      const fy = computeFyStats(
        "2026-09",
        baseline({ officeDays: 5, weightedEligible: 520 }),
        september
      );
      expect(fy.cumulativeRequiredPoints).toBe(520);
      expect(fy.balancePoints).toBe(-20);
      expect(formatDays(fy.remainingNeededPoints)).toBe("0.2");
    }
  );
});

// Shared by describe("fyVerdict") and describe("fyFillPercent") below — both
// exercise FyStats-shaped fixtures, and a single stats() keeps their defaults
// (a 3-day surplus, FY2027, a whole month behind it) from drifting apart.
function stats(overrides: Partial<FyStats> = {}): FyStats {
  return {
    fy: 2027,
    fyStartMonth: "2026-08",
    fyEndMonth: "2027-07",
    windowStartMonth: "2026-08",
    isPartialWindow: false,
    isFinalMonth: false,
    cumulativeOffice: 29,
    cumulativeRequiredPoints: 2600,
    balancePoints: 300,
    remainingNeededPoints: 0,
    ...overrides,
  };
}

// Only the remaining figure is read; the rest is filler to make a whole
// MonthStats. officeDays and remainingPoints are kept consistent with
// requiredPoints so the fixture cannot describe a month that
// computeMonthStats could never produce.
function month(remainingDays: number): MonthStats {
  return {
    eligibleDays: 22,
    officeDays: 11 - remainingDays,
    requiredPoints: 1100,
    remainingPoints: remainingDays * 100,
    targetPercent: 50,
    achievedPercent: 0,
    mandatedDays: 0,
    weeks: [],
  };
}

describe("fyVerdict", () => {
  it("says nothing was required without blaming a mandate", () => {
    expect(
      fyVerdict(
        stats({
          cumulativeRequiredPoints: 0,
          cumulativeOffice: 0,
          balancePoints: 0,
        }),
        month(0)
      )
    ).toBe("No requirement — the year owes nothing.");
  });

  it("reports a surplus banked against a zero requirement", () => {
    // A 0% period, or a month of leave: nothing was required, yet days were
    // stamped. The surplus is the news, not the absent requirement.
    expect(
      fyVerdict(
        stats({
          cumulativeRequiredPoints: 0,
          cumulativeOffice: 3,
          balancePoints: 300,
        }),
        month(0)
      )
    ).toBe("3 days ahead — banked toward later months.");
  });

  it("reports a surplus against the whole year in July", () => {
    expect(fyVerdict(stats({ isFinalMonth: true }), month(0))).toBe(
      "3 days ahead — FY2027 fully covered."
    );
  });

  it("covers the year on a sub-day surplus in July", () => {
    // 19.8 owed, 20 stamped: the year is covered by 0.2, which the old ceil
    // reported as exactly level.
    expect(
      fyVerdict(
        stats({
          balancePoints: 20,
          cumulativeOffice: 20,
          cumulativeRequiredPoints: 1980,
          isFinalMonth: true,
        }),
        month(0)
      )
    ).toBe("0.2 days ahead — FY2027 fully covered.");
  });

  it("says the surplus covers the month's remaining days", () => {
    expect(fyVerdict(stats(), month(3))).toBe(
      "3 days ahead — this month's 3 remaining days are covered."
    );
  });

  it("banks a surplus when the month is already covered", () => {
    expect(fyVerdict(stats(), month(0))).toBe(
      "3 days ahead — banked toward later months."
    );
  });

  it("reports the whole year covered exactly in July", () => {
    expect(
      fyVerdict(
        stats({ balancePoints: 0, isFinalMonth: true, cumulativeOffice: 26 }),
        month(0)
      )
    ).toBe("Level — FY2027 covered exactly.");
  });

  it("reports being level mid-year", () => {
    expect(
      fyVerdict(stats({ balancePoints: 0, cumulativeOffice: 26 }), month(0))
    ).toBe("Level — no days banked.");
  });

  it("reports a shortfall against the whole year in July", () => {
    expect(
      fyVerdict(
        stats({ balancePoints: -200, isFinalMonth: true, cumulativeOffice: 24 }),
        month(0)
      )
    ).toBe("2 office days short of FY2027's full year.");
  });

  // isFinalMonth means only that the displayed month is July, and nothing in
  // fyVerdict reads a clock — so a July years from now lands in the same
  // branch. It must not condemn a year that has not happened.
  it("reads a future July as short of the full year, not as a failed one", () => {
    const verdict = fyVerdict(
      stats({
        fy: 2031,
        fyStartMonth: "2030-08",
        fyEndMonth: "2031-07",
        windowStartMonth: "2030-08",
        isFinalMonth: true,
        cumulativeOffice: 0,
        cumulativeRequiredPoints: 10300,
        balancePoints: -10300,
        remainingNeededPoints: 10300,
      }),
      month(9)
    );
    expect(verdict).toBe("103 office days short of FY2031's full year.");
    expect(verdict).not.toContain("not met");
  });

  it("asks for the shortfall mid-year", () => {
    expect(
      fyVerdict(
        stats({
          balancePoints: -200,
          cumulativeOffice: 24,
          remainingNeededPoints: 200,
        }),
        month(2)
      )
    ).toBe("2 more office days needed to be level.");
  });

  it("qualifies a year-naming claim made from a partial window", () => {
    const partial = { isPartialWindow: true, windowStartMonth: "2027-06" };
    expect(
      fyVerdict(stats({ ...partial, isFinalMonth: true }), month(0))
    ).toBe("3 days ahead — FY2027 fully covered (counted from Jun 2027).");
    expect(
      fyVerdict(
        stats({
          ...partial,
          isFinalMonth: true,
          balancePoints: -200,
          cumulativeOffice: 24,
        }),
        month(0)
      )
    ).toBe(
      "2 office days short of FY2027's full year (counted from Jun 2027)."
    );
    expect(
      fyVerdict(
        stats({
          ...partial,
          isFinalMonth: true,
          balancePoints: 0,
          cumulativeOffice: 26,
        }),
        month(0)
      )
    ).toBe("Level — FY2027 covered exactly (counted from Jun 2027).");
  });

  it("leaves mid-year sentences unqualified — they name no year", () => {
    const partial = { isPartialWindow: true, windowStartMonth: "2026-09" };
    expect(fyVerdict(stats(partial), month(0))).toBe(
      "3 days ahead — banked toward later months."
    );
    expect(
      fyVerdict(
        stats({ ...partial, balancePoints: -200, cumulativeOffice: 24 }),
        month(2)
      )
    ).toBe("2 more office days needed to be level.");
  });

  it("uses singular forms for one day", () => {
    expect(
      fyVerdict(stats({ balancePoints: 100, cumulativeOffice: 27 }), month(1))
    ).toBe("1 day ahead — this month's 1 remaining day is covered.");
    expect(
      fyVerdict(
        stats({
          balancePoints: -100,
          cumulativeOffice: 25,
          remainingNeededPoints: 100,
        }),
        month(1)
      )
    ).toBe("1 more office day needed to be level.");
    expect(
      fyVerdict(
        stats({
          balancePoints: -100,
          cumulativeOffice: 25,
          remainingNeededPoints: 100,
          isFinalMonth: true,
        }),
        month(1)
      )
    ).toBe("1 office day short of FY2027's full year.");
  });

  it("renders a part-day shortfall without float residue", () => {
    const m: MonthStats = {
      eligibleDays: 13,
      officeDays: 5,
      requiredPoints: 520,
      remainingPoints: 20,
      targetPercent: 40,
      achievedPercent: 38,
      mandatedDays: 6,
      weeks: [],
    };
    const verdict = fyVerdict(stats(), m); // stats() defaults to balance 3
    expect(verdict).toBe(
      "3 days ahead — this month's 0.2 remaining days are covered."
    );
    expect(verdict).not.toContain("0.2000");
  });

  // Through month(), not a hand-rolled literal: the helper exists so a fixture
  // cannot describe a month computeMonthStats could never produce, and going
  // around it re-opens that door.
  it("keeps the singular for exactly one remaining day", () => {
    expect(fyVerdict(stats(), month(1))).toBe(
      "3 days ahead — this month's 1 remaining day is covered."
    );
  });

  it("reports a part-day shortfall exactly", () => {
    expect(
      fyVerdict(
        stats({
          balancePoints: -20,
          cumulativeOffice: 5,
          cumulativeRequiredPoints: 520,
          remainingNeededPoints: 20,
        }),
        month(0)
      )
    ).toBe("0.2 more office days needed to be level.");
  });

  it("reports a part-day surplus rather than calling the year level", () => {
    // 19.8 owed, 20 stamped. The ceil said "Level — no days banked."
    expect(
      fyVerdict(
        stats({
          balancePoints: 20,
          cumulativeOffice: 20,
          cumulativeRequiredPoints: 1980,
        }),
        month(0)
      )
    ).toBe("0.2 days ahead — banked toward later months.");
  });

  it("counts a multi-day fraction in the plural", () => {
    // dayCount is private, so its singular rule is asserted through the copy.
    // 250 points is 2.5 days — plural, like 20, where only 100 is singular.
    expect(
      fyVerdict(
        stats({
          balancePoints: 250,
          cumulativeOffice: 12,
          cumulativeRequiredPoints: 950,
        }),
        month(0)
      )
    ).toBe("2.5 days ahead — banked toward later months.");
  });

  it("reports a part-day shortfall against the whole year in July", () => {
    expect(
      fyVerdict(
        stats({
          balancePoints: -40,
          cumulativeOffice: 104,
          cumulativeRequiredPoints: 10440,
          remainingNeededPoints: 40,
          isFinalMonth: true,
        }),
        month(0)
      )
    ).toBe("0.4 office days short of FY2027's full year.");
  });
});

describe("fyFillPercent", () => {
  it("draws a full bar when nothing is required", () => {
    // An empty bar against a zero target would read as no progress rather than
    // no obligation — and this is the only input that would divide by zero.
    expect(
      fyFillPercent(
        stats({
          cumulativeRequiredPoints: 0,
          cumulativeOffice: 0,
          balancePoints: 0,
        })
      )
    ).toBe(100);
  });

  it("floors a partial year rather than flattering it", () => {
    // 5 stamped against 5.2 owed is 96%. The old ceil drew this at
    // floor(5/6) = 83%, understating a year that is nearly met.
    expect(
      fyFillPercent(
        stats({
          cumulativeOffice: 5,
          cumulativeRequiredPoints: 520,
          balancePoints: -20,
          remainingNeededPoints: 20,
        })
      )
    ).toBe(96);
  });

  it("clamps a sub-day surplus that computes past 100", () => {
    // 20 stamped against 19.8 owed is 101.01…, where the old ceil gave exactly
    // 100. The clamp became load-bearing when the year stopped rounding.
    expect(
      fyFillPercent(
        stats({
          cumulativeOffice: 20,
          cumulativeRequiredPoints: 1980,
          balancePoints: 20,
        })
      )
    ).toBe(100);
  });

  it("reads full exactly when the year is met, and never before", () => {
    // The invariant the floor exists to protect: no solid bar above a sentence
    // saying days are still owed. Swept across a whole requirement and two
    // fractional ones — the whole case is where the comparison flips from > to
    // >=, and a single fixture cannot reach it.
    for (const points of [10400, 10440, 10499]) {
      for (let officeDays = 100; officeDays <= 110; officeDays++) {
        const fy = stats({
          cumulativeOffice: officeDays,
          cumulativeRequiredPoints: points,
          balancePoints: officeDays * 100 - points,
          remainingNeededPoints: Math.max(0, points - officeDays * 100),
        });
        expect(fyFillPercent(fy) === 100).toBe(fy.remainingNeededPoints === 0);
      }
    }
  });
});

describe("formatDays", () => {
  it("renders a one-decimal requirement", () => {
    expect(formatDays(520)).toBe("5.2"); // 13 eligible at 40%
  });

  it("renders a whole requirement without a decimal point", () => {
    expect(formatDays(800)).toBe("8");
    expect(formatDays(100)).toBe("1");
    expect(formatDays(0)).toBe("0");
  });

  it("keeps a second decimal when the percentage produces one", () => {
    expect(formatDays(429)).toBe("4.29"); // 13 eligible at 33%
    expect(formatDays(405)).toBe("4.05"); // leading zero in the fraction
  });

  it("renders a fraction below one day", () => {
    expect(formatDays(80)).toBe("0.8");
  });

  it("trims only the trailing zero, not a significant one", () => {
    expect(formatDays(440)).toBe("4.4");
    expect(formatDays(404)).toBe("4.04");
  });

  // FY-scale callers pass four-digit points, so the whole part is not always
  // one digit. Catches any implementation that slices at a fixed width.
  it("renders a multi-digit whole part", () => {
    expect(formatDays(1005)).toBe("10.05");
    expect(formatDays(2600)).toBe("26");
  });
});

// The employer's own worked example, from the Aug 2026 RTO email:
// 21 weekdays − 2 holidays − 6 mandated = 13 eligible; 13 × 40% = 5.2.
describe("computeMonthStats in percent-points", () => {
  const mandate: WfhMandate[] = [
    // Wed–19 Aug: 6 weekdays, and clear of both holidays below — a mandate
    // that swallowed the 21st would make it one mandated day, not one of each.
    { startDate: "2026-08-12", endDate: "2026-08-19" },
  ];
  const holidays: Entries = {
    "2026-08-21": "holiday", // Ninoy Aquino Day (Fri)
    "2026-08-31": "holiday", // National Heroes Day (Mon)
  };

  it("does not round the month up", () => {
    const s = computeMonthStats(2026, 8, holidays, 40, mandate);
    expect(s.eligibleDays).toBe(13);
    expect(s.requiredPoints).toBe(520);
    expect(formatDays(s.requiredPoints)).toBe("5.2");
  });

  it("reports the shortfall exactly, in points", () => {
    const entries: Entries = {
      ...holidays,
      "2026-08-03": "office",
      "2026-08-04": "office",
      "2026-08-05": "office",
      "2026-08-06": "office",
      "2026-08-07": "office",
    };
    const s = computeMonthStats(2026, 8, entries, 40, mandate);
    expect(s.officeDays).toBe(5);
    expect(s.remainingPoints).toBe(20); // 520 − 500
    expect(formatDays(s.remainingPoints)).toBe("0.2");
  });

  it("treats the requirement as met only when no points remain", () => {
    const six: Entries = { ...holidays };
    for (const d of ["03", "04", "05", "06", "07", "10"]) {
      six[`2026-08-${d}`] = "office";
    }
    const s = computeMonthStats(2026, 8, six, 40, mandate);
    expect(s.officeDays).toBe(6);
    expect(s.remainingPoints).toBe(0);
  });

  // The reason points exist: 5.2 − 5 is 0.20000000000000018 as a float, so a
  // float comparison at this boundary is not reliable. Points are exact.
  it("never leaves a float residue at the boundary", () => {
    const s = computeMonthStats(2026, 8, holidays, 40, mandate);
    expect(Number.isInteger(s.requiredPoints)).toBe(true);
    expect(Number.isInteger(s.remainingPoints)).toBe(true);
  });

  it("clamps remaining points at zero once the month is over-served", () => {
    const entries: Entries = { ...holidays };
    for (const d of ["03", "04", "05", "06", "07", "10", "11"]) {
      entries[`2026-08-${d}`] = "office";
    }
    const s = computeMonthStats(2026, 8, entries, 40, mandate);
    expect(s.officeDays).toBe(7);
    expect(s.remainingPoints).toBe(0);
  });
});

describe("monthMeter", () => {
  // Aug 2026: 21 weekdays − 6 mandated (Wed 12 – Wed 19) − 2 holidays = 13
  // eligible, and 13 × 40% = 520 points = 5.2 days. The fractional requirement
  // the rings have to draw.
  const mandate: WfhMandate[] = [
    { startDate: "2026-08-12", endDate: "2026-08-19" },
  ];
  const holidays: Entries = {
    "2026-08-21": "holiday", // Fri
    "2026-08-31": "holiday", // Mon
  };
  // Mon 3 – Tue 11, all weekdays clear of the mandate and of both holidays.
  const AUG_FREE = [
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
    "2026-08-10",
    "2026-08-11",
  ];

  /** That August, stamped for its first `office` free weekdays. */
  function august(office: number): MonthStats {
    const entries: Entries = { ...holidays };
    for (const date of AUG_FREE.slice(0, office)) entries[date] = "office";
    return computeMonthStats(2026, 8, entries, 40, mandate);
  }

  /**
   * January 2026 with its later weekdays on leave, leaving `keep` eligible, of
   * which the first `office` are stamped. `office` must not exceed `keep`.
   */
  function january(keep: number, office = 0): MonthStats {
    const weekdays = monthWeekdays(2026, 1);
    const entries: Entries = {};
    for (const date of weekdays.slice(keep)) entries[date] = "leave";
    for (const date of weekdays.slice(0, office)) entries[date] = "office";
    return computeMonthStats(2026, 1, entries, 40);
  }

  it("rounds a fractional requirement up into whole rings", () => {
    const s = august(5);
    expect(s.requiredPoints).toBe(520);
    // 5.2 days needs six rings drawn; the sixth is worth 0.2 of one.
    expect(monthMeter(s)).toEqual({
      slots: 6,
      partialSlot: 20,
      filled: 5,
      extra: 0,
    });
  });

  it("fills the part-worth ring with a whole stamp", () => {
    const s = august(6);
    expect(s.remainingPoints).toBe(0); // the sixth stamp settles the month
    // partialSlot is the size of the obligation, not progress against it, so
    // it does not move when a stamp lands on the ring.
    expect(monthMeter(s)).toEqual({
      slots: 6,
      partialSlot: 20,
      filled: 6,
      extra: 0,
    });
  });

  it("counts surplus in whole rings, never a fraction of one", () => {
    const s = august(7);
    expect(s.officeDays).toBe(7);
    // The exact surplus is 7 − 5.2 = 1.8 days, which is what a float
    // officeDays − required subtraction reported. `extra` counts rings past the row
    // instead, and slots already rounded 5.2 up to 6 — so it says +1 and never
    // promises more than the year will grant.
    expect(monthMeter(s)).toEqual({
      slots: 6,
      partialSlot: 20,
      filled: 6,
      extra: 1,
    });
  });

  it("draws no partial ring when the requirement is whole", () => {
    // Jan 2026 has 22 weekdays; 2 on leave leaves 20, and 20 × 40% = 800
    // points = exactly 8 days, so there is no remainder to draw short.
    const s = january(20);
    expect(s.requiredPoints).toBe(800);
    expect(monthMeter(s)).toEqual({
      slots: 8,
      partialSlot: 0,
      filled: 0,
      extra: 0,
    });
  });

  it("draws one part-worth ring for a requirement below a day", () => {
    // 2 eligible days × 40% = 80 points = 0.8 of a day.
    const s = january(2);
    expect(s.requiredPoints).toBe(80);
    expect(monthMeter(s)).toEqual({
      slots: 1,
      partialSlot: 80,
      filled: 0,
      extra: 0,
    });
    // One stamp fills that row outright, and the 0.2 of a day it over-serves
    // is not a whole ring — so nothing is reported as extra.
    expect(monthMeter(january(2, 1))).toEqual({
      slots: 1,
      partialSlot: 80,
      filled: 1,
      extra: 0,
    });
  });

  it("draws no rings at all when nothing is required", () => {
    const mandated: WfhMandate[] = [
      { startDate: "2026-08-01", endDate: "2026-08-31" },
    ];
    // A mandate over the whole month: no eligible days, and the office stamp
    // inside it is excluded, so no stamp can land either.
    const s = computeMonthStats(
      2026,
      8,
      { "2026-08-03": "office" },
      40,
      mandated
    );
    expect(s.requiredPoints).toBe(0);
    expect(monthMeter(s)).toEqual({
      slots: 0,
      partialSlot: 0,
      filled: 0,
      extra: 0,
    });
  });

  it("reports every stamp as extra against a zero requirement", () => {
    // A 0% rate: the days stay eligible but weigh nothing, so all three stamps
    // sit past a row with no rings in it.
    const s = computeMonthStats(
      2026,
      1,
      {
        "2026-01-01": "office", // Thu
        "2026-01-02": "office", // Fri
        "2026-01-05": "office", // Mon
      },
      0
    );
    expect(s.requiredPoints).toBe(0);
    expect(monthMeter(s)).toEqual({
      slots: 0,
      partialSlot: 0,
      filled: 0,
      extra: 3,
    });
  });
});

describe("the financial year sums fractional months without rounding", () => {
  // Jan 2026 sits in FY2026, which runs Aug 2025 – Jul 2026, so the whole-year
  // window starts there. The computeFyStats block's own `baseline` pins Aug
  // 2026, which is past this FY's end.
  const baseline = (prior: MonthsAggregate): FyBaseline => ({
    windowStartMonth: "2025-08",
    prior,
  });

  /** January 2026 with its later weekdays on leave, leaving `keep` eligible. */
  function januaryLeaveTo(keep: number): Entries {
    const entries: Entries = {};
    for (const date of monthWeekdays(2026, 1).slice(keep)) {
      entries[date] = "leave";
    }
    return entries;
  }

  it("sums two fractional months' points exactly, never per-month ceils", () => {
    // Two months of 5.2 sum to 10.4 points exactly. Summing per-month ceils
    // instead would report 12 — two ceil(5.2)s — which this asserts against.
    const eligible = 13; // 13 × 40% = 520 points = 5.2 days
    const prior: MonthsAggregate = { officeDays: 0, weightedEligible: 520 };
    const month = computeMonthStats(2026, 1, januaryLeaveTo(eligible), 40);
    const fy = computeFyStats("2026-01", baseline(prior), month);

    expect(month.requiredPoints).toBe(520);
    expect(formatDays(month.requiredPoints)).toBe("5.2"); // the month does not round
    // 520 + 520, exactly 10.4 days.
    expect(fy.cumulativeRequiredPoints).toBe(1040);

    const monthlySum = 2 * Math.ceil(520 / 100);
    expect(monthlySum).toBe(12);
    expect(fy.cumulativeRequiredPoints).toBeLessThan(monthlySum * 100);
  });

  it("derives the displayed month's contribution from its points", () => {
    const prior: MonthsAggregate = { officeDays: 0, weightedEligible: 0 };
    const month = computeMonthStats(2026, 1, {}, 40);
    const fy = computeFyStats("2026-01", baseline(prior), month);
    expect(fy.cumulativeRequiredPoints).toBe(880); // 22 × 40%, one month only
  });
});

describe("the FY roll-up across a rate change", () => {
  // FY2027 starts in August, so Aug–Oct 2026 with October displayed is a whole
  // window with nothing carried in. Aug 2026 has 21 weekdays, Sep and Oct 22
  // each. The rate rises from 40% to 60% part-way through.
  const periods: TargetPeriod[] = [
    { startMonth: "2026-08", endMonth: "2026-08", percent: 40 },
    { startMonth: "2026-09", endMonth: null, percent: 60 },
  ];

  it("sums the year's total across months resolved at different rates", () => {
    const prior = aggregateMonths(["2026-08", "2026-09"], {}, periods, []);
    expect(prior.weightedEligible).toBe(21 * 40 + 22 * 60); // 840 + 1320

    // The page resolves the displayed month the same way aggregateMonths
    // resolves the ones behind it — the rate change has to survive both.
    const october = computeMonthStats(
      2026,
      10,
      {},
      resolvePercent("2026-10", periods)
    );
    expect(october.targetPercent).toBe(60);
    expect(october.requiredPoints).toBe(1320); // 22 × 60%

    const fy = computeFyStats(
      "2026-10",
      { windowStartMonth: "2026-08", prior },
      october
    );
    // 840 + 1320 + 1320 = 3480 points = 34.8 days, held exactly.
    expect(fy.cumulativeRequiredPoints).toBe(3480);

    // The claim the design rests on: rounding each month first would cost two
    // whole office days over three months, and twelve months compound it.
    const monthlySum =
      Math.ceil((21 * 40) / 100) + // ceil(8.4)  = 9
      Math.ceil((22 * 60) / 100) + // ceil(13.2) = 14
      Math.ceil((22 * 60) / 100); // ceil(13.2) = 14
    expect(monthlySum).toBe(37);
    expect(fy.cumulativeRequiredPoints).toBeLessThan(monthlySum * 100);
  });
});

describe("the year agrees with the month on a fractional debt", () => {
  // Aug 2026 is the first month of FY2027, so the window is that month alone
  // and the year's figure is exactly the month's requirement, with nothing
  // carried in to settle the fraction against.
  const OFFICE: Entries = {
    "2026-08-03": "office", // Mon
    "2026-08-04": "office", // Tue
    "2026-08-05": "office", // Wed
    "2026-08-06": "office", // Thu
    "2026-08-07": "office", // Fri
    "2026-08-10": "office", // Mon
    "2026-08-11": "office", // Tue
    "2026-08-12": "office", // Wed
  };

  it("reports the same 0.4-day shortfall the month does", () => {
    const august = computeMonthStats(2026, 8, OFFICE, 40);
    expect(august.eligibleDays).toBe(21); // every weekday in Aug 2026
    expect(august.officeDays).toBe(8);
    expect(august.requiredPoints).toBe(840); // 21 × 40% = 8.4 days

    const fy = computeFyStats(
      "2026-08",
      {
        windowStartMonth: "2026-08",
        prior: { officeDays: 0, weightedEligible: 0 },
      },
      august
    );

    // The month and the year now state the same exact debt, 0.4 of a day:
    // neither rounds (ADR 0007). The old design had the year round up where
    // the month did not; that asymmetry is gone, on purpose.
    expect(august.remainingPoints).toBe(40);
    expect(formatDays(august.remainingPoints)).toBe("0.4");
    expect(fy.cumulativeRequiredPoints).toBe(840);
    expect(fy.balancePoints).toBe(-40);
    expect(fyVerdict(fy, august)).toBe(
      "0.4 more office days needed to be level."
    );
  });
});

describe("training days", () => {
  it("takes a day out of the eligible base, like leave", () => {
    const s = computeMonthStats(2026, 1, { "2026-01-05": "training" });
    expect(s.eligibleDays).toBe(21); // 22 weekdays − 1
    expect(s.officeDays).toBe(0);
    expect(s.requiredPoints).toBe(840);
  });

  it("is not eligible", () => {
    expect(isEligible("2026-01-05", { "2026-01-05": "training" }, [])).toBe(
      false
    );
  });

  it("counts once when the day is also mandated", () => {
    const mandate: WfhMandate[] = [
      { startDate: "2026-01-05", endDate: "2026-01-05" },
    ];
    const s = computeMonthStats(
      2026,
      1,
      { "2026-01-05": "training" },
      40,
      mandate
    );
    expect(s.eligibleDays).toBe(21);
    expect(s.mandatedDays).toBe(1); // one mandated day, not one of each
  });

  it("reduces the requirement alongside leave and holidays", () => {
    const s = computeMonthStats(2026, 1, {
      "2026-01-01": "holiday",
      "2026-01-02": "leave",
      "2026-01-05": "training",
    });
    expect(s.eligibleDays).toBe(19);
    expect(formatDays(s.requiredPoints)).toBe("7.6");
  });
});

// The RTO email of Aug 2026, reproduced in full:
//   21 working days → 19 after holidays → 13 after a 6-day exclusion
//   13 × 40% = 5.2 days required, further reduced by leave and training.
describe("the Aug 2026 RTO email", () => {
  // Wed 12 – Wed 19: weekdays 12, 13, 14, 17, 18, 19 = six. The window
  // deliberately avoids Fri 21 Aug — a day that is both mandated and a holiday
  // is excluded once, not twice, so a mandate spanning the 21st would leave 14
  // eligible days rather than 13 and break the employer's worked example.
  const mandate: WfhMandate[] = [
    { startDate: "2026-08-12", endDate: "2026-08-19" },
  ];

  it("reproduces the stated 5.2", () => {
    const s = computeMonthStats(
      2026,
      8,
      { "2026-08-21": "holiday", "2026-08-31": "holiday" },
      40,
      mandate
    );
    expect(s.eligibleDays).toBe(13);
    expect(s.mandatedDays).toBe(6);
    expect(formatDays(s.requiredPoints)).toBe("5.2");
  });

  it("reduces the 5.2 further for leave and training", () => {
    const s = computeMonthStats(
      2026,
      8,
      {
        "2026-08-21": "holiday",
        "2026-08-31": "holiday",
        "2026-08-03": "leave",
        "2026-08-04": "training",
      },
      40,
      mandate
    );
    expect(s.eligibleDays).toBe(11);
    expect(formatDays(s.requiredPoints)).toBe("4.4");
  });
});

describe("formatFinancialYear", () => {
  it("names the year and spells out its Aug–Jul span", () => {
    expect(formatFinancialYear(2027)).toBe("FY2027 (Aug 2026 – Jul 2027)");
  });

  it("works for the year the record began", () => {
    expect(formatFinancialYear(2026)).toBe("FY2026 (Aug 2025 – Jul 2026)");
  });
});
