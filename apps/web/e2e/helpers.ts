import { expect, type Page, test } from "@playwright/test";
import { RESUME_MIME_TYPES } from "@repo/core";

/** Creates a fresh synthetic user and stores its session cookie. Only works against e2e/services.ts. */
export async function signIn(page: Page, path = "/profile") {
  const response = await page.request.post("http://127.0.0.1:54321/test/users");
  expect(response.ok()).toBe(true);
  const session: unknown = await response.json();
  await page.context().addCookies([
    {
      name: "sb-127-auth-token",
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
      url: test.info().project.use.baseURL as string,
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);
  await page.goto(path);
}

/** Server-rendered controls are visible before React attaches handlers; interacting earlier is lost. */
export async function waitForHydration(page: Page, selector = "main form") {
  await page.waitForFunction((target) => {
    const element = document.querySelector(target);
    return element !== null && Object.keys(element).some((key) => key.startsWith("__reactProps$"));
  }, selector);
}

/** Uploads a résumé from /profile and runs the queued extraction once. */
export async function upload(page: Page, extension: "pdf" | "docx", bytes: Uint8Array) {
  const revision = await page.locator('input[name="revision"]').inputValue();
  const submit = page.getByRole("button", { name: /^(Upload résumé|Upload a new résumé)$/ });
  // A file picked before hydration never reaches React's onChange, so pick again until it registers.
  await expect(async () => {
    await page.getByLabel("PDF or DOCX résumé").setInputFiles({
      name: `synthetic-resume.${extension}`,
      mimeType: RESUME_MIME_TYPES[extension],
      buffer: Buffer.from(bytes),
    });
    await expect(submit).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await submit.click();
  await expect(page.locator('input[name="revision"]')).not.toHaveValue(revision);
  const processed = await page.request.post("http://127.0.0.1:54321/test/process");
  expect(processed.ok()).toBe(true);
  expect(await processed.json()).toMatchObject({ processed: 1 });
}
