import { describe, it, expect } from "vitest";
import { parseHolidayIcs } from "./holidays";

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
