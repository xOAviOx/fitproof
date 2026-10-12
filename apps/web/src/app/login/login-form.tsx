"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type MagicLinkState, sendMagicLink, signInWithGoogle } from "./actions";

const initialState: MagicLinkState = { status: "idle" };

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(sendMagicLink, initialState);

  if (state.status === "sent") {
    return (
      <div role="status" className="space-y-2">
        <p className="font-medium">Check your email</p>
        <p className="text-sm text-muted-foreground">
          We sent a sign-in link to <span className="font-medium text-foreground">{state.email}</span>. Open
          it in this browser to continue.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-3" noValidate>
        <input type="hidden" name="next" value={next} />
        <div className="space-y-1.5">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={state.status === "error" || undefined}
            aria-describedby={state.status === "error" ? "email-error" : undefined}
          />
          {state.status === "error" && (
            <p id="email-error" role="alert" className="text-sm text-destructive">
              {state.message}
            </p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Sending link…" : "Email me a sign-in link"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="outline" className="w-full">
          Continue with Google
        </Button>
      </form>
    </div>
  );
}
