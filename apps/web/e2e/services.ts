import { execFile } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { createDb } from "@repo/db";
import { sql } from "drizzle-orm";
import pino from "pino";
import { extractResumes } from "../../worker/src/commands/extract-resumes";
import { fixtureProfile } from "../../worker/src/testing/resume-fixtures";

// Test-only infrastructure, not an application auth bypass. No production env or credentials are read.
const { db, close } = createDb("postgresql://postgres:postgres@127.0.0.1:54329/postgres", { max: 1 });
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "e2e", alg: "RS256", use: "sig" };
const files = new Map<string, Buffer>();
const users = new Map<string, { id: string; email: string }>();
const logger = pino({ level: "silent" });
const ORIGIN = "http://127.0.0.1:54321";

for (let attempt = 0; ; attempt++) {
  try {
    await db.execute(sql`select 1`);
    break;
  } catch {
    if (attempt === 30) throw new Error("Isolated test database did not start");
    await delay(500);
  }
}
await promisify(execFile)("pnpm", ["--filter", "@repo/db", "migrate"], {
  env: {
    ...process.env,
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54329/postgres",
    DATABASE_MIGRATION_URL: "postgresql://postgres:postgres@127.0.0.1:54329/postgres",
  },
});

function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}
async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 6 * 1024 * 1024) throw new Error("Test request too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
function session(id: string, email: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "e2e" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: id,
      email,
      role: "authenticated",
      aud: "authenticated",
      iss: `${ORIGIN}/auth/v1`,
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");
  const token = `${header}.${payload}`;
  return {
    access_token: `${token}.${sign("RSA-SHA256", Buffer.from(token), privateKey).toString("base64url")}`,
    refresh_token: "local-test-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id, email, aud: "authenticated", role: "authenticated" },
  };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", ORIGIN);
    if (url.pathname === "/health") return json(response, { status: "ok" });
    if (url.pathname === "/auth/v1/.well-known/jwks.json") return json(response, { keys: [jwk] });
    if (url.pathname === "/test/process" && request.method === "POST") {
      return json(response, await processQueuedResumes());
    }
    if (url.pathname === "/test/users" && request.method === "POST") {
      const id = randomUUID();
      const email = `${id}@example.test`;
      await db.execute(sql`insert into auth.users (id, email) values (${id}, ${email})`);
      users.set(id, { id, email });
      return json(response, session(id, email));
    }
    if (url.pathname === "/auth/v1/user") {
      const token = request.headers.authorization?.replace(/^Bearer /i, "") ?? "";
      const [header, payload, signature] = token.split(".");
      if (
        !header ||
        !payload ||
        !signature ||
        !verify(
          "RSA-SHA256",
          Buffer.from(`${header}.${payload}`),
          publicKey,
          Buffer.from(signature, "base64url"),
        )
      ) {
        return json(response, { message: "Invalid token" }, 401);
      }
      const claims: { sub: string } = JSON.parse(Buffer.from(payload, "base64url").toString());
      return json(response, users.get(claims.sub));
    }
    if (!request.headers.authorization?.includes("e2e-storage-secret")) {
      return json(response, { message: "Unauthorized" }, 401);
    }
    const path = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\/object\/(?:sign\/)?resumes\//, ""));
    if (url.pathname.startsWith("/storage/v1/object/sign/resumes/") && request.method === "POST") {
      return json(response, { signedURL: `/object/sign/resumes/${path}?token=local-test-only` });
    }
    if (url.pathname.startsWith("/storage/v1/object/resumes/")) {
      if (request.method === "POST") {
        files.set(path, await readBody(request));
        return json(response, { Key: `resumes/${path}` });
      }
      const bytes = files.get(path);
      if (!bytes) return json(response, { message: "Not found" }, 404);
      response.writeHead(200, {
        "Content-Type": path.endsWith(".pdf")
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      return response.end(bytes);
    }
    if (url.pathname === "/storage/v1/object/resumes" && request.method === "DELETE") {
      const { prefixes } = JSON.parse((await readBody(request)).toString()) as { prefixes: string[] };
      for (const prefix of prefixes) files.delete(prefix);
      return json(response, []);
    }
    json(response, { message: "Unknown test endpoint" }, 404);
  } catch {
    json(response, { message: "Test service failed" }, 500);
  }
});

async function processQueuedResumes() {
  return extractResumes(db, logger, {
    storage: {
      get: async (path) => {
        const bytes = files.get(path);
        if (!bytes) throw new Error("Missing fixture file");
        return new Uint8Array(bytes);
      },
      put: async () => {},
      remove: async () => {},
      signedUrl: async () => "",
    },
    extractor: {
      extract: async (_userId, text) => ({
        content: fixtureProfile(text),
        cached: false,
        inputTokens: 100,
        outputTokens: 200,
        quoteValidityRate: 1,
      }),
    },
  });
}
server.listen(54321, "127.0.0.1", () => console.log("Isolated auth/storage/worker test services ready"));
process.on("SIGTERM", () => {
  server.close();
  void close().finally(() => process.exit(0));
});
