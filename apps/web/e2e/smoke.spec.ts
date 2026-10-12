import { expect, test } from "@playwright/test";

test("landing page states the promise and leads to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Find jobs that fit your experience");
  await page.getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Sign in to");
});

test("sign-in form is labelled and validates email before contacting the auth server", async ({ page }) => {
  await page.goto("/login");
  const email = page.getByLabel("Email address");
  await expect(email).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();

  await email.fill("not-an-email");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter a valid email address." })).toBeVisible();
  await expect(email).toHaveAttribute("aria-invalid", "true");
});

test("protected pages redirect anonymous visitors to sign-in and keep the destination", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
});

test("skip link is the first keyboard stop", async ({ page, browserName }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "keyboard navigation is a desktop concern");
  test.skip(browserName !== "chromium", "tab order differs by browser defaults");
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
});

test("health endpoint reports the database as reachable", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  await expect(response.json()).resolves.toMatchObject({ status: "ok", checks: { database: "ok" } });
});
