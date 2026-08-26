import { describe, it, expect } from "vitest";
import {
  parseHolidayIcs,
  planHolidayImport,
  type ImportedHoliday,
} from "./holidays";

/**
 * Minimal well-formed event. Every case below is this shape with one thing
 * changed, so a failure names the property it broke.
 */
function event(lines: string): string {
  return `BEGIN:VCALENDAR\nBEGIN:VEVENT\n${lines}\nEND:VEVENT\nEND:VCALENDAR`;
}

describe("parseHolidayIcs", () => {
  it("slices a date-valued DTSTART into YYYY-MM-DD", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20261225\nSUMMARY:Christmas Day\nDESCRIPTION:Public holiday"
    );
    expect(parseHolidayIcs(ics)).toEqual([
      { date: "2026-12-25", name: "Christmas Day" },
    ]);
  });

  // Folded mid-word, which is how the live feed folds: unfolding removes the
  // line break *and* the whitespace that follows it, per RFC 5545 §3.1. A
  // fixture that split at a word boundary would only pass against an unfolder
  // that wrongly left the space behind.
  it("unfolds a SUMMARY folded with a space", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20261208\nSUMMARY:Feast of the Immaculate Concep\n tion\nDESCRIPTION:Public holiday"
    );
    expect(parseHolidayIcs(ics)[0].name).toBe(
      "Feast of the Immaculate Conception"
    );
  });

  it("unfolds a SUMMARY folded with a tab", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20261208\nSUMMARY:Feast of the Immaculate Concep\n\ttion\nDESCRIPTION:Public holiday"
    );
    expect(parseHolidayIcs(ics)[0].name).toBe(
      "Feast of the Immaculate Conception"
    );
  });

  it("normalises CRLF before unfolding", () => {
    const ics =
      "BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261208\r\nSUMMARY:Feast of the Immaculate Concep\r\n tion\r\nDESCRIPTION:Public holiday\r\nEND:VEVENT";
    expect(parseHolidayIcs(ics)).toEqual([
      { date: "2026-12-08", name: "Feast of the Immaculate Conception" },
    ]);
  });

  it("drops observances", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20270225\nSUMMARY:People Power Anniversary\nDESCRIPTION:Observance"
    );
    expect(parseHolidayIcs(ics)).toEqual([]);
  });

  it("keeps a tentative holiday, suffix and all", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20270310\nSUMMARY:Eid al-Fitr (tentative)\nDESCRIPTION:Public holiday\\nDate is tentative and may vary"
    );
    expect(parseHolidayIcs(ics)).toEqual([
      { date: "2027-03-10", name: "Eid al-Fitr (tentative)" },
    ]);
  });

  // An allowlist, not a denylist on "Observance". If the feed drops or renames
  // DESCRIPTION, an allowlist yields nothing and the action reports a format
  // failure; a denylist would mark Easter Sunday a holiday and quietly lower
  // the requirement.
  it("drops an event with no DESCRIPTION", () => {
    const ics = event("DTSTART;VALUE=DATE:20261225\nSUMMARY:Christmas Day");
    expect(parseHolidayIcs(ics)).toEqual([]);
  });

  it("drops an event whose DESCRIPTION is neither category", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20261225\nSUMMARY:Christmas Day\nDESCRIPTION:Season"
    );
    expect(parseHolidayIcs(ics)).toEqual([]);
  });

  it("unescapes escaped commas, semicolons and backslashes", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20261230\nSUMMARY:Rizal Day\\, Manila\\; observed \\\\ nationwide\nDESCRIPTION:Public holiday"
    );
    expect(parseHolidayIcs(ics)[0].name).toBe(
      "Rizal Day, Manila; observed \\ nationwide"
    );
  });

  it("collapses an escaped newline in a name to a space", () => {
    const ics = event(
      "DTSTART;VALUE=DATE:20261102\nSUMMARY:All Souls'\\nDay\nDESCRIPTION:Public holiday"
    );
    expect(parseHolidayIcs(ics)[0].name).toBe("All Souls' Day");
  });

  it("drops a datetime DTSTART — an all-day holiday is a date", () => {
    const ics = event(
      "DTSTART:20261225T000000Z\nSUMMARY:Christmas Day\nDESCRIPTION:Public holiday"
    );
    expect(parseHolidayIcs(ics)).toEqual([]);
  });

  it("returns [] for an empty string", () => {
    expect(parseHolidayIcs("")).toEqual([]);
  });

  it("returns [] for a body with no VEVENT", () => {
    expect(parseHolidayIcs("BEGIN:VCALENDAR\nEND:VCALENDAR")).toEqual([]);
  });

  it("returns every event, in feed order", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20261231",
      "SUMMARY:New Year's Eve",
      "DESCRIPTION:Public holiday",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260821",
      "SUMMARY:Ninoy Aquino Day",
      "DESCRIPTION:Public holiday",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    expect(parseHolidayIcs(ics)).toEqual([
      { date: "2026-12-31", name: "New Year's Eve" },
      { date: "2026-08-21", name: "Ninoy Aquino Day" },
    ]);
  });
});

// Real FY2027 dates. 2026-08-21 is a Friday, 2026-08-22 a Saturday,
// 2026-08-31 a Monday, 2026-11-01 a Sunday, 2026-11-02 a Monday.
const NINOY: ImportedHoliday = {
  date: "2026-08-21",
  name: "Ninoy Aquino Day",
};
const HEROES: ImportedHoliday = {
  date: "2026-08-31",
  name: "National Heroes Day",
};
const ALL_SOULS: ImportedHoliday = {
  date: "2026-11-02",
  name: "All Souls' Day",
};
const FY2027_START = "2026-08-01";
const FY2027_END = "2027-07-31";

describe("planHolidayImport", () => {
  it("plans every weekday holiday in range when nothing is recorded", () => {
    const plan = planHolidayImport(
      [NINOY, HEROES, ALL_SOULS],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan).toEqual({
      toInsert: [NINOY, HEROES, ALL_SOULS],
      alreadyMarked: 0,
      beforeRecord: 0,
    });
  });

  it("drops holidays before the range without counting them", () => {
    // Christmas 2025 is outside FY2027 entirely.
    const early: ImportedHoliday = {
      date: "2025-12-25",
      name: "Christmas Day",
    };
    const plan = planHolidayImport(
      [early, NINOY],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan).toEqual({
      toInsert: [NINOY],
      alreadyMarked: 0,
      beforeRecord: 0,
    });
  });

  it("drops holidays after the range", () => {
    const late: ImportedHoliday = {
      date: "2027-08-21",
      name: "Ninoy Aquino Day",
    };
    const plan = planHolidayImport(
      [NINOY, late],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan.toInsert).toEqual([NINOY]);
  });

  it("includes both range endpoints", () => {
    // 2026-08-03 is a Monday; 2027-07-30 is a Friday. Neither is a real
    // holiday — the point is that the bounds are inclusive.
    const first: ImportedHoliday = { date: "2026-08-03", name: "First" };
    const last: ImportedHoliday = { date: "2027-07-30", name: "Last" };
    const plan = planHolidayImport(
      [first, last],
      "2026-08-03",
      "2027-07-30",
      [],
      null
    );
    expect(plan.toInsert).toEqual([first, last]);
  });

  it("drops weekend holidays without counting them", () => {
    // 2026-11-01 is a Sunday; weekends are never stored.
    const sunday: ImportedHoliday = {
      date: "2026-11-01",
      name: "All Saints' Day",
    };
    const plan = planHolidayImport(
      [sunday, ALL_SOULS],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan).toEqual({
      toInsert: [ALL_SOULS],
      alreadyMarked: 0,
      beforeRecord: 0,
    });
  });

  it("counts a day that already has a row and does not re-insert it", () => {
    const plan = planHolidayImport(
      [NINOY, HEROES],
      FY2027_START,
      FY2027_END,
      ["2026-08-21"],
      "2026-08-21"
    );
    expect(plan).toEqual({
      toInsert: [HEROES],
      alreadyMarked: 1,
      beforeRecord: 0,
    });
  });

  // The clamp. An unclamped import would write Ninoy Aquino Day 2026-08-21,
  // move min(day_entries.date) behind the user's real first day, and make
  // fyWindowStart bill months they were not employed.
  it("counts days before the earliest entry and does not insert them", () => {
    const plan = planHolidayImport(
      [NINOY, HEROES, ALL_SOULS],
      FY2027_START,
      FY2027_END,
      ["2026-08-25"],
      "2026-08-25"
    );
    expect(plan).toEqual({
      toInsert: [HEROES, ALL_SOULS],
      alreadyMarked: 0,
      beforeRecord: 1,
    });
  });

  it("treats a null earliest entry as no clamp at all", () => {
    const plan = planHolidayImport(
      [NINOY],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan).toEqual({
      toInsert: [NINOY],
      alreadyMarked: 0,
      beforeRecord: 0,
    });
  });

  it("does not count the earliest entry's own day as before the record", () => {
    const plan = planHolidayImport(
      [NINOY],
      FY2027_START,
      FY2027_END,
      ["2026-08-21"],
      "2026-08-21"
    );
    expect(plan).toEqual({
      toInsert: [],
      alreadyMarked: 1,
      beforeRecord: 0,
    });
  });

  it("keeps toInsert in feed order", () => {
    const plan = planHolidayImport(
      [ALL_SOULS, NINOY, HEROES],
      FY2027_START,
      FY2027_END,
      [],
      null
    );
    expect(plan.toInsert.map((h) => h.date)).toEqual([
      "2026-11-02",
      "2026-08-21",
      "2026-08-31",
    ]);
  });

  it("returns an empty plan for an empty feed", () => {
    expect(
      planHolidayImport([], FY2027_START, FY2027_END, [], null)
    ).toEqual({ toInsert: [], alreadyMarked: 0, beforeRecord: 0 });
  });
});
