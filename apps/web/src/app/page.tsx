import { PRODUCT, ROLE_FAMILIES, ROLE_FAMILY_LABELS } from "@repo/core";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    title: "Upload your résumé",
    body: "We turn it into an editable profile. You fix anything we got wrong.",
  },
  {
    title: "See why a job fits",
    body: "Every match links your experience to the exact lines in the job description.",
  },
  {
    title: "Know what to improve",
    body: "Gaps are named plainly, with suggestions that never invent experience.",
  },
];

export default function HomePage() {
  const cities = [...PRODUCT.cities, ...(PRODUCT.includesRemote ? ["Remote"] : [])].join(", ");
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-16">
      <section className="max-w-2xl space-y-6">
        <h1 className="text-4xl font-semibold tracking-tight text-balance">{PRODUCT.promise}</h1>
        <p className="text-lg text-muted-foreground">
          {PRODUCT.name} is for final-year students and early-career candidates looking for{" "}
          {ROLE_FAMILIES.map((family) => ROLE_FAMILY_LABELS[family]).join(", ")} roles in {cities}.
        </p>
        <Button asChild size="lg">
          <Link href="/login">Get started</Link>
        </Button>
      </section>

      <section aria-labelledby="how-it-works" className="mt-16">
        <h2 id="how-it-works" className="text-xl font-semibold">
          How it works
        </h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="space-y-2">
              <p className="text-sm text-muted-foreground">Step {index + 1}</p>
              <h3 className="font-medium">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <p className="mt-16 text-sm text-muted-foreground">
        Relevance is shown as Strong, Good, or Partial. It describes how well your experience matches the
        description, not your chance of being hired.
      </p>
    </main>
  );
}
