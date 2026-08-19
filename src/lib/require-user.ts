import { auth } from "@/auth";

/**
 * The session user's id, or throws. Authentication failures throw rather than
 * returning an ActionState error: they are not something the user can fix by
 * editing the form.
 *
 * Kept apart from the ActionState type so importing that type into a client
 * component cannot drag `auth` into the client bundle.
 */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  return session.user.id;
}
