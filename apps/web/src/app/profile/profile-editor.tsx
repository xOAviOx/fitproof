"use client";

import {
  allEvidenceConfirmed,
  EVIDENCE_LABELS,
  EVIDENCE_TIERS,
  type EvidenceSection,
  hasEvidence,
  type ProfileContent,
} from "@repo/core";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ProfileActionState, saveProfileAction } from "./actions";

type Field = { key: string; label: string; type?: "list" | "textarea" | "date" | "number" | "url" };
const SECTIONS: { key: EvidenceSection; title: string; note: string; fields: Field[] }[] = [
  {
    key: "experiences",
    title: "Experience & internships",
    note: "Keep internships distinct from paid work.",
    fields: [
      { key: "company", label: "Company" },
      { key: "title", label: "Job title" },
      { key: "location", label: "Location" },
      { key: "startDate", label: "Start date", type: "date" },
      { key: "endDate", label: "End date", type: "date" },
      { key: "bullets", label: "Responsibilities & achievements", type: "list" },
      { key: "skills", label: "Skills used", type: "list" },
    ],
  },
  {
    key: "projects",
    title: "Projects",
    note: "What you built is evidence, even without a job title.",
    fields: [
      { key: "name", label: "Project name" },
      { key: "url", label: "Project URL", type: "url" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "bullets", label: "Contributions & outcomes", type: "list" },
      { key: "skills", label: "Skills used", type: "list" },
    ],
  },
  {
    key: "education",
    title: "Education",
    note: "Leave uncertain dates or scores empty. Unknown does not mean ineligible.",
    fields: [
      { key: "institution", label: "Institution" },
      { key: "degree", label: "Degree" },
      { key: "branch", label: "Branch / major" },
      { key: "startYear", label: "Start year", type: "number" },
      { key: "graduationYear", label: "Graduation year", type: "number" },
      { key: "score", label: "Score", type: "number" },
      { key: "scoreScale", label: "Score scale", type: "number" },
      { key: "coursework", label: "Relevant coursework", type: "list" },
    ],
  },
  {
    key: "certifications",
    title: "Certifications",
    note: "Courses and certifications are separate from work experience.",
    fields: [
      { key: "name", label: "Certification name" },
      { key: "issuer", label: "Issuer" },
      { key: "issuedOn", label: "Issue date", type: "date" },
      { key: "skills", label: "Skills covered", type: "list" },
    ],
  },
  {
    key: "skills",
    title: "Skills",
    note: "Manually added or changed skills are saved as self-declared evidence.",
    fields: [{ key: "name", label: "Skill name" }],
  },
];
const blankEntry = (section: EvidenceSection) => {
  const evidence = { sourceText: null, userConfirmed: false };
  switch (section) {
    case "skills":
      return { ...evidence, name: "", tier: "self_declared" };
    case "experiences":
      return {
        ...evidence,
        tier: "paid_work",
        company: "",
        title: "",
        location: null,
        startDate: null,
        endDate: null,
        isCurrent: false,
        bullets: [],
        skills: [],
      };
    case "projects":
      return { ...evidence, name: "", description: null, url: null, bullets: [], skills: [] };
    case "education":
      return {
        ...evidence,
        institution: "",
        degree: null,
        branch: null,
        startYear: null,
        graduationYear: null,
        scoreType: null,
        score: null,
        scoreScale: null,
        coursework: [],
      };
    case "certifications":
      return { ...evidence, name: "", issuer: null, issuedOn: null, skills: [] };
  }
};
const controlClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function ProfileEditor({
  initial,
  revision,
  blocked,
}: {
  initial: ProfileContent;
  revision: string | null;
  blocked: boolean;
}) {
  const [content, setContent] = useState(initial);
  const [linkKeys, setLinkKeys] = useState(() => initial.links.map((_, index) => `initial-link-${index}`));
  const [dirty, setDirty] = useState(false);
  const [state, action, pending] = useActionState<ProfileActionState, FormData>(saveProfileAction, {
    status: "idle",
  });
  const router = useRouter();
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function edit(next: ProfileContent) {
    setContent(next);
    setDirty(true);
  }
  function updateRow(section: EvidenceSection, index: number, key: string, value: unknown) {
    edit({
      ...content,
      [section]: content[section].map((row, i) =>
        i === index
          ? {
              ...row,
              [key]: value,
              userConfirmed: key === "userConfirmed" ? value : false,
              ...(key === "isCurrent" && value ? { endDate: null } : {}),
            }
          : row,
      ),
    });
  }
  const reviewed = allEvidenceConfirmed(content) && hasEvidence(content);
  return (
    <form action={action} className="space-y-10">
      <input type="hidden" name="content" value={JSON.stringify(content)} />
      <input type="hidden" name="revision" value={revision ?? ""} />
      <fieldset disabled={blocked || pending} className="space-y-10">
        <div className="space-y-3">
          <Label htmlFor="profile-summary">Summary</Label>
          <textarea
            id="profile-summary"
            className={controlClass}
            rows={3}
            maxLength={2000}
            value={content.summary ?? ""}
            onChange={(event) => edit({ ...content, summary: event.target.value || null })}
          />
          <p className="text-xs text-muted-foreground">
            Optional. Keep it factual. Matching uses the evidence below.
          </p>
        </div>
        {SECTIONS.map((section, sectionIndex) => (
          <section key={section.key} aria-labelledby={`${section.key}-heading`} className="border-t pt-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="mb-1 font-mono text-[10px] tracking-widest text-muted-foreground">
                  EVIDENCE / {String(sectionIndex + 1).padStart(2, "0")}
                </p>
                <h2 id={`${section.key}-heading`} className="text-xl font-semibold tracking-tight">
                  {section.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{section.note}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  edit({ ...content, [section.key]: [...content[section.key], blankEntry(section.key)] })
                }
              >
                Add{" "}
                {section.key === "experiences"
                  ? "experience"
                  : section.key === "education"
                    ? "education"
                    : section.key === "certifications"
                      ? "certification"
                      : section.key === "projects"
                        ? "project"
                        : "skill"}
              </Button>
            </div>
            {content[section.key].length === 0 && (
              <p className="border-l-2 border-border py-3 pl-4 text-sm text-muted-foreground">
                No entries yet. Add what you can support, and leave the rest empty.
              </p>
            )}
            <div className="space-y-8">
              {content[section.key].map((entry, index) => {
                const row = entry as unknown as Record<string, unknown>;
                const prefix = `${section.key}-${index}`;
                return (
                  <div key={entry.id ?? prefix} className="space-y-4 border-l-2 border-border pl-4 sm:pl-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                      {section.fields.map((field) => {
                        const id = `${prefix}-${field.key}`;
                        const value = row[field.key];
                        const isList = field.type === "list";
                        return (
                          <div
                            key={field.key}
                            className={isList || field.type === "textarea" ? "sm:col-span-2" : ""}
                          >
                            <Label htmlFor={id}>{field.label}</Label>
                            {isList || field.type === "textarea" ? (
                              <textarea
                                id={id}
                                className={`${controlClass} mt-2`}
                                rows={3}
                                aria-describedby={isList ? `${id}-help` : undefined}
                                value={Array.isArray(value) ? value.join("\n") : String(value ?? "")}
                                onChange={(event) =>
                                  updateRow(
                                    section.key,
                                    index,
                                    field.key,
                                    isList ? event.target.value.split("\n") : event.target.value || null,
                                  )
                                }
                              />
                            ) : (
                              <Input
                                id={id}
                                className="mt-2"
                                type={field.type ?? "text"}
                                step={field.type === "number" ? "any" : undefined}
                                value={String(value ?? "")}
                                onChange={(event) =>
                                  updateRow(
                                    section.key,
                                    index,
                                    field.key,
                                    field.type === "number"
                                      ? event.target.value === ""
                                        ? null
                                        : Number(event.target.value)
                                      : event.target.value ||
                                          (["name", "company", "title", "institution"].includes(field.key)
                                            ? ""
                                            : null),
                                  )
                                }
                              />
                            )}
                            {isList && (
                              <p id={`${id}-help`} className="mt-1 text-xs text-muted-foreground">
                                One item per line. Remove empty lines before saving.
                              </p>
                            )}
                          </div>
                        );
                      })}
                      {(section.key === "experiences" || section.key === "skills") && (
                        <div>
                          <Label htmlFor={`${prefix}-tier`}>Evidence tier</Label>
                          <select
                            id={`${prefix}-tier`}
                            className={`${controlClass} mt-2`}
                            value={String(row.tier)}
                            onChange={(event) => updateRow(section.key, index, "tier", event.target.value)}
                          >
                            {(section.key === "experiences"
                              ? (["paid_work", "internship"] as const)
                              : EVIDENCE_TIERS
                            ).map((tier) => (
                              <option key={tier} value={tier}>
                                {EVIDENCE_LABELS[tier]}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      {section.key === "experiences" && (
                        <label className="flex items-center gap-2 self-end py-2 text-sm">
                          <input
                            type="checkbox"
                            checked={Boolean(row.isCurrent)}
                            onChange={(event) =>
                              updateRow(section.key, index, "isCurrent", event.target.checked)
                            }
                          />
                          I currently work here
                        </label>
                      )}
                      {section.key === "education" && (
                        <div>
                          <Label htmlFor={`${prefix}-scoreType`}>Score type</Label>
                          <select
                            id={`${prefix}-scoreType`}
                            className={`${controlClass} mt-2`}
                            value={String(row.scoreType ?? "")}
                            onChange={(event) =>
                              updateRow(section.key, index, "scoreType", event.target.value || null)
                            }
                          >
                            <option value="">Not specified</option>
                            <option value="cgpa">CGPA</option>
                            <option value="percentage">Percentage</option>
                          </select>
                        </div>
                      )}
                    </div>
                    {entry.sourceText && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-muted-foreground">
                          View original résumé evidence
                        </summary>
                        <blockquote className="mt-2 whitespace-pre-wrap border-l-2 pl-3 text-muted-foreground">
                          {entry.sourceText}
                        </blockquote>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Changing this entry removes its résumé quote on save. It becomes your own confirmed
                          statement.
                        </p>
                      </details>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          checked={entry.userConfirmed}
                          onChange={(event) =>
                            updateRow(section.key, index, "userConfirmed", event.target.checked)
                          }
                        />
                        I confirm this {section.key === "skills" ? "skill" : "entry"} is accurate
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${section.title} entry ${index + 1}`}
                        onClick={() =>
                          edit({
                            ...content,
                            [section.key]: content[section.key].filter((_, i) => i !== index),
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <section className="border-t pt-6" aria-labelledby="links-heading">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 id="links-heading" className="text-xl font-semibold">
                Contact links
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Stored privately. Never sent to AI or used for matching.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setLinkKeys([...linkKeys, crypto.randomUUID()]);
                edit({ ...content, links: [...content.links, { label: "", url: "" }] });
              }}
            >
              Add link
            </Button>
          </div>
          {content.links.map((link, index) => (
            <div key={linkKeys[index]} className="mb-4 grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
              <div>
                <Label htmlFor={`link-label-${index}`}>Link label</Label>
                <Input
                  id={`link-label-${index}`}
                  className="mt-2"
                  value={link.label}
                  onChange={(event) =>
                    edit({
                      ...content,
                      links: content.links.map((row, i) =>
                        i === index ? { ...row, label: event.target.value } : row,
                      ),
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor={`link-url-${index}`}>URL</Label>
                <Input
                  type="url"
                  id={`link-url-${index}`}
                  className="mt-2"
                  value={link.url}
                  onChange={(event) =>
                    edit({
                      ...content,
                      links: content.links.map((row, i) =>
                        i === index ? { ...row, url: event.target.value } : row,
                      ),
                    })
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                aria-label={`Remove link ${index + 1}`}
                onClick={() => {
                  setLinkKeys(linkKeys.filter((_, i) => i !== index));
                  edit({ ...content, links: content.links.filter((_, i) => i !== index) });
                }}
              >
                Remove
              </Button>
            </div>
          ))}
        </section>
      </fieldset>
      <div className="sticky bottom-0 border-t bg-background/95 py-4">
        {state.status !== "idle" && (
          <p role={state.status === "error" ? "alert" : "status"} className="mb-3 text-sm">
            {state.message}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" name="intent" value="draft" variant="outline" disabled={blocked || pending}>
            {pending ? "Saving…" : "Save draft"}
          </Button>
          <Button type="submit" name="intent" value="confirm" disabled={blocked || pending || !reviewed}>
            Confirm profile
          </Button>
          <p className="text-xs text-muted-foreground">
            {blocked
              ? "Edits unlock after extraction finishes."
              : !reviewed
                ? "Confirm each entry to finish your review."
                : dirty
                  ? "Unsaved changes"
                  : "Every entry reviewed"}
          </p>
        </div>
      </div>
    </form>
  );
}
