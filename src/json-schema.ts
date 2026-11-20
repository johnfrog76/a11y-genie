/**
 * A small JSON Schema validator, written for `schema/scan-1.json` so the project needs no validator
 * dependency. It supports exactly the keywords that schema uses and throws on any other, so the schema
 * cannot quietly grow a rule the check ignores. Returns the problems found, each as `path: what`.
 *
 * `check` runs it over its baseline, a file it did not write, before reading anything from it; the tests run
 * it over every golden and every record they make.
 */

import { readFileSync } from "node:fs";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = { [keyword: string]: Json };

const ANNOTATIONS = new Set(["$schema", "$id", "title", "description", "$defs"]);
const KEYWORDS = new Set([
  "type",
  "enum",
  "const",
  "required",
  "properties",
  "items",
  "minItems",
  "minLength",
  "minimum",
  "pattern",
  "oneOf",
  "$ref",
]);

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function isType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
}

export function validate(root: Schema, value: unknown): string[] {
  const problems: string[] = [];

  function resolve(ref: string): Schema {
    const parts = ref.replace(/^#\//, "").split("/");
    let node: unknown = root;
    for (const part of parts) node = (node as Record<string, unknown>)?.[part];
    if (typeof node !== "object" || node === null) throw new Error(`unresolved $ref: ${ref}`);
    return node as Schema;
  }

  function check(schema: Schema, data: unknown, path: string): string[] {
    const found: string[] = [];
    for (const keyword of Object.keys(schema)) {
      if (!ANNOTATIONS.has(keyword) && !KEYWORDS.has(keyword)) {
        throw new Error(`the validator does not support the keyword ${keyword}`);
      }
    }
    const here = path === "" ? "(root)" : path;
    if (schema.$ref !== undefined) found.push(...check(resolve(schema.$ref as string), data, path));
    if (schema.type !== undefined) {
      const types = ([] as Json[]).concat(schema.type);
      if (!types.some((t) => isType(data, t as string)))
        found.push(`${here}: expected ${types.join(" or ")}, got ${typeOf(data)}`);
    }
    if (schema.enum !== undefined && !(schema.enum as Json[]).some((v) => v === data)) {
      found.push(`${here}: ${JSON.stringify(data)} is not one of ${JSON.stringify(schema.enum)}`);
    }
    if (schema.const !== undefined && schema.const !== data)
      found.push(`${here}: expected ${JSON.stringify(schema.const)}`);
    if (typeof data === "string") {
      if (typeof schema.minLength === "number" && [...data].length < schema.minLength)
        found.push(`${here}: shorter than ${schema.minLength}`);
      if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(data))
        found.push(`${here}: does not match ${schema.pattern}`);
    }
    if (typeof data === "number" && typeof schema.minimum === "number" && data < schema.minimum) {
      found.push(`${here}: below ${schema.minimum}`);
    }
    if (Array.isArray(data)) {
      if (typeof schema.minItems === "number" && data.length < schema.minItems)
        found.push(`${here}: fewer than ${schema.minItems} items`);
      if (schema.items !== undefined) {
        data.forEach((item, i) => found.push(...check(schema.items as Schema, item, `${path}[${i}]`)));
      }
    }
    if (typeOf(data) === "object") {
      const object = data as Record<string, unknown>;
      for (const name of (schema.required as string[] | undefined) ?? []) {
        if (!(name in object)) found.push(`${here}: missing ${name}`);
      }
      for (const [name, sub] of Object.entries(
        (schema.properties as Record<string, Schema> | undefined) ?? {},
      )) {
        if (name in object) found.push(...check(sub, object[name], `${path}.${name}`));
      }
    }
    if (schema.oneOf !== undefined) {
      const matching = (schema.oneOf as Schema[]).filter((sub) => check(sub, data, path).length === 0).length;
      if (matching !== 1) found.push(`${here}: matches ${matching} of the oneOf choices, not exactly one`);
    }
    return found;
  }

  problems.push(...check(root, value, ""));
  return problems;
}

/** `schema/scan-1.json`, read from the package: beside `dist/` when installed, beside `src/` in a clone. */
export function scanSchema(): Schema {
  return JSON.parse(readFileSync(new URL("../schema/scan-1.json", import.meta.url), "utf8")) as Schema;
}
