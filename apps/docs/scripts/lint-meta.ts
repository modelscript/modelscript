// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Extracts diagnostic rule metadata from every `languages/<lang>` package.
//
// Rules live in `src/errors.ts` (`XErrorCode = { KEY: { code, rule, severity, message } }`)
// or, for some languages, in `src/lints/{rules,index,error-codes}.ts`. Each module is
// imported under tsx and every exported value is scanned for rule-shaped objects, so
// the docs reflect exactly what the linter ships.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../..");
const languagesRoot = path.join(repoRoot, "languages");

const CANDIDATES = ["src/errors.ts", "src/lints/error-codes.ts", "src/lints/rules.ts", "src/lints/index.ts"];

export interface RuleMeta {
  /** Code exactly as the CLI prints it (e.g. `M3001`, `S1001`, `G1001`). */
  code: string;
  rule: string;
  severity: string;
  /** Message template with parameters rendered as `<name>`. */
  message: string;
}

export interface LanguageRules {
  dir: string;
  packageName: string;
  sources: string[];
  rules: RuleMeta[];
}

/** Mirrors the code formatting in apps/cli/src/commands/lint.ts (and `standardCode` from `stdCode`). */
function formatCode(dir: string, code: unknown, stdCode?: unknown): string | null {
  if (typeof stdCode === "string" && stdCode.trim()) return stdCode.trim();
  if (typeof code === "string" && code.trim()) return code.trim();
  if (typeof code === "number" && Number.isFinite(code)) {
    const prefix = dir === "sysml2" ? "S" : dir === "owl2" ? "O" : "M";
    return `${prefix}${code}`;
  }
  return null;
}

function paramNames(fn: (...args: unknown[]) => unknown): string[] {
  const src = fn.toString();
  const m =
    /^(?:async\s*)?(?:function[^(]*)?\(([^)]*)\)/.exec(src) ?? /^(?:async\s*)?([A-Za-z_$][\w$]*)\s*=>/.exec(src);
  if (!m) return [];
  return (m[1] ?? "")
    .split(",")
    .map((p) =>
      p
        .replace(/[:=].*$/s, "")
        .replace(/[?{}[\].\s]/g, "")
        .trim(),
    )
    .filter(Boolean);
}

/** Best-effort extraction of the first template / string literal in a message function. */
function templateFromSource(fn: (...args: unknown[]) => unknown): string | null {
  const src = fn.toString();
  const tpl = /`((?:[^`\\]|\\.)*)`/s.exec(src);
  if (tpl) {
    return (tpl[1] ?? "")
      .replace(/\$\{([^}]*)\}/g, (_, expr: string) => {
        const id = /([A-Za-z_$][\w$]*)\s*(?:\.\s*text)?\s*(?:[?|&].*)?$/.exec(expr.trim())?.[1] ?? "value";
        return `<${id.replace(/\.text$/, "")}>`;
      })
      .replace(/\s+/g, " ")
      .trim();
  }
  const str = /["']([^"'\n]{6,})["']/.exec(src);
  return str ? (str[1] ?? null) : null;
}

function renderMessage(message: unknown): string {
  if (typeof message === "string") return message;
  if (typeof message !== "function") return "";
  const fn = message as (...args: unknown[]) => unknown;
  const names = paramNames(fn);
  try {
    const out = fn(...names.map((n) => `<${n}>`));
    const leaked = /\bundefined\b|\[object Object\]|\bNaN\b/;
    if (typeof out === "string" && out.trim() && (!leaked.test(out) || leaked.test(fn.toString()))) {
      return out.replace(/\s+/g, " ").trim();
    }
  } catch {
    // fall through to source extraction
  }
  return templateFromSource(fn) ?? "";
}

function isRuleLike(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["rule"] === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(o["rule"]) && ("code" in o || "severity" in o)
  );
}

function collect(dir: string, value: unknown, out: Map<string, RuleMeta>, depth = 0, seen = new Set<unknown>()): void {
  if (!value || typeof value !== "object" || depth > 3 || seen.has(value)) return;
  seen.add(value);
  if (isRuleLike(value)) {
    const code = formatCode(dir, value["code"], value["stdCode"]);
    if (!code) return;
    const rule = value["rule"] as string;
    const key = `${code}:${rule}`;
    if (!out.has(key)) {
      const severity = typeof value["severity"] === "string" ? value["severity"] : "error";
      out.set(key, { code, rule, severity, message: renderMessage(value["message"]) });
    }
    return;
  }
  if (!Array.isArray(value) && !(value instanceof Map)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v && typeof v === "object" && ("code" in v || "stdCode" in v) && "severity" in v && !("rule" in v)) {
        (v as Record<string, unknown>)["rule"] = k.toLowerCase().replace(/_/g, "-");
      }
    }
  }
  const entries = value instanceof Map ? [...value.values()] : Array.isArray(value) ? value : Object.values(value);
  for (const v of entries) collect(dir, v, out, depth + 1, seen);
}

function codeSortKey(code: string): [string, number] {
  const m = /^([A-Za-z]*)(\d+)/.exec(code);
  return [m?.[1] ?? code, Number(m?.[2] ?? 0)];
}

export async function loadLintRules(): Promise<{ languages: LanguageRules[]; failures: string[] }> {
  const languages: LanguageRules[] = [];
  const failures: string[] = [];
  for (const dir of fs.readdirSync(languagesRoot).sort()) {
    const pkgPath = path.join(languagesRoot, dir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    const packageName =
      (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string }).name ?? `@modelscript/${dir}`;
    const rules = new Map<string, RuleMeta>();
    const sources: string[] = [];
    for (const rel of CANDIDATES) {
      const file = path.join(languagesRoot, dir, rel);
      if (!fs.existsSync(file)) continue;
      try {
        const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
        const before = rules.size;
        collect(dir, mod, rules);
        if (rules.size > before) sources.push(`languages/${dir}/${rel}`);
      } catch (err) {
        failures.push(`languages/${dir}/${rel}: ${(err as Error).message.split("\n")[0] ?? ""}`);
      }
    }
    if (rules.size === 0) continue;
    const sorted = [...rules.values()].sort((a, b) => {
      const [pa, na] = codeSortKey(a.code);
      const [pb, nb] = codeSortKey(b.code);
      return pa.localeCompare(pb) || na - nb || a.rule.localeCompare(b.rule);
    });
    languages.push({ dir, packageName, sources, rules: sorted });
  }
  return { languages, failures };
}
