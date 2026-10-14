import {
  describeFilters,
  formatList,
  type Preferences,
  REMOTE_PREFERENCE_OPTIONS,
  ROLE_FAMILY_LABELS,
} from "@repo/core";
import {
  listApplications,
  listUserJobs,
  loadPreferences,
  loadProfile,
  schema,
  withUserContext,
} from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Dashboard" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// Job lists are capped at 100 rows.
const count = (n: number, noun: string) => (n >= 100 ? `100+ ${noun}s` : plural(n, noun));

function summarizePreferences(preferences: Preferences): string {
  const scope = [
    formatList(preferences.desiredRoles.map((role) => ROLE_FAMILY_LABELS[role])),
    REMOTE_PREFERENCE_OPTIONS[preferences.remotePreference].label,
    preferences.remotePreference === "remote" ? "" : formatList(preferences.locations),
  ].filter(Boolean);
  // Experience comes from the profile, not from these answers.
  const missing = describeFilters(preferences, null).filter(
    (rule) => rule.kind === "missing" && rule.id !== "experience",
  ).length;
  const note = missing
    ? ` ${missing} ${missing === 1 ? "answer is" : "answers are"} missing, so jobs that ask about ${missing === 1 ? "it" : "them"} show a check.`
    : "";
  return `${scope.join(" · ")}.${note}`;
}

export default async function DashboardPage() {
  const user = await requireUser();
  const { profile, content } = await loadProfile(getDb(), user.id);
  const { preferences } = await loadPreferences(getDb(), user.id);
  const [jobs, applications] = await Promise.all([
    listUserJobs(getDb(), user.id),
    listApplications(getDb(), user.id),
  ]);
  const [account] = await withUserContext(getDb(), user.id, (tx) =>
    tx.select({ createdAt: schema.users.createdAt }).from(schema.users).limit(1),
  );

  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Welcome</h1>
        <p className="text-muted-foreground">
          Signed in as {user.email ?? "your account"}
          {account
            ? ` · member since ${account.createdAt.toLocaleDateString("en-IN", { dateStyle: "medium" })}`
            : ""}
        </p>
      </div>

      {!account && (
        <p role="alert" className="rounded-lg border border-destructive/40 p-4 text-sm">
          Your account record is still being set up. Refresh in a moment. If this persists, the database
          migrations may not have been applied (see RUNBOOK.md).
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Your candidate profile</h2>
          </CardTitle>
          <CardDescription>
            {profile?.status === "confirmed"
              ? `${plural(content.skills.length, "skill")}, ${plural(content.experiences.length, "work or internship entry", "work or internship entries")}, and ${plural(content.projects.length, "project")} confirmed.`
              : "Upload your résumé or build a profile manually. Review your evidence before anything is matched."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/profile">{profile ? "Review your profile" : "Create your profile"}</Link>
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Search preferences and eligibility</h2>
          </CardTitle>
          <CardDescription>
            {preferences
              ? summarizePreferences(preferences)
              : "Tell us what you're looking for and the facts employers screen on, such as graduation year and degree."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant={preferences ? "outline" : "default"}>
            <Link href={preferences ? "/settings" : "/preferences"}>
              {preferences ? "Edit preferences" : "Set your preferences"}
            </Link>
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Check a job</h2>
          </CardTitle>
          <CardDescription>
            {jobs.length
              ? `${count(jobs.length, "job")} checked, ${applications.length} saved to your tracker.`
              : "Paste a job description or a careers-page link to see which lines you already meet and what's missing."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant={profile?.status === "confirmed" ? "default" : "outline"}>
            <Link href="/jobs/new">Check a job</Link>
          </Button>
          {jobs.length > 0 && (
            <Button asChild variant="outline">
              <Link href="/jobs">Your jobs</Link>
            </Button>
          )}
          {applications.length > 0 && (
            <Button asChild variant="outline">
              <Link href="/tracker">Tracker</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
