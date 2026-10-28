import type { Static, TSchema } from "typebox";
import { Compile, type Validator } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";
import { Settings } from "typebox/system";

import { messageFor, REQUIRED_MESSAGE } from "./locale";

/**
 * TypeBox stops collecting diagnostics after `maxErrors` (default 8, a guard against unbounded
 * buffering). The signup body alone has 14 fields, so a 422 or the form would hide errors past the
 * eighth. 64 still bounds the work per request.
 */
Settings.Set({ maxErrors: 64 });

/** Standard Schema v1 (https://standardschema.dev), declared locally to avoid a dependency. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output>;
    readonly types?: { readonly input: Input; readonly output: Output };
  };
}
export type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<Issue> };

/** One field-level problem: `path` is the property path from the schema root. */
export type Issue = { readonly path: string[]; readonly message: string };

/** Every field-level issue of `value` against `schema`, with pt-BR messages. */
export function collectIssues(schema: TSchema, value: unknown, validator?: Validator): Issue[] {
  const errors = (validator ?? Compile(schema)).Errors(value);
  const seen = new Set<string>();
  const issues: Issue[] = [];
  for (const error of errors) {
    for (const issue of toIssues(schema, error)) {
      const key = `${issue.path.join("/")}\u0000${issue.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(issue);
    }
  }
  return issues;
}

/**
 * Wraps a TypeBox schema as a Standard Schema for TanStack Form and env-core.
 * `coerce` applies defaults then converts strings (`"10"` → `10`, `"true"` → `true`).
 */
export function toStandardSchema<T extends TSchema>(
  schema: T,
  options: { coerce?: boolean } = {},
): StandardSchemaV1<unknown, Static<T>> {
  const validator = Compile(schema);
  return {
    "~standard": {
      version: 1,
      vendor: "typebox",
      validate(input) {
        const value = options.coerce
          ? validator.Convert(validator.Default(structuredClone(input)))
          : input;
        if (validator.Check(value)) return { value: value as Static<T> };
        return { issues: collectIssues(schema, value, validator) };
      },
    },
  };
}

function toIssues(root: TSchema, error: TLocalizedValidationError): Issue[] {
  const path = splitPointer(error.instancePath);
  if (error.keyword === "required") {
    const properties = member(nodeAt(root, error.schemaPath), "properties");
    return error.params.requiredProperties.map((property) => ({
      path: [...path, property],
      message: annotation(member(properties, property)) ?? REQUIRED_MESSAGE,
    }));
  }
  if (error.keyword === "~refine") return [{ path, message: error.params.message }];
  return [{ path, message: annotation(nodeAt(root, error.schemaPath)) ?? messageFor(error) }];
}

/** The `error` annotation on a schema node, the per-field pt-BR message. */
function annotation(node: unknown): string | undefined {
  const error = member(node, "error");
  return typeof error === "string" ? error : undefined;
}

function member(node: unknown, key: string): unknown {
  return node !== null && typeof node === "object" && key in node
    ? Reflect.get(node, key)
    : undefined;
}

function splitPointer(pointer: string): string[] {
  if (pointer === "" || pointer === "#") return [];
  return pointer
    .replace(/^#?\//, "")
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function nodeAt(root: TSchema, schemaPath: string): unknown {
  let node: unknown = root;
  for (const segment of splitPointer(schemaPath)) node = member(node, segment);
  return node;
}
