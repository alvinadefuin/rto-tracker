import { DEFAULT_RTO_PERCENT, type MonthStats } from "@/lib/rto";

// Stamp-card meter: one ring per required office day, filled as stamped.
export function Stats({ stats }: { stats: MonthStats }) {
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
      <section aria-label="Monthly progress" className="space-y-2">
        <p className="font-mono text-sm">No requirement — mandated WFH</p>
        <p className="text-sm text-fade">
          All {mandatedDays} working days this month are mandated work from home,
          so no office days are required.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Monthly progress" className="space-y-2">
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
            <span className="text-stamp">{remainingNeeded} to go</span>
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
    </section>
  );
}
