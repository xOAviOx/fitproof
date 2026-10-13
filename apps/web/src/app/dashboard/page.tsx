import { loadProfile, schema, withUserContext } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Dashboard" };

const NEXT_STEPS = ["Set your preferences and eligibility", "Paste a job to see how well it fits"];

export default async function DashboardPage() {
  const user = await requireUser();
  const { profile, content } = await loadProfile(getDb(), user.id);
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
              ? `${content.skills.length} skills, ${content.experiences.length} work or internship entries, and ${content.projects.length} projects confirmed.`
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
            <h2>Your next steps</h2>
          </CardTitle>
          <CardDescription>Coming in the next milestones.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {NEXT_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </main>
  );
}
