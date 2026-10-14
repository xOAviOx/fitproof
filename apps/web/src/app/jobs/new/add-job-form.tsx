"use client";

import { MAX_JOB_CHARACTERS, MIN_JOB_CHARACTERS } from "@repo/core";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { type AddJobState, addJobAction } from "../actions";

type Mode = "paste" | "link";
const MODES: { value: Mode; label: string }[] = [
  { value: "paste", label: "Paste the description" },
  { value: "link", label: "Use a link" },
];
const controlClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function AddJobForm() {
  const [state, action, pending] = useActionState<AddJobState, FormData>(addJobAction, { status: "idle" });
  const [mode, setMode] = useState<Mode>("paste");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (state.status === "error" && state.pasteInstead) {
      setMode("paste");
      setSourceUrl(state.pasteInstead.url);
    }
  }, [state]);

  const length = text.trim().length;
  const tooShort = length > 0 && length < MIN_JOB_CHARACTERS;
  return (
    <form action={action} className="space-y-8">
      <fieldset className="space-y-3">
        <legend className="mb-3 font-mono text-xs tracking-[0.16em] text-muted-foreground">
          HOW DO YOU WANT TO ADD IT?
        </legend>
        <div className="inline-flex border">
          {MODES.map((option) => (
            <label
              key={option.value}
              className={cn(
                "cursor-pointer px-4 py-2 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
                mode === option.value ? "bg-foreground text-background" : "hover:bg-muted",
              )}
            >
              <input
                type="radio"
                name="mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div id="add-job-message" aria-live="polite">
        {state.status === "error" && (
          <p role="alert" className="border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm">
            {state.message}
          </p>
        )}
      </div>

      {mode === "paste" ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="job-text">Job description</Label>
            <textarea
              id="job-text"
              name="text"
              rows={16}
              required
              maxLength={MAX_JOB_CHARACTERS + 5000}
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-describedby="job-text-help"
              aria-invalid={tooShort}
              placeholder="Paste everything: the role, responsibilities, requirements, and eligibility."
              className={cn(controlClass, "min-h-72 font-mono text-[13px]")}
            />
            <p
              id="job-text-help"
              className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"
            >
              <span>
                Include the requirements section. Recruiter emails and phone numbers are removed before any AI
                reads it.
              </span>
              <span className={cn("font-mono tabular-nums", tooShort && "text-destructive")}>
                {length.toLocaleString("en-IN")} / {MIN_JOB_CHARACTERS} min
              </span>
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="job-title">Job title (optional)</Label>
              <Input
                id="job-title"
                name="title"
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-company">Company (optional)</Label>
              <Input
                id="job-company"
                name="company"
                maxLength={200}
                value={company}
                onChange={(event) => setCompany(event.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="job-source">Link to the posting (optional)</Label>
              <Input
                id="job-source"
                name="sourceUrl"
                type="url"
                inputMode="url"
                maxLength={2000}
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                aria-describedby="job-source-help"
              />
              <p id="job-source-help" className="text-xs text-muted-foreground">
                Kept so you can apply from your tracker. We don’t open this link.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="job-url">Job link</Label>
          <Input
            id="job-url"
            name="url"
            type="url"
            inputMode="url"
            required
            maxLength={2000}
            placeholder="https://careers.example.com/jobs/backend-engineer"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-describedby="job-url-help"
          />
          <p id="job-url-help" className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Company career pages and applicant-tracking links work best. We read the page once, honour the
            site’s robots.txt, and keep a copy for 24 hours. LinkedIn, Naukri, Indeed, Glassdoor, and foundit
            don’t allow automated reading, so paste those descriptions instead.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t pt-6">
        <Button
          type="submit"
          size="lg"
          disabled={pending || (mode === "paste" && length < MIN_JOB_CHARACTERS)}
        >
          {pending ? (mode === "link" ? "Reading the page…" : "Adding…") : "Check this job"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Only you can see jobs you add. Reading the requirements takes up to a minute.
        </p>
      </div>
    </form>
  );
}
