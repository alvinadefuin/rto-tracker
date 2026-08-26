/**
 * What every settings server action resolves to. `null` means "not submitted
 * yet", which is the initial state useActionState is seeded with.
 *
 * Deliberately alone in this module and exporting no runtime value, so a client
 * component can import it without pulling anything server-only into the bundle.
 *
 * `notice` carries a success summary. Note that `PeriodForm` and `MandateForm`
 * detect success as a `pending` true→false edge landing without an error, on
 * the assumption that a successful action resolves to `null`. That assumption
 * does not hold for an action returning a notice, so such an action needs its
 * own form component rather than that pattern.
 */
export type ActionState = { error?: string; notice?: string } | null;
