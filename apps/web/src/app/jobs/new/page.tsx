import { loadProfile } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { AddJobForm } from "./add-job-form";

export const metadata: Metadata = { title: "Check a job" };
// The analysis runs after the response, within this route's time limit.
export const maxDuration = 300;

export default async function NewJobPage() {
  const user = await requireUser();
  const { profile } = await loadProfile(getDb(), user.id);
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:py-14">
      <div className="mb-10 border-b pb-8">
        <p className="mb-3 font-mono text-xs tracking-[0.16em] text-muted-foreground">03 / CHECK A JOB</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Found a job?
          <br />
          See how you fit.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          We read the posting’s requirements, compare them with the evidence you confirmed, and show the exact
          lines behind every strength and gap.
        </p>
      </div>
      {profile?.status !== "confirmed" && (
        <p className="mb-8 border-l-2 border-foreground/50 bg-muted/40 px-4 py-3 text-sm">
          Your profile isn’t confirmed yet, so only confirmed entries count.{" "}
          <Link href="/profile" className="underline underline-offset-4">
            Review your profile
          </Link>{" "}
          for a fuller comparison.
        </p>
      )}
      <AddJobForm />
    </main>
  );
}
