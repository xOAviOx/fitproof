import { MAX_RESUME_BYTES, RESUME_MIME_TYPES } from "@repo/core";
import { createClient } from "@supabase/supabase-js";

export interface ResumeStorage {
  put(path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
  signedUrl(path: string): Promise<string>;
}

export function createResumeStorage(url: string, secret: string, bucket = "resumes"): ResumeStorage {
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const files = client.storage.from(bucket);
  return {
    async put(path, bytes, mimeType) {
      const { error } = await files.upload(path, bytes, { contentType: mimeType, upsert: false });
      if (error) throw new Error("Résumé storage upload failed");
    },
    async get(path) {
      const { data, error } = await files.download(path);
      if (error || !data) throw new Error("Résumé storage download failed");
      if (data.size > MAX_RESUME_BYTES) throw new Error("Stored résumé exceeds the size limit");
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(path) {
      const { error } = await files.remove([path]);
      if (error) throw new Error("Résumé storage deletion failed");
    },
    async signedUrl(path) {
      const { data, error } = await files.createSignedUrl(path, 60);
      if (error || !data) throw new Error("Résumé signed URL failed");
      return data.signedUrl;
    },
  };
}

/** Explicit operator command, never run during a web request or test. */
export async function provisionResumeBucket(url: string, secret: string, bucket = "resumes") {
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const config = {
    public: false,
    fileSizeLimit: MAX_RESUME_BYTES,
    allowedMimeTypes: Object.values(RESUME_MIME_TYPES),
  };
  const { data, error } = await client.storage.getBucket(bucket);
  if (error && error.message !== "Bucket not found") throw new Error("Could not inspect résumé bucket");
  const result = data
    ? await client.storage.updateBucket(bucket, config)
    : await client.storage.createBucket(bucket, config);
  if (result.error) throw new Error("Could not provision private résumé bucket");
}
