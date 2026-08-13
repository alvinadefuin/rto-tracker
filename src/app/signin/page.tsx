import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function SignInPage() {
  const session = await auth();
  if (session) redirect("/");

  return (
    <main>
      <h1>RTO Tracker</h1>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button type="submit">Sign in with Google</button>
      </form>
    </main>
  );
}
