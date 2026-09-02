import {
  DEFAULT_RTO_PERCENT,
  formatDays,
  formatMonth,
  fyCarryNote,
  fyFillPercent,
  fyVerdict,
  monthMeter,
  type FyStats,
  type MonthStats,
} from "@/lib/rto";

// Stamp-card meter — one ring per required office day, rounded up, filled as
// stamped; a fractional requirement leaves its last ring drawn short until a
// stamp fills it — with the financial year's running position underneath.
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
    requiredPoints,
    remainingPoints,
    targetPercent,
    achievedPercent,
    mandatedDays,
  } = stats;
  // Derived in src/lib/rto.ts, where Vitest can assert it — not inline here,
  // where it could not be. That file carries the reasoning behind each number.
  const { slots, partialSlot, filled, extra } = monthMeter(stats);

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
  const owedForYear = fyStats === null || fyStats.remainingNeededPoints > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: slots }, (_, i) => {
            const stamped = i < filled;
            // The final slot can be worth less than a whole day. Show how much
            // rather than drawing a full ring the month never has to fill.
            // Drawn in fade, not stamp: this is the size of the obligation, not
            // progress against it — and it disappears once a stamp lands on it.
            const partial = !stamped && partialSlot > 0 && i === slots - 1;
            return (
              <span
                key={i}
                className={`inline-block size-4 rounded-full border-2 ${
                  stamped
                    ? "border-stamp bg-stamp"
                    : "border-fade/60 bg-transparent"
                }`}
                style={
                  partial
                    ? {
                        background: `conic-gradient(var(--color-fade) ${partialSlot}%, transparent 0)`,
                      }
                    : undefined
                }
              />
            );
          })}
          {extra > 0 && (
            <span className="font-mono text-xs text-stamp">+{extra}</span>
          )}
        </div>
        <p className="font-mono text-sm">
          {officeDays}/{formatDays(requiredPoints)} stamped ·{" "}
          {remainingPoints > 0 ? (
            <span className={owedForYear ? "text-stamp" : "text-fade"}>
              {formatDays(remainingPoints)} to go
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
        {formatDays(requiredPoints)} office days required — {targetPercent}% of{" "}
        {eligibleDays} eligible working days this month
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
  const { cumulativeOffice, cumulativeRequiredPoints, balancePoints } = fyStats;
  const fillPercent = fyFillPercent(fyStats);
  const carryNote = fyCarryNote(fyStats, monthStats);

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
          {cumulativeOffice}/{formatDays(cumulativeRequiredPoints)}{" "}
          {fyStats.isFinalMonth ? "for the year" : "to date"}
          {balancePoints > 0 && (
            <span className="text-stamp"> +{formatDays(balancePoints)}</span>
          )}
        </p>
      </div>
      <p className="text-sm text-fade">{fyVerdict(fyStats, monthStats)}</p>
      {carryNote && <p className="text-sm text-fade">{carryNote}</p>}
    </section>
  );
}
