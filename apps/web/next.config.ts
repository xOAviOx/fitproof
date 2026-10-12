import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import { serverEnv } from "./src/env";

// One .env at the repo root serves both the web app and the worker.
loadEnvConfig(path.resolve(process.cwd(), "../.."));
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
