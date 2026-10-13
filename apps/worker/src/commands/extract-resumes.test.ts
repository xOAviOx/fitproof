import { randomUUID } from "node:crypto";
import { RESUME_MIME_TYPES } from "@repo/core";
import { loadProfile, registerResumeUpload, schema } from "@repo/db";
import { createAuthUser, createTestDb, type TestDb } from "@repo/db/testing";
import type { ProfileExtractor } from "@repo/llm";
import type { ResumeStorage } from "@repo/storage";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fixturePdf, fixtureProfile } from "../testing/resume-fixtures";
import { extractResumes } from "./extract-resumes";

let test: TestDb;
beforeAll(async () => {
  test = await createTestDb();
}, 30_000);
afterAll(async () => {
  await test.close();
});
const logger = pino({ level: "silent" });

describe("résumé worker", () => {
  it("processes a real PDF through redaction, draft persistence, and queue completion", async () => {
    const userId = await createAuthUser(test.db);
    const id = randomUUID();
    await registerResumeUpload(test.db, userId, {
      id,
      userId,
      storagePath: `${userId}/${id}.pdf`,
      originalFilename: "resume.pdf",
      mimeType: RESUME_MIME_TYPES.pdf,
      sizeBytes: 1000,
      sha256: "fixture",
    });
    const extract = vi.fn<ProfileExtractor["extract"]>(async (_userId, text) => {
      expect(text).not.toContain("Synthetic Candidate");
      expect(text).not.toContain("example.test");
      return {
        content: fixtureProfile(text),
        cached: false,
        inputTokens: 100,
        outputTokens: 200,
        quoteValidityRate: 1,
      };
    });
    const storage: ResumeStorage = {
      get: async () => fixturePdf(),
      put: async () => {},
      remove: async () => {},
      signedUrl: async () => "https://example.test",
    };
    expect(await extractResumes(test.db, logger, { storage, extractor: { extract } })).toEqual({
      processed: 1,
      failed: 0,
    });
    const profile = await loadProfile(test.db, userId);
    expect(profile.profile?.status).toBe("draft");
    expect(profile.resume?.status).toBe("extracted");
    expect(profile.content.experiences[0]?.title).toBe("Backend Intern");
    expect(profile.content.links).toContainEqual({
      label: "GitHub",
      url: "https://github.com/synthetic-candidate",
    });
    expect((await test.db.select().from(schema.jobRuns))[0]?.status).toBe("succeeded");
  });
  it("marks unreadable files failed without leaking parser errors to the database", async () => {
    const userId = await createAuthUser(test.db);
    const id = randomUUID();
    await registerResumeUpload(test.db, userId, {
      id,
      userId,
      storagePath: `${userId}/${id}.pdf`,
      originalFilename: "resume.pdf",
      mimeType: RESUME_MIME_TYPES.pdf,
      sizeBytes: 1000,
      sha256: "broken",
    });
    const extract = vi.fn<ProfileExtractor["extract"]>();
    const storage: ResumeStorage = {
      get: async () => fixturePdf(["Tiny"]),
      put: async () => {},
      remove: async () => {},
      signedUrl: async () => "",
    };
    expect(await extractResumes(test.db, logger, { storage, extractor: { extract } })).toEqual({
      processed: 1,
      failed: 1,
    });
    expect(extract).not.toHaveBeenCalled();
    const profile = await loadProfile(test.db, userId);
    expect(profile.resume?.status).toBe("failed");
    expect(profile.resume?.error).toContain("scanned");
  });
  it("retries provider failures without saving the raw error or request body", async () => {
    const userId = await createAuthUser(test.db);
    const id = randomUUID();
    await registerResumeUpload(test.db, userId, {
      id,
      userId,
      storagePath: `${userId}/${id}.pdf`,
      originalFilename: "resume.pdf",
      mimeType: RESUME_MIME_TYPES.pdf,
      sizeBytes: 1000,
      sha256: "retry",
    });
    const storage: ResumeStorage = {
      get: async () => fixturePdf(),
      put: async () => {},
      remove: async () => {},
      signedUrl: async () => "",
    };
    await extractResumes(test.db, logger, {
      storage,
      extractor: {
        extract: async () => {
          throw new Error("API_KEY=secret and synthetic@example.test");
        },
      },
    });
    const profile = await loadProfile(test.db, userId);
    expect(profile.resume?.status).toBe("uploaded");
    expect(profile.resume?.error).not.toContain("secret");
    expect(profile.resume?.error).not.toContain("example.test");
  });
});
