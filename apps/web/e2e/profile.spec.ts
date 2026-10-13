import { expect, type Page, test } from "@playwright/test";
import { FIXTURE_LINES, fixtureDocx, fixturePdf } from "../../worker/src/testing/resume-fixtures";
import { signIn as signInAt, upload } from "./helpers";

test.skip(
  Boolean(process.env.E2E_BASE_URL),
  "Synthetic auth services are only available in isolated local e2e.",
);

async function signIn(page: Page) {
  await signInAt(page, "/profile");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your experience");
}

for (const layout of ["single-column PDF", "two-column PDF", "table-based DOCX"] as const) {
  test(`${layout}: upload, background extract, review, edit, and confirm`, async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page);
    await upload(
      page,
      layout.includes("DOCX") ? "docx" : "pdf",
      layout.includes("DOCX") ? fixtureDocx() : fixturePdf(undefined, layout.includes("two-column")),
    );
    await expect(page.getByLabel("Company", { exact: true })).toHaveValue("Example Labs", {
      timeout: 30_000,
    });
    await expect(page.getByLabel("Job title", { exact: true })).toHaveValue("Backend Intern");
    await expect(page.getByLabel("Institution")).toHaveValue("Example Institute");
    await expect(page.getByLabel("Certification name")).toHaveValue("SQL Foundations");
    await expect(page.getByRole("button", { name: "Confirm profile" })).toBeDisabled();
    await page.getByLabel("Responsibilities & achievements").fill("Built and tested a REST API.");
    for (const checkbox of await page.getByRole("checkbox", { name: /^I confirm/ }).all())
      await checkbox.check();
    await page.getByRole("button", { name: "Confirm profile" }).click();
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Responsibilities & achievements")).toHaveValue(
      "Built and tested a REST API.",
    );
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
    const signed = await page.request.get(
      (await page.getByRole("link", { name: "View original file" }).getAttribute("href")) ?? "",
      { maxRedirects: 0 },
    );
    expect(signed.status()).toBe(303);
    expect(signed.headers()["cache-control"]).toBe("no-store");
  });
}

test("re-upload replaces the draft and file downloads are isolated by user", async ({ page, browser }) => {
  test.setTimeout(60_000);
  await signIn(page);
  await upload(page, "pdf", fixturePdf());
  await expect(page.getByLabel("Skill name").first()).toHaveValue("TypeScript", { timeout: 30_000 });
  const originalUrl = await page.getByRole("link", { name: "View original file" }).getAttribute("href");
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const otherPage = await other.newPage();
    await signIn(otherPage);
    await expect(otherPage.getByLabel("Skill name")).toHaveCount(0);
    const response = await other.request.get(originalUrl ?? "", { maxRedirects: 0 });
    expect(response.status()).toBe(404);
  } finally {
    await other.close();
  }
  await upload(
    page,
    "docx",
    fixtureDocx(FIXTURE_LINES.map((line) => (line === "TypeScript, SQL" ? "Python" : line))),
  );
  await expect(page.getByLabel("Skill name")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByLabel("Skill name")).toHaveValue("Python");
  await expect(page.getByText("Draft · needs review")).toBeVisible();
});

test("manual profile saves, confirms, and persists without an upload", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Add skill", exact: true }).click();
  await page.getByLabel("Skill name").fill("PostgreSQL");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator('input[name="revision"]')).not.toHaveValue("");
  await page.reload();
  await expect(page.getByLabel("Skill name")).toHaveValue("PostgreSQL");
  await page.getByRole("checkbox", { name: "I confirm this skill is accurate" }).check();
  await page.getByRole("button", { name: "Confirm profile" }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
});

test("invalid files show actionable errors and anonymous API requests are rejected", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/profile/status")).status()).toBe(401);
  expect((await request.get("/api/resumes/00000000-0000-0000-0000-000000000000/download")).status()).toBe(
    401,
  );
  await signIn(page);
  await page.getByLabel("PDF or DOCX résumé").setInputFiles({
    name: "resume.png",
    mimeType: "image/png",
    buffer: Buffer.from("image"),
  });
  await expect(page.getByRole("alert").filter({ hasText: "PDF or DOCX" })).toBeVisible();
  await upload(page, "pdf", fixturePdf(["Scanned image"]));
  await expect(page.getByRole("status").filter({ hasText: "scanned résumé" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Add skill", exact: true })).toBeEnabled();
});
