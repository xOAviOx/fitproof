import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadPreferencesView } from "./load";
import { PreferencesForm } from "./preferences-form";

export const metadata: Metadata = { title: "Preferences and eligibility" };

export default async function PreferencesPage() {
  const user = await requireUser();
  const { saved, ...view } = await loadPreferencesView(user.id);
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:py-14">
      <div className="mb-10 flex flex-wrap items-start justify-between gap-4 border-b pb-8">
        <div>
          <p className="mb-3 font-mono text-xs tracking-[0.16em] text-muted-foreground">02 / YOUR SEARCH</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            What you want,
            <br />
            and what you qualify for.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Five short steps. We filter only on what we know: anything you leave empty becomes a check for you
            to confirm, never a silent rejection.
          </p>
        </div>
        <span className="border px-3 py-1.5 font-mono text-xs uppercase tracking-wider">
          {saved ? "Saved" : "Not set up"}
        </span>
      </div>
      {saved && (
        <p className="mb-8 text-sm text-muted-foreground">
          Already set up. You can also{" "}
          <Link className="text-foreground underline underline-offset-4" href="/settings">
            edit everything on one page in Settings
          </Link>
          .
        </p>
      )}
      <PreferencesForm mode="wizard" {...view} />
    </main>
  );
}
