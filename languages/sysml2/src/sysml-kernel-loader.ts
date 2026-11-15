// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SysML v2 Definition & Kernel Binding Loader.
 *
 * Extracts standard SysML v2 definitions (`action def`, `analysis def`,
 * `requirement def`, `verification def`), their `attribute` metadata,
 * `assume` / `require` / `assert` constraint blocks, and optional
 * `implementation = "wasm://...#..."` AssemblyScript/WASM kernel bindings.
 *
 * Constraint evaluation delegates to `./verification.ts` (`verifySysML2Requirements`)
 * for full arithmetic, compound boolean logic, vacuity detection, and safety margins.
 */

import { verifySysML2Requirements, type RequirementBlockSpec } from "./verification.js";

export type SysmlDefinitionKind = "action def" | "analysis def" | "requirement def" | "verification def";

export interface SysmlImplementationBinding {
  scheme: "wasm" | "ts" | "sysml";
  modulePath: string;
  exportName: string;
}

export interface SysmlConstraintSpec {
  kind: "require" | "assert";
  expression: string;
}

export interface SysmlDefinitionBlock {
  kind: SysmlDefinitionKind;
  name: string;
  attributes: Record<string, string>;
  assumptions: string[];
  constraints: string[];
  constraintSpecs: SysmlConstraintSpec[];
  implementation: SysmlImplementationBinding | null;
}

export interface SysmlPackageDefinitions {
  packageName: string;
  definitions: SysmlDefinitionBlock[];
}

export interface SysmlConstraintCheck {
  id: string;
  expression: string;
  passed: boolean;
  vacuous: boolean;
  margin: number;
  violatedAtoms: string[];
  details: string;
}

export function parseImplementationBinding(uri: string | undefined): SysmlImplementationBinding | null {
  if (!uri) return null;
  const trimmed = uri.trim().replace(/^["']|["']$/g, "");
  const match = /^(wasm|ts|sysml):\/\/([^#]+)(?:#([A-Za-z0-9_$-]+))?$/.exec(trimmed);
  if (match) {
    return {
      scheme: match[1] as SysmlImplementationBinding["scheme"],
      modulePath: match[2] ?? "",
      exportName: match[3] ?? "run",
    };
  }

  const pathMatch = /^([^#\s]+?\.(?:wasm|ts|tsx|js|mjs|mts))(?:#([A-Za-z0-9_$-]+))?$/i.exec(trimmed);
  if (!pathMatch?.[1]) return null;
  const modulePath = pathMatch[1];
  const norm = modulePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const scheme: SysmlImplementationBinding["scheme"] =
    /\.wasm$/i.test(norm) || norm.startsWith("assembly/") || norm.includes("/assembly/") ? "wasm" : "ts";
  return {
    scheme,
    modulePath,
    exportName: pathMatch[2] ?? "run",
  };
}

/**
 * Converts stringified SysML `attribute` defaults into typed JS primitives
 * (`number | boolean | string`) for constraint evaluation and WASM kernel input.
 */
export function coerceSysmlAttributes(
  attributes: Readonly<Record<string, string>>,
): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  for (const [k, raw] of Object.entries(attributes)) {
    if (raw === "true") out[k] = true;
    else if (raw === "false") out[k] = false;
    else if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
      const n = Number(raw);
      out[k] = Number.isFinite(n) ? n : raw;
    } else {
      out[k] = raw;
    }
  }
  return out;
}

function stripCommentsPreservingStrings(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch;
      i++;
      while (i < source.length) {
        const c = source[i]!;
        out += c;
        if (c === "\\" && i + 1 < source.length) {
          out += source[i + 1]!;
          i += 2;
          continue;
        }
        i++;
        if (c === quote) break;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Parses a SysML v2 source file for executable/verifiable definitions
 * (`action def`, `analysis def`, `requirement def`, `verification def`),
 * safely ignoring comments and handling `:>` specialization clauses.
 */
export function parseSysmlDefinitions(rawSource: string): SysmlPackageDefinitions {
  const source = stripCommentsPreservingStrings(rawSource);
  const pkgMatch = /\bpackage\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(source);
  const packageName = pkgMatch?.[1] ?? "SysML2Package";
  const definitions: SysmlDefinitionBlock[] = [];

  const headerRe =
    /\b(action\s+def|analysis\s+def|requirement\s+def|verification\s+def)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:>\s*[A-Za-z0-9_.]+)?\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = headerRe.exec(source)) !== null) {
    const rawKind = match[1]!.replace(/\s+/g, " ") as SysmlDefinitionKind;
    const name = match[2]!;
    let depth = 1;
    let i = match.index + match[0].length;
    const bodyStart = i;
    while (i < source.length && depth > 0) {
      const c = source[i]!;
      if (c === '"' || c === "'") {
        const q = c;
        i++;
        while (i < source.length) {
          if (source[i] === "\\") {
            i += 2;
            continue;
          }
          if (source[i] === q) {
            i++;
            break;
          }
          i++;
        }
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    const body = source.slice(bodyStart, Math.max(bodyStart, i - 1));

    const attributes: Record<string, string> = {};
    const attrRe = /\battribute\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*([^;]+);/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRe.exec(body)) !== null) {
      attributes[attrMatch[1]!] = attrMatch[2]!.trim().replace(/^["']|["']$/g, "");
    }

    const assumptions: string[] = [];
    const assumeRe = /\bassume\s+constraint\s*\{([^}]+)\}/g;
    let assumeMatch: RegExpExecArray | null;
    while ((assumeMatch = assumeRe.exec(body)) !== null) {
      assumptions.push(assumeMatch[1]!.replace(/;$/, "").trim());
    }

    const constraints: string[] = [];
    const constraintSpecs: SysmlConstraintSpec[] = [];
    const reqRe = /\b(require|assert)\s+constraint\s*\{([^}]+)\}/g;
    let reqMatch: RegExpExecArray | null;
    while ((reqMatch = reqRe.exec(body)) !== null) {
      const kind = reqMatch[1] as "require" | "assert";
      const expr = reqMatch[2]!.replace(/;$/, "").trim();
      constraints.push(expr);
      constraintSpecs.push({ kind, expression: expr });
    }

    definitions.push({
      kind: rawKind,
      name,
      attributes,
      assumptions,
      constraints,
      constraintSpecs,
      implementation: parseImplementationBinding(attributes["implementation"]),
    });
  }

  return { packageName, definitions };
}

/**
 * Evaluates all `assume` / `require` / `assert` constraint blocks on a parsed SysML v2
 * definition using `verifySysML2Requirements`, returning quantitative margins and vacuity.
 */
export function evaluateSysmlDefinition(
  def: SysmlDefinitionBlock,
  input: Record<string, number | boolean | string> = {},
): { passed: boolean; minMargin: number; checks: SysmlConstraintCheck[] } {
  const env: Record<string, number | boolean | string> = {
    ...coerceSysmlAttributes(def.attributes),
    ...input,
  };

  const combinedAssumption =
    def.assumptions.length > 0 ? def.assumptions.map((a) => `(${a})`).join(" and ") : undefined;

  const specs: RequirementBlockSpec[] = def.constraintSpecs.map((c, idx) => ({
    name: `${def.name}-${idx + 1}`,
    constraint: c.expression,
    assumption: combinedAssumption,
    kind: c.kind,
  }));

  const report = verifySysML2Requirements(specs, env);
  const checks: SysmlConstraintCheck[] = report.results.map((r) => ({
    id: r.name,
    expression: r.expression,
    passed: r.satisfied,
    vacuous: r.vacuous,
    margin: r.margin,
    violatedAtoms: r.violatedAtoms,
    details: r.vacuous
      ? `Vacuously satisfied (assumption '${combinedAssumption}' is false).`
      : r.satisfied
        ? `Satisfied '${r.expression}' (margin=${r.margin.toFixed(4)}).`
        : `Violated '${r.expression}' (margin=${r.margin.toFixed(4)}, atoms: ${r.violatedAtoms.join(", ") || "n/a"}).`,
  }));

  return {
    passed: report.allSatisfied,
    minMargin: report.minMargin,
    checks,
  };
}
