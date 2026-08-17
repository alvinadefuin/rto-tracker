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
  } = stats;
  const filled = Math.min(officeDays, requiredDays);
  const extra = officeDays - filled;

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
        .
      </p>
    </section>
  );
}
