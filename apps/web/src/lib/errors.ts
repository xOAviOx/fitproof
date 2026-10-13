/** Operational code only, never an error message that may contain SQL parameters or personal data. */
export function databaseErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    if ("code" in current && typeof current.code === "string" && /^[A-Z0-9]{5}$/.test(current.code)) {
      return current.code;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

/** Flattens an error and its `cause` chain into one loggable string (Drizzle hides driver errors in `cause`). */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = error; e !== undefined && e !== null && parts.length < 5; ) {
    if (e instanceof Error) {
      parts.push(e.message.split("\n")[0] ?? e.message);
      e = e.cause;
    } else {
      parts.push(String(e));
      break;
    }
  }
  return parts.join(" <- ");
}
