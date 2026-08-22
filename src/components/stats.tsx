import {
  DEFAULT_RTO_PERCENT,
  formatMonth,
  fyVerdict,
  type FyStats,
  type MonthStats,
} from "@/lib/rto";

// Stamp-card meter — one ring per required office day, filled as stamped — with
// the financial year's running position underneath.
export function Stats({
  stats,
  fyStats,
}: {
  stats: MonthStats;
  fyStats: FyStats | null;
}) {
  return (
    <section aria-label="Progress" className="space-y-4">
      <MonthBlock stats={stats} fyStats={fyStats} />
      {fyStats && (
        <div className="border-t border-rule pt-4">
          <FyBlock fyStats={fyStats} monthStats={stats} />
        </div>
      )}
    </section>
  );
}

function MonthBlock({
  stats,
  fyStats,
}: {
  stats: MonthStats;
  fyStats: FyStats | null;
}) {
  const {
    eligibleDays,
    officeDays,
    requiredDays,
    remainingNeeded,
    targetPercent,
    achievedPercent,
    mandatedDays,
  } = stats;
  const filled = Math.min(officeDays, requiredDays);
  const extra = officeDays - filled;

  // Nothing was owed this month. Rendering zero rings and "0/0 stamped ·
  // target met · 0%" would read as a bug, so say why instead.
  if (eligibleDays === 0 && mandatedDays > 0) {
    return (
      <div className="space-y-2">
        <p className="font-mono text-sm">No requirement — mandated WFH</p>
        <p className="text-sm text-fade">
          {mandatedDays} working {mandatedDays === 1 ? "day" : "days"} this month{" "}
          {mandatedDays === 1 ? "is" : "are"} mandated work from home. No office
          days are required.
        </p>
      </div>
    );
  }

  // A month shortfall the year has already banked for is not a shortfall, so it
  // loses the alarm colour. The FY line below is where the number to act on is.
  // Both colours below defer to this one flag, symmetrically: neither the
  // month's alarm nor its celebration survives the year disagreeing.
  const owedForYear = fyStats === null || fyStats.remainingNeeded > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: requiredDays }, (_, i) => (
            <span
              key={i}
              className={`inline-block size-4 rounded-full border-2 ${
                i < filled
                  ? "border-stamp bg-stamp"
                  : "border-fade/60 bg-transparent"
              }`}
            />
          ))}
          {extra > 0 && (
            <span className="font-mono text-xs text-stamp">+{extra}</span>
          )}
        </div>
        <p className="font-mono text-sm">
          {officeDays}/{requiredDays} stamped ·{" "}
          {remainingNeeded > 0 ? (
            <span className={owedForYear ? "text-stamp" : "text-fade"}>
              {remainingNeeded} to go
            </span>
          ) : (
            // The mirror of the line above, and the more dangerous misread of
            // the two: "target met" in green directly above "17 more office
            // days needed to be level". The words stay; only the colour defers.
            <span className={owedForYear ? "text-fade" : "text-holiday"}>
              target met
            </span>
          )}{" "}
          · {achievedPercent}%
        </p>
      </div>
      <p className="text-sm text-fade">
        {requiredDays} office days required — {targetPercent}% of {eligibleDays}{" "}
        eligible working days this month
        {targetPercent !== DEFAULT_RTO_PERCENT && (
          <span className="text-stamp">
            {" "}
            (adjusted from {DEFAULT_RTO_PERCENT}%)
          </span>
        )}
        {mandatedDays > 0 && <> · {mandatedDays} days mandated WFH</>}.
      </p>
    </div>
  );
}

function FyBlock({
  fyStats,
  monthStats,
}: {
  fyStats: FyStats;
  monthStats: MonthStats;
}) {
  const { cumulativeOffice, cumulativeRequired, balance } = fyStats;
  // Full when nothing is required: an empty bar against a zero target would
  // read as no progress rather than no obligation. Otherwise floor, not
  // round: rounding renders 259/260 as a solid bar sitting directly above
  // "1 office day short", so the bar reads full only when the year is met.
  const fillPercent =
    cumulativeRequired === 0
      ? 100
      : Math.min(100, Math.floor((cumulativeOffice / cumulativeRequired) * 100));

  // Its own landmark: this is a second subject inside "Progress", and the year
  // is the one a screen reader has no other way to skip to.
  return (
    <section aria-label={`FY${fyStats.fy} progress`} className="space-y-2">
      <p className="font-mono text-[10px] tracking-widest text-fade uppercase">
        FY{fyStats.fy} · {formatMonth(fyStats.fyStartMonth)} –{" "}
        {formatMonth(fyStats.fyEndMonth)}
        {fyStats.isPartialWindow && (
          <> · counted from {formatMonth(fyStats.windowStartMonth)}</>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Carries nothing the text does not, exactly as the rings above. */}
        <div aria-hidden className="h-2 w-40 border border-rule sm:w-56">
          <div
            className="h-full bg-stamp"
            style={{ width: `${fillPercent}%` }}
          />
        </div>
        <p className="font-mono text-sm">
          {cumulativeOffice}/{cumulativeRequired}{" "}
          {fyStats.isFinalMonth ? "for the year" : "to date"}
          {balance > 0 && <span className="text-stamp"> +{balance}</span>}
        </p>
      </div>
      <p className="text-sm text-fade">{fyVerdict(fyStats, monthStats)}</p>
    </section>
  );
}
