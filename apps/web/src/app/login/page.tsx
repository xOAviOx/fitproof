import { PRODUCT } from "@repo/core";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNextPath } from "@/lib/safe-redirect";
import type { SearchParams } from "@/lib/search-params";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { next } = await searchParams;
  return (
    <main id="main" className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Sign in to {PRODUCT.name}</h1>
          </CardTitle>
          <CardDescription>No password needed. New here? Signing in creates your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={safeNextPath(next)} />
        </CardContent>
      </Card>
    </main>
  );
}
