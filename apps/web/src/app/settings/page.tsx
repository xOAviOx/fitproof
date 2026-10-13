import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadPreferencesView } from "../preferences/load";
import { PreferencesForm } from "../preferences/preferences-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const { saved, ...view } = await loadPreferencesView(user.id);
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:py-14">
      <div className="mb-10 border-b pb-8">
        <p className="mb-3 font-mono text-xs tracking-[0.16em] text-muted-foreground">SETTINGS</p>
        <h1 className="text-4xl font-semibold tracking-tight">Search preferences</h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Edit any answer and save. Your filters update immediately. Signed in as{" "}
          {user.email ?? "your account"}.
        </p>
        {!saved && (
          <p className="mt-4 text-sm">
            New here?{" "}
            <Link className="underline underline-offset-4" href="/preferences">
              Use the step-by-step setup
            </Link>
            .
          </p>
        )}
      </div>
      <PreferencesForm mode="settings" {...view} />
    </main>
  );
}
