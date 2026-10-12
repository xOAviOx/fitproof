import { PRODUCT } from "@repo/core";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: { default: PRODUCT.name, template: `%s · ${PRODUCT.name}` },
  description: PRODUCT.promise,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body className="flex min-h-dvh flex-col bg-background text-foreground antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        <header className="border-b">
          <nav
            aria-label="Main"
            className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4"
          >
            <Link href={user ? "/dashboard" : "/"} className="font-semibold">
              {PRODUCT.name}
            </Link>
            {user ? (
              <div className="flex items-center gap-2">
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard">Dashboard</Link>
                </Button>
                <form action="/auth/signout" method="post">
                  <Button type="submit" variant="outline" size="sm">
                    Sign out
                  </Button>
                </form>
              </div>
            ) : (
              <Button asChild size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
            )}
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
