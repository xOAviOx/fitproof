import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "web" },
  redact: {
    paths: ["email", "*.email", "password", "*.password", "headers.cookie", "headers.authorization"],
    censor: "[redacted]",
  },
});
