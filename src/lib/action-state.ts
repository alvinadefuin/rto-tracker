/**
 * What every settings server action resolves to. `null` means "not submitted
 * yet", which is the initial state useActionState is seeded with.
 *
 * Deliberately alone in this module and exporting no runtime value, so a client
 * component can import it without pulling anything server-only into the bundle.
 */
export type ActionState = { error?: string } | null;
