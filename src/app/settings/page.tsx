import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { rtoTargets, wfhMandates } from "@/db/schema";
import { DEFAULT_RTO_PERCENT } from "@/lib/rto";
import { addTargetPeriod } from "@/app/settings-actions";
import { addWfhMandate } from "@/app/mandate-actions";
import { PeriodForm } from "@/components/period-form";
import { PeriodRow } from "@/components/period-row";
import { MandateForm } from "@/components/mandate-form";
import { MandateRow } from "@/components/mandate-row";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const periods = await db
    .select()
    .from(rtoTargets)
    .where(eq(rtoTargets.userId, session.user.id))
    .orderBy(desc(rtoTargets.startMonth));

  const mandates = await db
    .select()
    .from(wfhMandates)
    .where(eq(wfhMandates.userId, session.user.id))
    .orderBy(desc(wfhMandates.startDate));

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-fade uppercase">
            RTO requirement
          </p>
          <Link
            href="/"
            className="font-mono text-[11px] tracking-[0.2em] text-fade uppercase underline-offset-4 hover:text-ink hover:underline"
          >
            Calendar
          </Link>
        </div>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
          Settings
        </h1>
      </header>

      <section className="space-y-6">
        <p className="text-sm text-fade">
          Default requirement is{" "}
          <span className="font-mono text-ink">{DEFAULT_RTO_PERCENT}%</span> of
          eligible working days. Add a period below to override it for a range
          of months — anything outside a period uses the default.
        </p>

        <div className="border border-rule bg-white/40">
          <div className="border-b border-rule px-4 py-2 font-mono text-[10px] tracking-widest text-fade uppercase">
            Periods
          </div>
          {periods.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fade">
              No periods yet. Every month uses the {DEFAULT_RTO_PERCENT}%
              default.
            </p>
          ) : (
            <ul>
              {periods.map((p) => (
                <PeriodRow
                  key={p.id}
                  id={p.id}
                  period={{
                    startMonth: p.startMonth,
                    endMonth: p.endMonth,
                    percent: p.percent,
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="border border-rule bg-white/40 p-4">
          <p className="mb-3 font-mono text-[10px] tracking-widest text-fade uppercase">
            Add a period
          </p>
          <PeriodForm action={addTargetPeriod} submitLabel="Add period" />
        </div>

        <div className="border-t border-rule pt-6">
          <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-fade uppercase">
            Mandated WFH
          </p>
          <p className="mt-2 text-sm text-fade">
            Days the business told everyone to work from home. These are removed
            from eligible working days entirely, so those months carry a smaller
            requirement — or none at all. Leave the end date blank while the
            mandate is open-ended.
          </p>
        </div>

        <div className="border border-rule bg-white/40">
          <div className="border-b border-rule px-4 py-2 font-mono text-[10px] tracking-widest text-fade uppercase">
            Mandates
          </div>
          {mandates.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fade">
              No mandates. Every working day counts toward your requirement.
            </p>
          ) : (
            <ul>
              {mandates.map((m) => (
                <MandateRow
                  key={m.id}
                  id={m.id}
                  mandate={{
                    startDate: m.startDate,
                    endDate: m.endDate,
                    reason: m.reason,
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="border border-rule bg-white/40 p-4">
          <p className="mb-3 font-mono text-[10px] tracking-widest text-fade uppercase">
            Add a mandate
          </p>
          <MandateForm action={addWfhMandate} submitLabel="Add mandate" />
        </div>
      </section>
    </main>
  );
}
