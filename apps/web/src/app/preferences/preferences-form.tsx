"use client";

import {
  CGPA_SCALES,
  DEGREES,
  describeFilters,
  EMPLOYMENT_TYPE_LABELS,
  type ExperienceSummary,
  FIELDS,
  NOTICE_PERIOD_OPTIONS,
  PRODUCT,
  type PreferenceField,
  type Preferences,
  preferenceErrors,
  REMOTE_PREFERENCE_OPTIONS,
  REMOTE_PREFERENCES,
  ROLE_FAMILIES,
  ROLE_FAMILY_LABELS,
  SELECTABLE_EMPLOYMENT_TYPES,
  WORK_AUTHORIZATION_LABELS,
  WORK_AUTHORIZATION_STATUSES,
} from "@repo/core";
import Link from "next/link";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { type PreferencesActionState, savePreferencesAction } from "./actions";
import { FilterPreview } from "./filter-preview";
import { FilterSummary } from "./filter-summary";

type Values = {
  desiredRoles: Preferences["desiredRoles"];
  employmentTypes: Preferences["employmentTypes"];
  remotePreference: Preferences["remotePreference"];
  cities: string[];
  otherCities: string;
  willingToRelocate: boolean | null;
  salaryLpa: string;
  noticePeriodDays: number | null;
  availableFrom: string;
  graduationYear: string;
  degree: string;
  branch: string;
  scoreType: Preferences["scoreType"];
  score: string;
  scoreScale: number | null;
  workAuthorization: Preferences["workAuthorization"];
};

const MAIN_CITIES: readonly string[] = PRODUCT.cities;
const FIELD_OF: Partial<Record<keyof Values, PreferenceField>> = {
  cities: "locations",
  otherCities: "locations",
  salaryLpa: "minAnnualSalaryInr",
};

function toValues(p: Preferences): Values {
  return {
    desiredRoles: p.desiredRoles,
    employmentTypes: p.employmentTypes,
    remotePreference: p.remotePreference,
    cities: p.locations.filter((city) => MAIN_CITIES.includes(city)),
    otherCities: p.locations.filter((city) => !MAIN_CITIES.includes(city)).join(", "),
    willingToRelocate: p.willingToRelocate,
    salaryLpa: p.minAnnualSalaryInr === null ? "" : String(p.minAnnualSalaryInr / 100_000),
    noticePeriodDays: p.noticePeriodDays,
    availableFrom: p.availableFrom ?? "",
    graduationYear: p.graduationYear === null ? "" : String(p.graduationYear),
    degree: p.degree ?? "",
    branch: p.branch ?? "",
    scoreType: p.scoreType,
    score: p.score === null ? "" : String(p.score),
    scoreScale: p.scoreScale,
    workAuthorization: p.workAuthorization,
  };
}

const numberOrNull = (text: string) => (text.trim() === "" ? null : Number(text));

function toPreferences(v: Values): Preferences {
  const salary = numberOrNull(v.salaryLpa);
  return {
    desiredRoles: v.desiredRoles,
    employmentTypes: v.employmentTypes,
    remotePreference: v.remotePreference,
    locations: [
      ...v.cities,
      ...v.otherCities
        .split(",")
        .map((city) => city.trim())
        .filter(Boolean),
    ],
    willingToRelocate: v.willingToRelocate,
    minAnnualSalaryInr: salary === null ? null : Math.round(salary * 100_000),
    noticePeriodDays: v.noticePeriodDays,
    availableFrom: v.availableFrom || null,
    graduationYear: numberOrNull(v.graduationYear),
    degree: v.degree.trim() || null,
    branch: v.branch.trim() || null,
    scoreType: v.scoreType,
    score: numberOrNull(v.score),
    scoreScale: v.scoreType === "percentage" ? 100 : v.scoreScale,
    workAuthorization: v.workAuthorization,
  };
}

/** Half-typed numbers must not reach the live preview as NaN. */
function forPreview(p: Preferences): Preferences {
  const finite = (value: number | null) => (value !== null && Number.isFinite(value) ? value : null);
  return {
    ...p,
    minAnnualSalaryInr: finite(p.minAnnualSalaryInr),
    graduationYear: finite(p.graduationYear),
    score: finite(p.score),
  };
}

const STEPS = [
  {
    id: "search",
    label: "Roles",
    title: "What are you looking for?",
    note: "This sets your search. Jobs outside it are filtered out, and you can always see why.",
    fields: ["desiredRoles", "employmentTypes"],
  },
  {
    id: "place",
    label: "Location",
    title: "Where do you want to work?",
    note: "Cities apply to office and hybrid jobs. Remote jobs are never filtered by city.",
    fields: ["remotePreference", "locations", "willingToRelocate"],
  },
  {
    id: "timing",
    label: "Pay & timing",
    title: "Pay and availability",
    note: "Optional. Pay filters only jobs that publish it, and never internship stipends.",
    fields: ["minAnnualSalaryInr", "noticePeriodDays", "availableFrom"],
  },
  {
    id: "eligibility",
    label: "Eligibility",
    title: "Education and eligibility",
    note: "Employers screen on these. Leave anything uncertain empty. Unknown becomes a check, never a rejection.",
    fields: ["graduationYear", "degree", "branch", "scoreType", "score", "scoreScale", "workAuthorization"],
  },
  {
    id: "review",
    label: "Review",
    title: "Review your filters",
    note: "Here is exactly how your answers shape results. Change anything before saving.",
    fields: [],
  },
] as const satisfies readonly {
  id: string;
  label: string;
  title: string;
  note: string;
  fields: readonly PreferenceField[];
}[];
type StepId = (typeof STEPS)[number]["id"];
const REVIEW_STEP = STEPS.length - 1;

const controlClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive";
const choiceClass =
  "flex cursor-pointer items-start gap-3 border px-3 py-2.5 text-sm transition-colors hover:bg-muted/60 has-[:checked]:border-foreground has-[:checked]:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring";

function ErrorText({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-sm text-destructive">
      {message}
    </p>
  );
}

function Group({
  legend,
  hint,
  error,
  errorId,
  children,
}: {
  legend: string;
  hint?: string;
  error?: string;
  errorId: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="grid gap-2 pt-1 sm:grid-cols-2">{children}</div>
      <ErrorText id={errorId} message={error} />
    </fieldset>
  );
}

export function PreferencesForm({
  mode,
  initial,
  revision,
  experience,
  today,
  prefilled,
}: {
  mode: "wizard" | "settings";
  initial: Preferences;
  revision: string | null;
  experience: ExperienceSummary | null;
  today: string;
  prefilled: boolean;
}) {
  const [values, setValues] = useState(() => toValues(initial));
  const [errors, setErrors] = useState<Partial<Record<PreferenceField, string>>>({});
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [state, action, pending] = useActionState<PreferencesActionState, FormData>(savePreferencesAction, {
    status: "idle",
  });
  const formRef = useRef<HTMLFormElement>(null);
  const preferences = toPreferences(values);
  const currentRevision = state.status === "success" ? state.revision : revision;

  useEffect(() => {
    if (state.status === "success") setDirty(false);
    if (state.status === "error" && state.fieldErrors) setErrors(state.fieldErrors);
  }, [state]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function update<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
    const field = FIELD_OF[key] ?? (key as PreferenceField);
    setErrors((previous) => {
      const { [field]: _cleared, ...rest } = previous;
      return rest;
    });
  }
  function toggle<K extends "desiredRoles" | "employmentTypes" | "cities">(key: K, item: Values[K][number]) {
    const list = values[key] as string[];
    update(key, (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]) as Values[K]);
  }
  function focusFirstError() {
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
    );
  }
  function validate(fields: readonly PreferenceField[]) {
    const all = preferenceErrors(preferences);
    const relevant = Object.fromEntries(
      Object.entries(all).filter(([field]) => fields.includes(field as PreferenceField)),
    );
    setErrors(relevant);
    if (Object.keys(relevant).length) focusFirstError();
    return Object.keys(relevant).length === 0;
  }
  function goTo(index: number) {
    setStep(index);
    setReached((previous) => Math.max(previous, index));
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[data-step-heading]")?.focus());
  }
  function next() {
    const current = STEPS[step];
    if (current && validate(current.fields)) goTo(step + 1);
  }
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const all = preferenceErrors(preferences);
    if (!Object.keys(all).length) return;
    event.preventDefault();
    setErrors(all);
    if (mode === "wizard") {
      const index = STEPS.findIndex((s) => s.fields.some((field) => field in all));
      if (index >= 0) setStep(index);
    }
    focusFirstError();
  }
  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (
      mode === "wizard" &&
      step < REVIEW_STEP &&
      event.key === "Enter" &&
      event.target instanceof HTMLInputElement
    ) {
      event.preventDefault();
      next();
    }
  }

  const invalid = (field: PreferenceField) => (errors[field] ? true : undefined);
  const describedBy = (field: PreferenceField, hintId?: string) =>
    [errors[field] ? `${field}-error` : null, hintId].filter(Boolean).join(" ") || undefined;

  const sections: Record<Exclude<StepId, "review">, ReactNode> = {
    search: (
      <div className="space-y-8">
        <Group
          legend="Roles"
          hint="Choose every role family you'd accept."
          error={errors.desiredRoles}
          errorId="desiredRoles-error"
        >
          {ROLE_FAMILIES.map((role) => (
            <label key={role} className={choiceClass}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={values.desiredRoles.includes(role)}
                onChange={() => toggle("desiredRoles", role)}
                aria-invalid={invalid("desiredRoles")}
                aria-describedby={describedBy("desiredRoles")}
              />
              {ROLE_FAMILY_LABELS[role]}
            </label>
          ))}
        </Group>
        <Group legend="Job types" error={errors.employmentTypes} errorId="employmentTypes-error">
          {SELECTABLE_EMPLOYMENT_TYPES.map((type) => (
            <label key={type} className={choiceClass}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={values.employmentTypes.includes(type)}
                onChange={() => toggle("employmentTypes", type)}
                aria-invalid={invalid("employmentTypes")}
                aria-describedby={describedBy("employmentTypes")}
              />
              {EMPLOYMENT_TYPE_LABELS[type]}
            </label>
          ))}
        </Group>
      </div>
    ),
    place: (
      <div className="space-y-8">
        <Group legend="Work mode" error={errors.remotePreference} errorId="remotePreference-error">
          {REMOTE_PREFERENCES.map((option) => (
            <label key={option} className={choiceClass}>
              <input
                type="radio"
                name="remotePreference"
                className="mt-0.5"
                checked={values.remotePreference === option}
                onChange={() => update("remotePreference", option)}
              />
              <span>
                {REMOTE_PREFERENCE_OPTIONS[option].label}
                <span className="block text-xs text-muted-foreground">
                  {REMOTE_PREFERENCE_OPTIONS[option].description}
                </span>
              </span>
            </label>
          ))}
        </Group>
        {values.remotePreference !== "remote" && (
          <>
            <Group
              legend="Cities"
              hint={`${PRODUCT.name} currently covers ${PRODUCT.cities.join(", ")}, and remote jobs.`}
              error={errors.locations}
              errorId="locations-error"
            >
              {PRODUCT.cities.map((city) => (
                <label key={city} className={choiceClass}>
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={values.cities.includes(city)}
                    onChange={() => toggle("cities", city)}
                    aria-invalid={invalid("locations")}
                    aria-describedby={describedBy("locations")}
                  />
                  {city}
                </label>
              ))}
            </Group>
            <div>
              <Label htmlFor="other-cities">Other cities</Label>
              <Input
                id="other-cities"
                className="mt-2"
                value={values.otherCities}
                placeholder="For example: Chennai, Mumbai"
                aria-describedby="other-cities-hint"
                onChange={(event) => update("otherCities", event.target.value)}
              />
              <p id="other-cities-hint" className="mt-1 text-xs text-muted-foreground">
                Optional. Separate cities with commas.
              </p>
            </div>
            <Group
              legend="Open to relocating?"
              hint="If yes, office and hybrid jobs in other cities are not filtered out."
              errorId="willingToRelocate-error"
            >
              {(
                [
                  [true, "Yes"],
                  [false, "No"],
                  [null, "Not sure yet"],
                ] as const
              ).map(([value, label]) => (
                <label key={label} className={choiceClass}>
                  <input
                    type="radio"
                    name="willingToRelocate"
                    className="mt-0.5"
                    checked={values.willingToRelocate === value}
                    onChange={() => update("willingToRelocate", value)}
                  />
                  {label}
                </label>
              ))}
            </Group>
          </>
        )}
      </div>
    ),
    timing: (
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <Label htmlFor="salary">Minimum annual salary (LPA)</Label>
          <Input
            id="salary"
            className="mt-2"
            type="number"
            inputMode="decimal"
            min={0.5}
            max={500}
            step={0.5}
            value={values.salaryLpa}
            aria-invalid={invalid("minAnnualSalaryInr")}
            aria-describedby={describedBy("minAnnualSalaryInr", "salary-hint")}
            onChange={(event) => update("salaryLpa", event.target.value)}
          />
          <p id="salary-hint" className="mt-1 text-xs text-muted-foreground">
            In lakhs per annum, for example 6 or 6.5. Leave empty if pay shouldn't filter jobs.
          </p>
          <ErrorText id="minAnnualSalaryInr-error" message={errors.minAnnualSalaryInr} />
        </div>
        <div>
          <Label htmlFor="notice">Notice period</Label>
          <select
            id="notice"
            className={`${controlClass} mt-2`}
            value={values.noticePeriodDays === null ? "" : String(values.noticePeriodDays)}
            aria-invalid={invalid("noticePeriodDays")}
            aria-describedby={describedBy("noticePeriodDays")}
            onChange={(event) => update("noticePeriodDays", numberOrNull(event.target.value))}
          >
            <option value="">Not specified</option>
            {[...new Set([...NOTICE_PERIOD_OPTIONS, values.noticePeriodDays ?? 0])]
              .sort((a, b) => a - b)
              .map((days) => (
                <option key={days} value={days}>
                  {days === 0 ? "Available immediately" : `${days} days`}
                </option>
              ))}
          </select>
          <ErrorText id="noticePeriodDays-error" message={errors.noticePeriodDays} />
        </div>
        <div>
          <Label htmlFor="available-from">Available from</Label>
          <Input
            id="available-from"
            className="mt-2"
            type="date"
            value={values.availableFrom}
            aria-invalid={invalid("availableFrom")}
            aria-describedby={describedBy("availableFrom", "available-from-hint")}
            onChange={(event) => update("availableFrom", event.target.value)}
          />
          <p id="available-from-hint" className="mt-1 text-xs text-muted-foreground">
            Students: usually the date after your final exams.
          </p>
          <ErrorText id="availableFrom-error" message={errors.availableFrom} />
        </div>
      </div>
    ),
    eligibility: (
      <div className="space-y-8">
        {prefilled && (
          <p className="border-l-2 border-foreground py-1 pl-3 text-sm">
            We prefilled education from your profile. Check it before saving.
          </p>
        )}
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <Label htmlFor="graduation-year">Graduation year</Label>
            <Input
              id="graduation-year"
              className="mt-2"
              type="number"
              inputMode="numeric"
              min={1970}
              max={2100}
              value={values.graduationYear}
              aria-invalid={invalid("graduationYear")}
              aria-describedby={describedBy("graduationYear")}
              onChange={(event) => update("graduationYear", event.target.value)}
            />
            <ErrorText id="graduationYear-error" message={errors.graduationYear} />
          </div>
          <div>
            <Label htmlFor="degree">Degree</Label>
            <Input
              id="degree"
              className="mt-2"
              list="degree-options"
              maxLength={120}
              value={values.degree}
              aria-invalid={invalid("degree")}
              aria-describedby={describedBy("degree")}
              onChange={(event) => update("degree", event.target.value)}
            />
            <datalist id="degree-options">
              {DEGREES.map((degree) => (
                <option key={degree.key} value={degree.label} />
              ))}
            </datalist>
            <ErrorText id="degree-error" message={errors.degree} />
          </div>
          <div>
            <Label htmlFor="branch">Branch or major</Label>
            <Input
              id="branch"
              className="mt-2"
              list="branch-options"
              maxLength={120}
              value={values.branch}
              aria-invalid={invalid("branch")}
              aria-describedby={describedBy("branch")}
              onChange={(event) => update("branch", event.target.value)}
            />
            <datalist id="branch-options">
              {FIELDS.map((field) => (
                <option key={field.key} value={field.label} />
              ))}
            </datalist>
            <ErrorText id="branch-error" message={errors.branch} />
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <Label htmlFor="score-type">Score type</Label>
            <select
              id="score-type"
              className={`${controlClass} mt-2`}
              value={values.scoreType ?? ""}
              aria-invalid={invalid("scoreType")}
              aria-describedby={describedBy("scoreType")}
              onChange={(event) => {
                const type = event.target.value === "" ? null : (event.target.value as "cgpa" | "percentage");
                update("scoreType", type);
                if (type === "cgpa" && values.scoreScale === null) update("scoreScale", 10);
                if (type === "percentage") update("scoreScale", 100);
              }}
            >
              <option value="">Not specified</option>
              <option value="cgpa">CGPA</option>
              <option value="percentage">Percentage</option>
            </select>
            <ErrorText id="scoreType-error" message={errors.scoreType} />
          </div>
          <div>
            <Label htmlFor="score">Score</Label>
            <Input
              id="score"
              className="mt-2"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="any"
              value={values.score}
              aria-invalid={invalid("score")}
              aria-describedby={describedBy("score")}
              onChange={(event) => update("score", event.target.value)}
            />
            <ErrorText id="score-error" message={errors.score} />
          </div>
          {values.scoreType === "cgpa" && (
            <div>
              <Label htmlFor="score-scale">CGPA scale</Label>
              <select
                id="score-scale"
                className={`${controlClass} mt-2`}
                value={values.scoreScale ?? ""}
                aria-invalid={invalid("scoreScale")}
                aria-describedby={describedBy("scoreScale")}
                onChange={(event) => update("scoreScale", numberOrNull(event.target.value))}
              >
                {CGPA_SCALES.map((scale) => (
                  <option key={scale} value={scale}>
                    Out of {scale}
                  </option>
                ))}
              </select>
              <ErrorText id="scoreScale-error" message={errors.scoreScale} />
            </div>
          )}
        </div>
        <Group
          legend="Work authorization"
          hint="Used only to compare with job requirements. Never shared."
          error={errors.workAuthorization}
          errorId="workAuthorization-error"
        >
          {[...WORK_AUTHORIZATION_STATUSES, null].map((status) => (
            <label key={status ?? "unset"} className={choiceClass}>
              <input
                type="radio"
                name="workAuthorization"
                className="mt-0.5"
                checked={values.workAuthorization === status}
                onChange={() => update("workAuthorization", status)}
              />
              {status === null ? "Prefer not to say" : WORK_AUTHORIZATION_LABELS[status]}
            </label>
          ))}
        </Group>
      </div>
    ),
  };

  const review = (
    <div className="grid items-start gap-10 lg:grid-cols-2">
      <section aria-labelledby="filters-heading">
        <h3 id="filters-heading" className="mb-3 text-lg font-semibold tracking-tight">
          Your filters
        </h3>
        <FilterSummary rules={describeFilters(forPreview(preferences), experience)} />
      </section>
      <FilterPreview preferences={forPreview(preferences)} experience={experience} today={today} />
    </div>
  );

  const feedback = state.status !== "idle" && (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={cn("text-sm", state.status === "error" && "text-destructive")}
    >
      {state.message}
      {state.status === "success" && mode === "wizard" && (
        <>
          {" "}
          <Link className="underline underline-offset-4" href="/dashboard">
            Go to your dashboard
          </Link>{" "}
          or{" "}
          <Link className="underline underline-offset-4" href="/settings">
            edit them later in Settings
          </Link>
          .
        </>
      )}
    </p>
  );

  const hidden = (
    <>
      <input type="hidden" name="preferences" value={JSON.stringify(preferences)} />
      <input type="hidden" name="revision" value={currentRevision ?? ""} />
    </>
  );

  if (mode === "settings") {
    return (
      <form ref={formRef} action={action} onSubmit={onSubmit} noValidate className="space-y-12">
        {hidden}
        <fieldset disabled={pending} className="space-y-12">
          {STEPS.filter((s) => s.id !== "review").map((s, index) => (
            <section key={s.id} aria-labelledby={`${s.id}-heading`} className="border-t pt-6">
              <p className="mb-1 font-mono text-[10px] tracking-widest text-muted-foreground">
                {String(index + 1).padStart(2, "0")} / {s.label.toUpperCase()}
              </p>
              <h2 id={`${s.id}-heading`} className="text-xl font-semibold tracking-tight">
                {s.title}
              </h2>
              <p className="mt-1 mb-6 text-sm text-muted-foreground">{s.note}</p>
              {sections[s.id as Exclude<StepId, "review">]}
            </section>
          ))}
        </fieldset>
        <section aria-labelledby="review-heading" className="border-t pt-6">
          <h2 id="review-heading" className="mb-6 text-xl font-semibold tracking-tight">
            How these shape your results
          </h2>
          {review}
        </section>
        <div className="sticky bottom-0 space-y-3 border-t bg-background/95 py-4">
          {feedback}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save preferences"}
            </Button>
            <p className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : "All changes saved"}</p>
          </div>
        </div>
      </form>
    );
  }

  const current = STEPS[step] ?? STEPS[0];
  return (
    <form ref={formRef} action={action} onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
      {hidden}
      <ol aria-label="Steps" className="mb-10 grid grid-cols-5 gap-1 border-b pb-4">
        {STEPS.map((s, index) => (
          <li key={s.id}>
            <button
              type="button"
              disabled={index > reached || pending}
              aria-current={index === step ? "step" : undefined}
              onClick={() => goTo(index)}
              className={cn(
                "w-full border-t-2 pt-2 text-left transition-colors disabled:cursor-not-allowed",
                index === step
                  ? "border-foreground"
                  : index <= reached
                    ? "border-foreground/30"
                    : "border-border",
              )}
            >
              <span className="block font-mono text-[10px] tracking-widest text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span
                className={cn(
                  "hidden text-xs sm:block",
                  index === step ? "font-medium" : "text-muted-foreground",
                )}
              >
                {s.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <section aria-labelledby="step-heading" className="min-h-[24rem]">
        <p className="mb-1 font-mono text-[10px] tracking-widest text-muted-foreground">
          STEP {step + 1} OF {STEPS.length}
        </p>
        <h2
          id="step-heading"
          data-step-heading
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight focus:outline-none"
        >
          {current.title}
        </h2>
        <p className="mt-1 mb-8 text-sm text-muted-foreground">{current.note}</p>
        <fieldset disabled={pending}>{current.id === "review" ? review : sections[current.id]}</fieldset>
      </section>
      <div className="mt-10 space-y-3 border-t pt-4">
        {feedback}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={step === 0 || pending}
            onClick={() => goTo(step - 1)}
          >
            Back
          </Button>
          {step < REVIEW_STEP ? (
            <Button type="button" onClick={next}>
              Continue
            </Button>
          ) : (
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save preferences"}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
