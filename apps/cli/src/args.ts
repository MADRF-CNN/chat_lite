import { parseArgs } from "node:util";

export type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;
export type FlagSpec = { type: "string" | "boolean"; short?: string; multiple?: boolean };

export function parseFlags(args: string[], specs: Record<string, FlagSpec> = {}) {
  const options: Record<string, FlagSpec> = { ...specs };
  for (const spec of Object.values(specs)) {
    if (spec.short) options[spec.short] = spec.multiple === undefined ? { type: spec.type } : { type: spec.type, multiple: spec.multiple };
  }
  const { values, positionals } = parseArgs({ args, options, allowPositionals: true, strict: true }) as unknown as { values: Values; positionals: string[] };
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.short && values[spec.short] !== undefined && values[name] === undefined) values[name] = values[spec.short];
  }
  return { values, positionals };
}

export function flagString(values: Values, name: string) {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

export function flagBool(values: Values, name: string) {
  return values[name] === true;
}

export function flagNumber(values: Values, name: string) {
  const value = flagString(values, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${name} 需要是正整数`);
  return parsed;
}

export const serverFlag: Record<string, FlagSpec> = { server: { type: "string", short: "s" } };
