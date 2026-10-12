import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">The page you're looking for doesn't exist or has moved.</p>
      <Button asChild className="self-start">
        <Link href="/">Go home</Link>
      </Button>
    </main>
  );
}
