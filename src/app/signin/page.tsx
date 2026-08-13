import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function SignInPage() {
  const session = await auth();
  if (session) redirect("/");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm border border-rule bg-white/40 p-8">
        <p className="font-mono text-[11px] font-medium tracking-[0.2em] text-fade uppercase">
          Attendance record
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          RTO Tracker
        </h1>
        <p className="mt-3 text-sm text-fade">
          Stamp your office days. Stay on the right side of 40%.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="mt-6 w-full border border-ink bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-ink/90"
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </main>
  );
}
