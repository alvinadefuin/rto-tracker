/**
 * A public holiday as the feed reports it.
 *
 * `name` is display copy only — nothing in the app parses it, and no
 * arithmetic sees it. It lands in `day_entries.note`.
 */
export interface ImportedHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

/**
 * ICS text escapes, per RFC 5545 §3.3.11: `\,` `\;` `\\` and `\n`.
 *
 * One pass rather than chained `replace` calls, because chaining gets `\\n`
 * wrong — the first pass would turn an escaped backslash followed by an `n`
 * into a newline. An escaped newline becomes a space: the footnote that renders
 * these names is one line per holiday.
 */
function unescapeIcsText(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "\\") {
      out += value[i];
      continue;
    }
    const escaped = value[++i];
    if (escaped === undefined) out += "\\"; // trailing backslash, kept as-is
    else if (escaped === "n" || escaped === "N") out += " ";
    else out += escaped; // \, \; \\ and anything else: the character itself
  }
  return out;
}

/** Value of an unfolded `NAME:value` line within one event, or null. */
function field(body: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\n)${name}:(.*)`).exec(body);
  return match ? match[1].trim() : null;
}

/**
 * Public holidays in an ICS feed, in feed order.
 *
 * Returns `[]` rather than throwing on anything it cannot read. An empty result
 * from a feed that answered is the caller's signal that the format changed —
 * see `importHolidays`, which reports that as a failure rather than as a year
 * without holidays.
 */
export function parseHolidayIcs(ics: string): ImportedHoliday[] {
  // Normalise line endings, then unfold. RFC 5545 folds long lines with a line
  // break plus one space or one tab, and unfolding removes both — the live feed
  // folds mid-word, so the whitespace is part of the fold and never part of the
  // value. Normalising first means a single pass covers CRLF and LF feeds
  // alike. This must precede everything else — SUMMARY values wrap, and a
  // folded name would otherwise be truncated.
  const unfolded = ics.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");

  const holidays: ImportedHoliday[] = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];

    // Allowlist, not a denylist on "Observance". The live feed carries a
    // DESCRIPTION on all 311 events and exactly two values occur —
    // "Public holiday" (271) and "Observance" (40) — so this is checked, not
    // guessed. The two directions fail differently: were the field renamed, an
    // allowlist marks nothing and the caller says so, where a denylist would
    // mark Easter Sunday and the People Power Anniversary as holidays and
    // silently lower the requirement. A new third category would be dropped,
    // which the user can fix with a tap.
    const description = field(body, "DESCRIPTION");
    if (description === null || !description.startsWith("Public holiday")) {
      continue;
    }

    // Date-valued DTSTART only. The eight digits are sliced by index and never
    // parsed — the codebase's central invariant. A datetime DTSTART is not an
    // all-day holiday, and the trailing anchor is what rejects one.
    const digits = /(?:^|\n)DTSTART;VALUE=DATE:(\d{8})(?=\n|$)/.exec(body)?.[1];
    if (digits === undefined) continue;

    const summary = field(body, "SUMMARY");
    if (summary === null) continue;

    holidays.push({
      date: `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`,
      name: unescapeIcsText(summary).trim(),
    });
  }
  return holidays;
}
