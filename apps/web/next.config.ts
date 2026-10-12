import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import { serverEnv } from "./src/env";

// One .env at the repo root serves both the web app and the worker. Next only reads
// .env files from apps/web, and @next/env caches its first load, so calling its
// loadEnvConfig() here is a silent no-op. Variables already set in the environment win.
const rootEnvFile = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);
serverEnv();

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@repo/core", "@repo/db"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
