import { PRODUCT } from "@repo/core";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/jobs", label: "Jobs" },
  { href: "/tracker", label: "Tracker" },
  { href: "/profile", label: "Profile" },
  { href: "/settings", label: "Settings" },
];

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
            className="mx-auto flex min-h-14 w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2"
          >
            <Link href={user ? "/dashboard" : "/"} className="font-semibold">
              {PRODUCT.name}
            </Link>
            {user ? (
              <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                {[...NAV_LINKS, ...(isAdmin(user) ? [{ href: "/admin", label: "Admin" }] : [])].map(
                  (link) => (
                    <Button key={link.href} asChild variant="ghost" size="sm">
                      <Link href={link.href}>{link.label}</Link>
                    </Button>
                  ),
                )}
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
