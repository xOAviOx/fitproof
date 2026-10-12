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
