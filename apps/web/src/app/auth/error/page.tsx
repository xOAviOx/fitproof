import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { SearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "Sign-in problem" };

const MESSAGES: Record<string, string> = {
  link: "That sign-in link is invalid or has expired. Links work once and expire after a short time.",
  callback:
    "We couldn't finish signing you in. If you used an email link, open it in the same browser you requested it from.",
  oauth: "We couldn't start Google sign-in. Try again, or use an email link instead.",
};

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { reason } = await searchParams;
  const message =
    (typeof reason === "string" && MESSAGES[reason]) || "Something went wrong while signing in.";
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-xl font-semibold">Sign-in didn't work</h1>
      <p className="text-muted-foreground">{message}</p>
      <Button asChild className="self-start">
        <Link href="/login">Back to sign in</Link>
      </Button>
    </main>
  );
}
