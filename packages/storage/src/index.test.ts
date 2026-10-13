import { MAX_RESUME_BYTES, RESUME_MIME_TYPES } from "@repo/core";
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createResumeStorage, provisionResumeBucket } from "./index";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
const files = {
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  createSignedUrl: vi.fn(),
};
const storage = {
  from: vi.fn(() => files),
  getBucket: vi.fn(),
  createBucket: vi.fn(),
  updateBucket: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue({ storage } as unknown as ReturnType<typeof createClient>);
});
describe("private storage adapter", () => {
  it("uses no persistent auth session and signs files for 60 seconds", async () => {
    files.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example.test/signed" },
      error: null,
    });
    const adapter = createResumeStorage("https://storage.example.test", "synthetic-secret");
    expect(createClient).toHaveBeenCalledWith("https://storage.example.test", "synthetic-secret", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(await adapter.signedUrl("user/resume.pdf")).toBe("https://storage.example.test/signed");
    expect(files.createSignedUrl).toHaveBeenCalledWith("user/resume.pdf", 60);
  });
  it("does not overwrite files and bounds downloaded data", async () => {
    const adapter = createResumeStorage("https://storage.example.test", "synthetic-secret");
    files.upload.mockResolvedValue({ error: null });
    const bytes = new Uint8Array([1, 2, 3]);
    await adapter.put("user/resume.pdf", bytes, RESUME_MIME_TYPES.pdf);
    expect(files.upload).toHaveBeenCalledWith("user/resume.pdf", bytes, {
      contentType: RESUME_MIME_TYPES.pdf,
      upsert: false,
    });
    files.download.mockResolvedValue({ error: null, data: { size: MAX_RESUME_BYTES + 1 } });
    await expect(adapter.get("user/resume.pdf")).rejects.toThrow(/size limit/);
  });
  it("creates a private, MIME/size-restricted bucket and updates existing configuration", async () => {
    storage.getBucket.mockResolvedValue({ data: null, error: { message: "Bucket not found" } });
    storage.createBucket.mockResolvedValue({ error: null });
    await provisionResumeBucket("https://storage.example.test", "synthetic-secret");
    const config = {
      public: false,
      fileSizeLimit: MAX_RESUME_BYTES,
      allowedMimeTypes: Object.values(RESUME_MIME_TYPES),
    };
    expect(storage.createBucket).toHaveBeenCalledWith("resumes", config);
    storage.getBucket.mockResolvedValue({ data: { id: "resumes" }, error: null });
    storage.updateBucket.mockResolvedValue({ error: null });
    await provisionResumeBucket("https://storage.example.test", "synthetic-secret");
    expect(storage.updateBucket).toHaveBeenCalledWith("resumes", config);
  });
  it("never exposes vendor error bodies", async () => {
    files.upload.mockResolvedValue({ error: { message: "SECRET sensitive request" } });
    const adapter = createResumeStorage("https://storage.example.test", "synthetic-secret");
    await expect(adapter.put("file", new Uint8Array([1]), RESUME_MIME_TYPES.pdf)).rejects.toThrow(
      "Résumé storage upload failed",
    );
  });
});
