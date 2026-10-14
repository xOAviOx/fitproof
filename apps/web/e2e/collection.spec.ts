import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// Matches ADMIN_EMAILS in playwright.config.ts.
const OWNER = "owner@example.test";

test.beforeEach(async ({ request }) => {
  expect((await request.post("http://127.0.0.1:54321/test/collection")).ok()).toBe(true);
});

test("the owner sees collection stats, with a failing board that didn't stop the run", async ({ page }) => {
  await signIn(page, "/admin", { email: OWNER });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Job collection");
  await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
  const failing = page.getByRole("region", { name: "FAILING BOARDS" });
  await expect(failing.getByText("Broken Test")).toBeVisible();
  await expect(
    failing.getByText("boards-api.greenhouse.io/v1/boards/e2e-broken/jobs returned 404"),
  ).toBeVisible();
  const runs = page.getByRole("region", { name: "RECENT RUNS" });
  await expect(runs.getByText(/2 boards \(1 failed\) · 3 of 12 postings in scope/).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("anyone else gets a plain 404 and no admin link", async ({ page }) => {
  await signIn(page, "/admin");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
});

test("the coverage line counts boards read successfully, not failing ones", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("coverage-line")).toContainText(
    /^Covering 1 company career board for Bengaluru, Hyderabad, Pune, and remote roles in India\. Company boards are re-read every 6 hours\./,
  );
});
