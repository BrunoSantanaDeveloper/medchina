/**
 * Convert a plain JSON Schema into the dialect OpenAI's `strict` structured
 * output requires.
 *
 * WHY THIS IS A CONVERSION AND NOT A RULE THE SCHEMAS SHOULD FOLLOW:
 *
 * Strict mode has no notion of an absent property. Every object must close
 * itself (`additionalProperties: false`) and list EVERY property in `required`;
 * optionality exists only as an explicit `null`. The domain schemas express
 * optionality the honest way — by omission — and that shape carries meaning we
 * do not want to lose. The therapeutic plan is the clearest case: each modality
 * is optional because the product forbids padding a plan with treatments that
 * do not fit the case (PRD §10.9), and "omit what does not apply" is exactly
 * what the prompt asks for. Rewriting those schemas to satisfy one provider
 * would bend a clinical rule to fit a serialisation format.
 *
 * So the domain keeps its shape and the provider translates. Gemini receives
 * the schema as written; OpenAI receives this transform. A schema added later
 * needs nobody to remember the rules.
 *
 * The transform is idempotent: a schema that already closes its objects and
 * lists every property comes back unchanged.
 */

type JsonSchema = Record<string, unknown>;

const isObject = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Widen a property's type to admit `null`, which is how strict mode spells
 * "this one is optional". An enum has to admit it too, or the value the
 * transform just made legal would be rejected by the enum right after.
 */
function nullable(schema: JsonSchema): JsonSchema {
  const next: JsonSchema = { ...schema };

  const type = next.type;
  if (typeof type === "string") {
    if (type !== "null") next.type = [type, "null"];
  } else if (Array.isArray(type)) {
    if (!type.includes("null")) next.type = [...type, "null"];
  }

  if (Array.isArray(next.enum) && !next.enum.includes(null)) {
    next.enum = [...next.enum, null];
  }

  // A union branch carries its own type, so the null has to reach inside.
  for (const key of ["anyOf", "oneOf"] as const) {
    if (Array.isArray(next[key])) {
      next[key] = (next[key] as unknown[]).map((branch) => (isObject(branch) ? nullable(branch) : branch));
    }
  }

  return next;
}

export function toStrictJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map((entry) => toStrictJsonSchema(entry));
  if (!isObject(schema)) return schema;

  const next: JsonSchema = { ...schema };

  // Arrays and unions are containers: the rules apply to what they hold.
  if (next.items !== undefined) next.items = toStrictJsonSchema(next.items);
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(next[key])) {
      next[key] = (next[key] as unknown[]).map((branch) => toStrictJsonSchema(branch));
    }
  }

  if (isObject(next.properties)) {
    const wasRequired = new Set(Array.isArray(next.required) ? (next.required as string[]) : []);
    const properties: JsonSchema = {};

    for (const [key, value] of Object.entries(next.properties)) {
      const converted = toStrictJsonSchema(value);
      properties[key] = wasRequired.has(key) || !isObject(converted) ? converted : nullable(converted);
    }

    next.properties = properties;
    // Strict mode admits no open objects and no optional keys.
    next.required = Object.keys(properties);
    next.additionalProperties = false;
  }

  return next;
}

/** Keywords Claude's structured outputs reject (numeric, string-length and array-size constraints). */
const ANTHROPIC_UNSUPPORTED = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
] as const;

/**
 * Convert a plain JSON Schema into what Claude's structured outputs accept.
 *
 * Unlike OpenAI's strict mode, Claude keeps optionality the honest way —
 * a property left out of `required` may be absent — so the domain's shape
 * survives untouched. Two things change: every object closes itself
 * (`additionalProperties: false` is mandatory), and constraint keywords the
 * grammar compiler does not take are dropped (the domain code already
 * validates what it receives).
 */
export function toAnthropicJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map((entry) => toAnthropicJsonSchema(entry));
  if (!isObject(schema)) return schema;

  const next: JsonSchema = { ...schema };
  for (const keyword of ANTHROPIC_UNSUPPORTED) delete next[keyword];

  if (next.items !== undefined) next.items = toAnthropicJsonSchema(next.items);
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(next[key])) {
      next[key] = (next[key] as unknown[]).map((branch) => toAnthropicJsonSchema(branch));
    }
  }
  if (isObject(next.properties)) {
    next.properties = Object.fromEntries(
      Object.entries(next.properties).map(([key, value]) => [key, toAnthropicJsonSchema(value)]),
    );
    next.additionalProperties = false;
  }
  return next;
}

/**
 * Per-request limits of Claude's structured-output grammar. Past them the API
 * answers 400 "Schema is too complex for compilation" — which on the clinical
 * routes would be a failed plan, not a slow one.
 */
export const ANTHROPIC_SCHEMA_LIMITS = { optional: 24, unions: 16 } as const;

/** How many optional properties and union-typed properties a schema declares. */
export function anthropicSchemaComplexity(schema: unknown): { optional: number; unions: number } {
  const total = { optional: 0, unions: 0 };
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isObject(node)) return;
    if (isObject(node.properties)) {
      const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
      for (const [key, value] of Object.entries(node.properties)) {
        if (!required.has(key)) total.optional += 1;
        if (isObject(value) && (Array.isArray(value.type) || Array.isArray(value.anyOf))) total.unions += 1;
        visit(value);
      }
    }
    if (node.items !== undefined) visit(node.items);
    for (const key of ["anyOf", "oneOf", "allOf"] as const) if (Array.isArray(node[key])) visit(node[key]);
  };
  visit(schema);
  return total;
}

/**
 * Report what still violates strict mode. Used by tests over the REAL clinical
 * schemas, so a schema added later cannot quietly become un-sendable to OpenAI
 * — the failure would otherwise appear as a 400 in production, on the one
 * provider that exists to be the fallback when the other is down.
 */
export function strictSchemaViolations(schema: unknown, path = "$"): string[] {
  const problems: string[] = [];
  if (Array.isArray(schema)) {
    schema.forEach((entry, index) => problems.push(...strictSchemaViolations(entry, `${path}[${index}]`)));
    return problems;
  }
  if (!isObject(schema)) return problems;

  if (isObject(schema.properties)) {
    const keys = Object.keys(schema.properties);
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    if (schema.additionalProperties !== false) {
      problems.push(`${path}: additionalProperties must be false`);
    }
    const missing = keys.filter((key) => !required.includes(key));
    if (missing.length > 0) {
      problems.push(`${path}: properties missing from required — ${missing.join(", ")}`);
    }
    for (const [key, value] of Object.entries(schema.properties)) {
      problems.push(...strictSchemaViolations(value, `${path}.${key}`));
    }
  }

  if (schema.items !== undefined) problems.push(...strictSchemaViolations(schema.items, `${path}[]`));
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(schema[key])) {
      (schema[key] as unknown[]).forEach((branch, index) =>
        problems.push(...strictSchemaViolations(branch, `${path}.${key}[${index}]`)),
      );
    }
  }

  return problems;
}
