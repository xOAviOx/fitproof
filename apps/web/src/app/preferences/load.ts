import "server-only";
import { emptyPreferences, type Preferences, summarizeExperience } from "@repo/core";
import { loadPreferences, loadProfile } from "@repo/db";
import { getDb } from "@/lib/db";

/** Today's date in India, where the product's users are, as an ISO date. */
export const indiaToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

export async function loadPreferencesView(userId: string) {
  // Sequential on purpose: each call opens its own RLS transaction.
  const saved = await loadPreferences(getDb(), userId);
  const { profile, content } = await loadProfile(getDb(), userId);
  const today = indiaToday();
  const experience = profile?.status === "confirmed" ? summarizeExperience(content, today) : null;
  const education = [...content.education].sort(
    (a, b) => (b.graduationYear ?? 0) - (a.graduationYear ?? 0),
  )[0];
  let initial: Preferences = saved.preferences ?? emptyPreferences();
  const prefilled = !saved.preferences && Boolean(education);
  if (!saved.preferences && education) {
    initial = {
      ...initial,
      degree: education.degree,
      branch: education.branch,
      graduationYear: education.graduationYear,
      scoreType: education.score === null ? null : education.scoreType,
      score: education.scoreType === null ? null : education.score,
      scoreScale: education.score === null || education.scoreType === null ? null : education.scoreScale,
    };
  }
  return {
    initial,
    revision: saved.revision,
    saved: saved.preferences !== null,
    experience,
    today,
    prefilled,
  };
}
