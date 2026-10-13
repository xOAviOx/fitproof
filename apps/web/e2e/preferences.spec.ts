import { expect, type Page, test } from "@playwright/test";
import { fixturePdf } from "../../worker/src/testing/resume-fixtures";
import { signIn, upload, waitForHydration } from "./helpers";

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "Synthetic auth services are only available in isolated local e2e.",
);

const BACKEND = "Backend / Software Developer";
const alert = (page: Page, text: string) => page.getByRole("alert").filter({ hasText: text });
const example = (page: Page, title: string) => page.getByRole("article", { name: title });
const saved = (page: Page) => page.getByRole("status").filter({ hasText: "Preferences saved." });

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("wizard validates each step, previews filters, and persists after reload", async ({ page }) => {
  await signIn(page, "/preferences");
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("What you want");
  await expect(page.getByText("Not set up", { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(alert(page, "Choose at least one role.")).toBeVisible();
  await expect(alert(page, "Choose at least one job type.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: BACKEND })).toBeFocused();
  await page.getByRole("checkbox", { name: BACKEND }).check();
  await page.getByRole("checkbox", { name: "Full-time" }).check();
  await expect(alert(page, "Choose at least one role.")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Where do you want to work?" })).toBeFocused();
  await page.getByRole("radio", { name: /^Hybrid or remote/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(alert(page, "Choose at least one city, or choose remote only.")).toBeVisible();
  await page.getByRole("checkbox", { name: "Bengaluru" }).check();
  await page.getByRole("radio", { name: "No", exact: true }).check();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Pay and availability" })).toBeVisible();
  await page.getByLabel("Minimum annual salary (LPA)").fill("0.1");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(alert(page, "Enter at least ₹0.5 LPA")).toBeVisible();
  await page.getByLabel("Minimum annual salary (LPA)").fill("6");
  await page.getByLabel("Notice period").selectOption("30");
  // Enter advances instead of submitting the whole wizard early.
  await page.getByLabel("Minimum annual salary (LPA)").press("Enter");

  await expect(page.getByRole("heading", { name: "Education and eligibility" })).toBeVisible();
  await page.getByLabel("Graduation year").fill("2025");
  await page.getByLabel("Degree", { exact: true }).fill("B.Tech");
  await page.getByLabel("Branch or major").fill("Computer Science");
  await page.getByLabel("Score type").selectOption("cgpa");
  await page.getByLabel("Score", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(alert(page, "Enter a score up to 10.")).toBeVisible();
  await page.getByLabel("Score", { exact: true }).fill("8.2");
  await page.getByRole("radio", { name: /^Authorized to work in India/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Review your filters" })).toBeVisible();
  await expect(page.getByText("At least ₹6 LPA")).toBeVisible();
  await expect(
    example(page, "Backend Engineer, New Grad").getByText("Shown with checks", { exact: true }),
  ).toBeVisible();
  await expect(example(page, "Backend Engineer, New Grad")).toContainText(
    "Confirm your profile with dated work entries",
  );
  await expect(example(page, "Data Analyst").getByText("Filtered out", { exact: true })).toBeVisible();
  await expect(example(page, "Data Analyst")).toContainText("This is a Data Analyst role.");
  await expect(
    example(page, "Software Engineer II").getByText("Filtered out", { exact: true }),
  ).toBeVisible();
  await expect(example(page, "Backend Developer (Contract)")).toContainText("Job type is contract.");
  await expectNoHorizontalScroll(page);

  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(saved(page)).toBeVisible();
  await expect(page.locator('input[name="revision"]')).not.toHaveValue("");

  await page.reload();

  await waitForHydration(page);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: BACKEND })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Internship" })).not.toBeChecked();
  await page.getByRole("link", { name: "edit everything on one page in Settings" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Search preferences");
  await expect(page.getByRole("checkbox", { name: "Bengaluru" })).toBeChecked();
  await expect(page.getByRole("radio", { name: /^Hybrid or remote/ })).toBeChecked();
  await expect(page.getByLabel("Minimum annual salary (LPA)")).toHaveValue("6");
  await expect(page.getByLabel("Notice period")).toHaveValue("30");
  await expect(page.getByLabel("Graduation year")).toHaveValue("2025");
  await expect(page.getByLabel("Degree", { exact: true })).toHaveValue("B.Tech");
  await expect(page.getByLabel("Score", { exact: true })).toHaveValue("8.2");
  await expect(page.getByRole("radio", { name: /^Authorized to work in India/ })).toBeChecked();
});

test("settings edits change the live preview, persist, and show on the dashboard", async ({ page }) => {
  await signIn(page, "/settings");
  await waitForHydration(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Search preferences");
  await expect(page.getByRole("link", { name: "Use the step-by-step setup" })).toBeVisible();

  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(alert(page, "Choose at least one role.")).toBeVisible();
  await expect(alert(page, "Choose at least one city, or choose remote only.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: BACKEND })).toBeFocused();
  await expect(saved(page)).toHaveCount(0);

  await page.getByRole("checkbox", { name: BACKEND }).check();
  await page.getByRole("checkbox", { name: "Full-time" }).check();
  await page.getByRole("radio", { name: /^Office or hybrid/ }).check();
  await page.getByRole("checkbox", { name: "Bengaluru" }).check();
  await page.getByLabel("Other cities").fill("Bangalore, Chennai");
  await page.getByRole("radio", { name: "No", exact: true }).check();
  await expect(
    example(page, "Software Engineer II").getByText("Filtered out", { exact: true }),
  ).toBeVisible();
  await expect(example(page, "Software Engineer II")).toContainText("aren't open to relocating");
  await page.getByRole("radio", { name: "Yes", exact: true }).check();
  await expect(
    example(page, "Software Engineer II").getByText("Shown with checks", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(saved(page)).toBeVisible();
  await expect(page.getByText("All changes saved")).toBeVisible();

  await page.reload();

  await waitForHydration(page);
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeChecked();
  // "Bangalore" is normalized to the Bengaluru checkbox, leaving only Chennai as another city.
  await expect(page.getByLabel("Other cities")).toHaveValue("Chennai");
  await expect(
    example(page, "Backend Developer (Contract)").getByText("Filtered out", { exact: true }),
  ).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText(`${BACKEND} · Office or hybrid · Bengaluru and Chennai`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit preferences" })).toHaveAttribute("href", "/settings");
});

test("a save from a stale tab is rejected instead of overwriting newer preferences", async ({ page }) => {
  await signIn(page, "/settings");
  await waitForHydration(page);
  const stale = await page.context().newPage();
  await stale.goto("/settings");
  await waitForHydration(stale);
  for (const tab of [page, stale]) {
    await tab.getByRole("checkbox", { name: BACKEND }).check();
    await tab.getByRole("checkbox", { name: "Internship" }).check();
    await tab.getByRole("radio", { name: /^Remote only/ }).check();
  }
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(saved(page)).toBeVisible();
  await stale.getByRole("button", { name: "Save preferences" }).click();
  await expect(alert(stale, "Your preferences changed in another tab. Reload before saving.")).toBeVisible();
  await stale.close();
});

test("education from the résumé prefills the eligibility step", async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page, "/profile");
  await upload(page, "pdf", fixturePdf());
  await expect(page.getByLabel("Institution")).toHaveValue("Example Institute", { timeout: 30_000 });
  await page.goto("/preferences");
  await waitForHydration(page);
  await page.getByRole("checkbox", { name: BACKEND }).check();
  await page.getByRole("checkbox", { name: "Full-time" }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: /^Remote only/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("We prefilled education from your profile.")).toBeVisible();
  await expect(page.getByLabel("Graduation year")).toHaveValue("2026");
  await expect(page.getByLabel("Degree", { exact: true })).toHaveValue("BTech");
  await expect(page.getByLabel("Branch or major")).toHaveValue("Computer Science");
});

test("preferences pages require sign-in", async ({ page }) => {
  await page.goto("/preferences");
  await expect(page).toHaveURL(/\/login\?next=%2Fpreferences$/);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
});
