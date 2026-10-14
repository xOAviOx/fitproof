import { z } from "zod";

type JsonSchema = { [key: string]: unknown };

/**
 * Size, range, and pattern limits. Gemini's constrained decoding expands each one into decoder
 * states and rejects nested schemas with many of them ("too many states for serving"), so the
 * provider gets a copy without them and code enforces them afterwards with `fitToSchema` and Zod.
 */
const DECODER_LIMITS = new Set([
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "pattern",
  "format",
]);
/** Keywords whose value is a map of names to schemas; the names themselves are never keywords. */
const SCHEMA_MAPS = new Set(["properties", "definitions", "$defs"]);

const isObject = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The JSON schema the AI SDK would send for `schema`, as used to check responses. */
export function strictJsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { target: "draft-7", io: "input", reused: "inline" }) as JsonSchema;
}

function relax(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(relax);
  if (!isObject(node)) return node;
  const result: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (DECODER_LIMITS.has(key)) continue;
    result[key] =
      SCHEMA_MAPS.has(key) && isObject(value)
        ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, relax(child)]))
        : relax(value);
  }
  if (result.type === "object" && result.additionalProperties === undefined) {
    result.additionalProperties = false;
  }
  return result;
}

/** The schema sent to the provider: same shape, types, enums, and nullability, without limits. */
export function decoderJsonSchema(schema: JsonSchema): JsonSchema {
  return relax(schema) as JsonSchema;
}

/**
 * Trims strings and arrays that exceed the strict schema's limits, so one long note or an extra
 * list item doesn't discard the whole response. Everything else is left for Zod to judge.
 */
export function fitToSchema(value: unknown, schema: unknown): unknown {
  if (!isObject(schema)) return value;
  if (Array.isArray(schema.anyOf)) {
    if (value === null) return value;
    const branch = schema.anyOf.find((option) => isObject(option) && option.type !== "null");
    return fitToSchema(value, branch);
  }
  if (typeof value === "string") {
    // UTF-16 units, matching Zod's `.max()`.
    return typeof schema.maxLength === "number" ? value.slice(0, schema.maxLength) : value;
  }
  if (Array.isArray(value)) {
    const items = typeof schema.maxItems === "number" ? value.slice(0, schema.maxItems) : value;
    return items.map((item) => fitToSchema(item, schema.items));
  }
  if (isObject(value) && isObject(schema.properties)) {
    const properties = schema.properties;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, fitToSchema(child, properties[key])]),
    );
  }
  return value;
}
