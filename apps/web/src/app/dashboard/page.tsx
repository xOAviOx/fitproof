import { schema, withUserContext } from "@repo/db";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Dashboard" };

const NEXT_STEPS = [
  "Upload your résumé and confirm your profile",
  "Set your preferences and eligibility",
  "Paste a job to see how well it fits",
];

export default async function DashboardPage() {
  const user = await requireUser();
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
            <h2>Your next steps</h2>
          </CardTitle>
          <CardDescription>These features are being built now and will appear here.</CardDescription>
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
