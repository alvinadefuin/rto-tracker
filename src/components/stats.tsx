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
  fy,
}: {
  stats: MonthStats;
  fy: FyStats | null;
}) {
  return (
    <section aria-label="Progress" className="space-y-4">
      <MonthBlock stats={stats} fy={fy} />
      {fy && (
        <div className="border-t border-rule pt-4">
          <FyBlock fy={fy} monthStats={stats} />
        </div>
      )}
    </section>
  );
}

function MonthBlock({ stats, fy }: { stats: MonthStats; fy: FyStats | null }) {
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
  const owedForYear = fy === null || fy.remainingNeeded > 0;

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
            <span className="text-holiday">target met</span>
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
  fy,
  monthStats,
}: {
  fy: FyStats;
  monthStats: MonthStats;
}) {
  const { cumulativeOffice, cumulativeRequired, balance } = fy;
  // Full when nothing is required: an empty bar against a zero target would
  // read as no progress rather than no obligation.
  const fillPercent =
    cumulativeRequired === 0
      ? 100
      : Math.min(100, Math.round((cumulativeOffice / cumulativeRequired) * 100));

  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] tracking-widest text-fade uppercase">
        FY{fy.fy} · {formatMonth(fy.fyStartMonth)} –{" "}
        {formatMonth(fy.fyEndMonth)}
        {fy.isPartialWindow && (
          <> · counted from {formatMonth(fy.windowStartMonth)}</>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Carries nothing the text does not, exactly as the rings above. */}
        <div
          aria-hidden
          className="h-2 w-40 border border-rule bg-transparent sm:w-56"
        >
          <div
            className="h-full bg-stamp"
            style={{ width: `${fillPercent}%` }}
          />
        </div>
        <p className="font-mono text-sm">
          {cumulativeOffice}/{cumulativeRequired}{" "}
          {fy.isFinalMonth ? "for the year" : "to date"}
          {balance > 0 && <span className="text-stamp"> +{balance}</span>}
        </p>
      </div>
      <p className="text-sm text-fade">{fyVerdict(fy, monthStats)}</p>
    </div>
  );
}
