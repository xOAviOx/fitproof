"use client";

import { MAX_RESUME_BYTES, validateResumeFile } from "@repo/core";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ProfileActionState, uploadResumeAction } from "./actions";

export function UploadForm({ enabled, replacing }: { enabled: boolean; replacing: boolean }) {
  const [state, action, pending] = useActionState<ProfileActionState, FormData>(uploadResumeAction, {
    status: "idle",
  });
  const [fileError, setFileError] = useState<string | null>(null);
  const [validFile, setValidFile] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") {
      if (input.current) input.current.value = "";
      setValidFile(false);
      router.refresh();
    }
  }, [state, router]);
  return (
    <form action={action} className="space-y-4">
      <div>
        <Label htmlFor="resume">PDF or DOCX résumé</Label>
        <Input
          ref={input}
          id="resume"
          name="resume"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          disabled={!enabled || pending}
          required
          aria-describedby="upload-help upload-message"
          aria-invalid={Boolean(fileError)}
          className="mt-2 h-auto py-3"
          onChange={(event) => {
            const file = event.target.files?.[0];
            setValidFile(false);
            setFileError(null);
            if (!file) return;
            try {
              validateResumeFile(file);
              setValidFile(file.size <= MAX_RESUME_BYTES);
            } catch (error) {
              setFileError(error instanceof Error ? error.message : "Choose a PDF or DOCX.");
            }
          }}
        />
      </div>
      <p id="upload-help" className="text-xs leading-relaxed text-muted-foreground">
        Maximum 5 MB. Text-based files only. Private storage, with contact details removed before AI
        processing.
        {replacing &&
          " Re-uploading replaces your draft after extraction succeeds. Save any edits you want to keep first."}
      </p>
      {!enabled && (
        <p className="text-sm text-muted-foreground">
          Uploads aren’t configured yet. Add your experience manually below, or ask the operator to enable
          extraction.
        </p>
      )}
      <div id="upload-message" aria-live="polite">
        {fileError && (
          <p role="alert" className="text-sm text-destructive">
            {fileError}
          </p>
        )}
        {state.status !== "idle" && (
          <p role={state.status === "error" ? "alert" : "status"} className="text-sm">
            {state.message}
          </p>
        )}
      </div>
      <Button type="submit" disabled={!enabled || pending || !validFile}>
        {pending ? "Uploading…" : replacing ? "Upload a new résumé" : "Upload résumé"}
      </Button>
    </form>
  );
}
