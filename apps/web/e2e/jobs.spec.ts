import { expect, type Page, test } from "@playwright/test";
import { signIn, waitForHydration } from "./helpers";

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "Synthetic auth services are only available in isolated local e2e.",
);

// The e2e server runs without LLM keys, so jobs are read by the keyword reader and explained with the
// structured fallback. Both use the same quote verification as the model path.
const POSTING = [
  "Backend Engineer, Example Labs",
  "Bengaluru, hybrid. You will build and run the APIs behind our payments product.",
  "",
  "Requirements",
  "- Strong experience designing schemas and queries in PostgreSQL.",
  "- Hands-on Docker for local development and deployment.",
  "",
  "Nice to have",
  "- Some exposure to Kubernetes in production.",
].join("\n");

const section = (page: Page, name: string) => page.getByRole("region", { name });
const item = (page: Page, sectionName: string, text: string) =>
  section(page, sectionName)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: text }) });

async function confirmSkillProfile(page: Page, skill: string) {
  await signIn(page, "/profile");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Add skill", exact: true }).click();
  await page.getByLabel("Skill name").fill(skill);
  await page.getByRole("checkbox", { name: "I confirm this skill is accurate" }).check();
  await page.getByRole("button", { name: "Confirm profile" }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
}

async function addPastedJob(page: Page) {
  await page.goto("/jobs/new");
  await waitForHydration(page);
  await page.getByLabel("Job description").fill(POSTING);
  await page.getByLabel("Job title (optional)").fill("Backend Engineer");
  await page.getByLabel("Company (optional)").fill("Example Labs");
  await page.getByRole("button", { name: "Check this job" }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Backend Engineer");
  await expect(section(page, "Where you match")).toBeVisible({ timeout: 30_000 });
}

test("paste a job, see quoted evidence, answer a gap, save it, and track it", async ({ page }) => {
  test.setTimeout(90_000);
  await confirmSkillProfile(page, "PostgreSQL");
  await addPastedJob(page);

  await expect(page.getByText("Read without AI")).toBeVisible();
  const match = item(page, "Where you match", "PostgreSQL");
  await expect(match.getByRole("blockquote")).toContainText("PostgreSQL");
  const docker = item(page, "Gaps to close", "Docker");
  await expect(docker.getByRole("blockquote")).toContainText("Hands-on Docker for local development");
  await expect(item(page, "Gaps to close", "Kubernetes")).toContainText("Nice to have");

  // Side by side: the posting line and the profile evidence are both highlighted.
  await match.getByRole("button", { name: "Show in context" }).click();
  await expect(match.getByRole("button", { name: "Show in context" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("region", { name: "The posting" }).locator("mark", { hasText: "PostgreSQL" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Your evidence" }).locator("mark", { hasText: "PostgreSQL" }),
  ).toBeVisible();

  await docker.getByRole("button", { name: "I have Docker: add it to my profile" }).click();
  await expect(item(page, "Where you match", "Docker")).toContainText("self-declared skill");
  await expect(item(page, "Gaps to close", "Docker")).toHaveCount(0);

  await page.getByRole("button", { name: "Save to tracker" }).click();
  await page.getByRole("link", { name: "View in tracker" }).click();
  const entry = page.getByRole("article", { name: "Backend Engineer" });
  await expect(entry).toContainText("Example Labs");
  await waitForHydration(page);
  await entry.getByLabel("Status").selectOption("applied");
  await entry.getByLabel("Notes").fill("Referred by a senior engineer.");
  await entry.getByRole("button", { name: "Save changes to Backend Engineer" }).click();
  await expect(entry.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await page.reload();
  await expect(entry.getByLabel("Status")).toHaveValue("applied");
  await expect(entry.getByLabel("Notes")).toHaveValue("Referred by a senior engineer.");
  await expect(entry.getByRole("paragraph").filter({ hasText: /· Applied \d/ })).toBeVisible();

  await page.goto("/profile");
  await expect(page.getByLabel("Skill name").nth(1)).toHaveValue("Docker");
});

test("undoing a gap answer removes the skill and restores the gap", async ({ page }) => {
  test.setTimeout(90_000);
  await confirmSkillProfile(page, "PostgreSQL");
  await addPastedJob(page);
  await waitForHydration(page, "main form");
  await item(page, "Gaps to close", "Docker")
    .getByRole("button", { name: "I have Docker: add it to my profile" })
    .click();
  await item(page, "Where you match", "Docker")
    .getByRole("button", { name: "I don't have Docker: remove it from my profile" })
    .click();
  const gap = item(page, "Gaps to close", "Docker");
  await expect(gap).toContainText("You said you don’t have this yet.");
  await expect(gap.getByRole("button", { name: "I don't have Docker" })).toBeDisabled();
  await page.goto("/profile");
  await expect(page.getByLabel("Skill name")).toHaveCount(1);
});

test("job links from blocked sites switch to paste and keep the link", async ({ page }) => {
  await signIn(page, "/jobs/new");
  await waitForHydration(page);
  await expect(page.getByText("Your profile isn’t confirmed yet")).toBeVisible();
  // The radio itself is visually hidden; people choose by clicking its label.
  await page.getByText("Use a link", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "Use a link" })).toBeChecked();
  const link = "https://www.linkedin.com/jobs/view/1234567890";
  await page.getByLabel("Job link").fill(link);
  await page.getByRole("button", { name: "Check this job" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "LinkedIn doesn't allow automated access" }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: "Paste the description" })).toBeChecked();
  await expect(page.getByLabel("Link to the posting (optional)")).toHaveValue(link);
  await expect(page.getByRole("button", { name: "Check this job" })).toBeDisabled();
});

test("jobs and their status are private to the user who added them", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await confirmSkillProfile(page, "PostgreSQL");
  await addPastedJob(page);
  const jobUrl = page.url();
  const statusUrl = `/api/jobs/${new URL(jobUrl).pathname.split("/").pop()}/status`;
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const otherPage = await other.newPage();
    await signIn(otherPage, "/jobs");
    await expect(otherPage.getByText("No jobs yet")).toBeVisible();
    await otherPage.goto(jobUrl);
    await expect(otherPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(otherPage.getByText("Backend Engineer")).toHaveCount(0);
    expect((await other.request.get(statusUrl)).status()).toBe(404);
  } finally {
    await other.close();
  }
  expect((await page.request.get(statusUrl)).ok()).toBe(true);
});
