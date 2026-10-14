"use client";

import { APPLICATION_STATUS_LABELS, APPLICATION_STATUSES, type ApplicationStatus } from "@repo/core";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { removeApplicationAction, type TrackerActionState, updateApplicationAction } from "./actions";

const idle: TrackerActionState = { status: "idle" };
const controlClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export type TrackerEntryProps = {
  id: string;
  title: string;
  revision: string;
  status: ApplicationStatus;
  notes: string;
  nextActionAt: string;
};

function Message({ state }: { state: TrackerActionState }) {
  if (state.status === "idle") return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={cn("text-xs", state.status === "error" && "text-destructive")}
    >
      {state.message}
    </p>
  );
}

export function TrackerEntryForm(props: TrackerEntryProps) {
  const [state, action, pending] = useActionState(updateApplicationAction, idle);
  const [removeState, remove, removing] = useActionState(removeApplicationAction, idle);
  const [status, setStatus] = useState(props.status);
  const [notes, setNotes] = useState(props.notes);
  const [nextActionAt, setNextActionAt] = useState(props.nextActionAt);
  const [confirming, setConfirming] = useState(false);
  const prefix = `entry-${props.id}`;
  return (
    <div className="space-y-4">
      <form action={action} className="grid gap-4 sm:grid-cols-[12rem_10rem_minmax(0,1fr)]">
        <input type="hidden" name="id" value={props.id} />
        <input type="hidden" name="revision" value={props.revision} />
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-status`}>Status</Label>
          <select
            id={`${prefix}-status`}
            name="status"
            value={status}
            onChange={(event) => setStatus(event.target.value as ApplicationStatus)}
            className={cn(controlClass, "h-9 py-1")}
          >
            {APPLICATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {APPLICATION_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-next`}>Next step on</Label>
          <Input
            id={`${prefix}-next`}
            name="nextActionAt"
            type="date"
            value={nextActionAt}
            onChange={(event) => setNextActionAt(event.target.value)}
            className="h-9"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-notes`}>Notes</Label>
          <textarea
            id={`${prefix}-notes`}
            name="notes"
            rows={2}
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className={controlClass}
            placeholder="Referral, recruiter, interview dates…"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Button type="submit" size="sm" disabled={pending} aria-label={`Save changes to ${props.title}`}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Message state={state} />
        </div>
      </form>
      <form action={remove} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={props.id} />
        {confirming ? (
          <>
            <span className="text-xs">Remove this entry and its notes?</span>
            <Button type="submit" size="xs" variant="destructive" disabled={removing}>
              {removing ? "Removing…" : "Remove"}
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => setConfirming(true)}
            aria-label={`Remove ${props.title} from tracker`}
          >
            Remove from tracker
          </Button>
        )}
        <Message state={removeState} />
      </form>
    </div>
  );
}
