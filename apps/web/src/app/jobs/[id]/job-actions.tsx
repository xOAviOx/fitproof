"use client";

import type { GapResponse } from "@repo/core";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type ActionState, answerGapAction, recheckJobAction, saveJobAction } from "../actions";

const idle: ActionState = { status: "idle" };

function Message({ state, className }: { state: ActionState; className?: string }) {
  if (state.status === "idle") return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={cn("text-xs", state.status === "error" && "text-destructive", className)}
    >
      {state.message}
    </p>
  );
}

export function SaveJobButton({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState(saveJobAction, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="jobId" value={jobId} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save to tracker"}
      </Button>
      <Message state={state} />
    </form>
  );
}

export function RecheckButton({
  jobId,
  label = "Check again",
  variant = "outline",
}: {
  jobId: string;
  label?: string;
  variant?: "outline" | "default";
}) {
  const [state, action, pending] = useActionState(recheckJobAction, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="jobId" value={jobId} />
      <Button type="submit" variant={variant} size="sm" disabled={pending}>
        {pending ? "Starting…" : label}
      </Button>
      <Message state={state} />
    </form>
  );
}

/** "I have this" adds the skill to the profile as self-declared; "I don't have this" keeps the gap. */
export function GapAnswer({
  jobId,
  requirementId,
  skill,
  response,
  undoOnly = false,
}: {
  jobId: string;
  requirementId: string;
  skill: string;
  response: GapResponse | null;
  undoOnly?: boolean;
}) {
  const [state, action, pending] = useActionState(answerGapAction, idle);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="requirementId" value={requirementId} />
      <div className="flex flex-wrap gap-2">
        {!undoOnly && (
          <Button
            type="submit"
            name="response"
            value="has_it"
            size="sm"
            disabled={pending}
            aria-label={`I have ${skill}: add it to my profile`}
          >
            I have this, add to profile
          </Button>
        )}
        <Button
          type="submit"
          name="response"
          value="does_not_have"
          size="sm"
          variant="outline"
          disabled={pending || response === "does_not_have"}
          aria-pressed={response === "does_not_have"}
          aria-label={undoOnly ? `I don't have ${skill}: remove it from my profile` : `I don't have ${skill}`}
        >
          {undoOnly ? "Undo: I don't have this" : "I don't have this"}
        </Button>
      </div>
      <Message state={state} />
    </form>
  );
}
