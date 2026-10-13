import { loadProfile } from "@repo/db";
import type { Metadata } from "next";
import { serverEnv } from "@/env";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ProcessingStatus } from "./processing-status";
import { ProfileEditor } from "./profile-editor";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const { profile, content, resume } = await loadProfile(getDb(), user.id);
  const blocked = resume?.status === "uploaded" || resume?.status === "extracting";
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:py-14">
      <div className="mb-10 flex flex-wrap items-start justify-between gap-4 border-b pb-8">
        <div>
          <p className="mb-3 font-mono text-xs tracking-[0.16em] text-muted-foreground">
            01 / YOUR FOUNDATION
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Your experience,
            <br />
            in your words.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Start with your résumé. Review what we find, correct anything we miss, and confirm each entry.
            Nothing is matched until you’ve reviewed it.
          </p>
        </div>
        <span className="border px-3 py-1.5 font-mono text-xs uppercase tracking-wider">
          {profile?.status === "confirmed" ? "Confirmed" : "Draft · needs review"}
        </span>
      </div>
      <div className="grid items-start gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-6 lg:sticky lg:top-6">
          <div>
            <h2 className="mb-4 text-lg font-semibold">Start with a résumé</h2>
            <UploadForm enabled={serverEnv().RESUME_UPLOADS_ENABLED} replacing={Boolean(resume)} />
          </div>
          {resume && (
            <div className="space-y-3 border-t pt-4 text-sm">
              <p className="break-all text-muted-foreground">{resume.originalFilename}</p>
              <a className="underline underline-offset-4" href={`/api/resumes/${resume.id}/download`}>
                View original file
              </a>
              <ProcessingStatus status={resume.status} error={resume.error} />
            </div>
          )}
          <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
            Evidence matters more than keywords. Work, internships, projects, coursework, and self-declared
            skills remain distinct, so every future match has an honest basis.
          </p>
        </aside>
        <ProfileEditor
          key={profile?.updatedAt.toISOString() ?? "new"}
          initial={content}
          revision={profile?.updatedAt.toISOString() ?? null}
          blocked={blocked}
        />
      </div>
    </main>
  );
}
