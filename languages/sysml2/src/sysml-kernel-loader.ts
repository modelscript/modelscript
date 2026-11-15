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

import {
  collectCstLeaves,
  findMatchingBraceLeaf,
  isSignedNumberText,
  isSysmlIdentLeaf,
  parseSysmlSource,
  sliceBetweenLeaves,
  stripSurroundingQuotes,
  trimTrailingSemicolon,
} from "./cst-utils.js";
import { evaluateSysML2Expression, parseSysML2Expression } from "./evaluator.js";
import { verifySysML2ConstraintBlock, verifySysML2Requirements, type RequirementBlockSpec } from "./verification.js";

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
  /** Unquoted attribute expressions or qualified cross-definition bindings (e.g. `UpstreamDef.metric`). */
  attributeBindings?: Record<string, string>;
  /** Explicit (`dependsOn`) and inferred (`OtherDef.attr`) upstream definition dependencies. */
  dependsOn?: string[];
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

export interface SysmlAssumptionEvaluation {
  active: boolean;
  combinedAssumption?: string;
  details: string;
}

export function parseImplementationBinding(uri: string | undefined): SysmlImplementationBinding | null {
  if (!uri) return null;
  const trimmed = stripSurroundingQuotes(uri.trim());
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
  const slashed = modulePath.replaceAll("\\", "/");
  const norm = slashed.startsWith("./") ? slashed.slice(2) : slashed;
  const scheme: SysmlImplementationBinding["scheme"] =
    norm.toLowerCase().endsWith(".wasm") || norm.startsWith("assembly/") || norm.includes("/assembly/") ? "wasm" : "ts";
  return {
    scheme,
    modulePath,
    exportName: pathMatch[2] ?? "run",
  };
}

/**
 * Coerces a single stringified SysML attribute literal into `number | boolean | string`.
 */
export function coerceSysmlValue(raw: string): number | boolean | string {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (isSignedNumberText(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  return trimmed;
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
    out[k] = coerceSysmlValue(raw);
  }
  return out;
}

const DEF_FIRST_KEYWORDS = new Set(["action", "analysis", "requirement", "verification"]);

/**
 * Parses a SysML v2 source file for executable/verifiable definitions
 * (`action def`, `analysis def`, `requirement def`, `verification def`),
 * safely ignoring comments and handling `:>` specialization clauses via the native GLR CST.
 */
export function parseSysmlDefinitions(rawSource: string): SysmlPackageDefinitions {
  const leaves = collectCstLeaves(parseSysmlSource(rawSource));
  let packageName = "SysML2Package";
  for (let i = 0; i + 2 < leaves.length; i++) {
    if (leaves[i]!.text === "package" && isSysmlIdentLeaf(leaves[i + 1]!.text) && leaves[i + 2]!.text === "{") {
      packageName = leaves[i + 1]!.text;
      break;
    }
  }

  const definitions: SysmlDefinitionBlock[] = [];
  for (let i = 0; i + 3 < leaves.length; i++) {
    const firstKw = leaves[i]!.text;
    if (!DEF_FIRST_KEYWORDS.has(firstKw) || leaves[i + 1]!.text !== "def") continue;
    const nameLeaf = leaves[i + 2]!;
    if (!isSysmlIdentLeaf(nameLeaf.text)) continue;

    let openIdx = i + 3;
    if (leaves[openIdx]?.text === ":>") {
      openIdx++;
      while (openIdx < leaves.length && leaves[openIdx]!.text !== "{" && leaves[openIdx]!.text !== ";") {
        openIdx++;
      }
    }
    if (openIdx >= leaves.length || leaves[openIdx]!.text !== "{") continue;

    const closeIdx = findMatchingBraceLeaf(leaves, openIdx);
    if (closeIdx < 0) continue;

    const rawKind = `${firstKw} def` as SysmlDefinitionKind;
    const name = nameLeaf.text;
    const attributes: Record<string, string> = {};
    const attributeBindings: Record<string, string> = {};
    const assumptions: string[] = [];
    const constraints: string[] = [];
    const constraintSpecs: SysmlConstraintSpec[] = [];

    let k = openIdx + 1;
    while (k < closeIdx) {
      const tok = leaves[k]!.text;
      if (tok === "assume" && leaves[k + 1]?.text === "constraint" && leaves[k + 2]?.text === "{") {
        const cClose = findMatchingBraceLeaf(leaves, k + 2);
        if (cClose > k + 2 && cClose < closeIdx) {
          const expr = trimTrailingSemicolon(
            sliceBetweenLeaves(rawSource, leaves[k + 2]!, leaves[cClose]!).trim(),
          ).trim();
          assumptions.push(expr);
          k = cClose + 1;
          continue;
        }
      }

      if (
        (tok === "require" || tok === "assert") &&
        leaves[k + 1]?.text === "constraint" &&
        leaves[k + 2]?.text === "{"
      ) {
        const cClose = findMatchingBraceLeaf(leaves, k + 2);
        if (cClose > k + 2 && cClose < closeIdx) {
          const expr = trimTrailingSemicolon(
            sliceBetweenLeaves(rawSource, leaves[k + 2]!, leaves[cClose]!).trim(),
          ).trim();
          constraints.push(expr);
          constraintSpecs.push({ kind: tok, expression: expr });
          k = cClose + 1;
          continue;
        }
      }

      if (tok === "attribute" && k + 1 < closeIdx && isSysmlIdentLeaf(leaves[k + 1]!.text)) {
        const attrName = leaves[k + 1]!.text;
        let scan = k + 2;
        if (leaves[scan]?.text === ":") {
          scan++;
          while (
            scan < closeIdx &&
            leaves[scan]!.text !== "=" &&
            leaves[scan]!.text !== ";" &&
            leaves[scan]!.text !== "{"
          ) {
            scan++;
          }
        }
        if (scan < closeIdx && leaves[scan]!.text === "=") {
          let semi = scan + 1;
          while (semi < closeIdx && leaves[semi]!.text !== ";") {
            semi++;
          }
          if (semi < closeIdx && semi > scan + 1) {
            const rawValue = rawSource.slice(leaves[scan + 1]!.start, leaves[semi - 1]!.end).trim();
            const isQuoted =
              (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
              (rawValue.startsWith("'") && rawValue.endsWith("'"));
            const cleanValue = isQuoted ? stripSurroundingQuotes(rawValue) : rawValue;
            attributes[attrName] = cleanValue;
            if (!isQuoted && cleanValue !== "true" && cleanValue !== "false" && !isSignedNumberText(cleanValue)) {
              attributeBindings[attrName] = cleanValue;
            }
            k = semi + 1;
            continue;
          }
        }
      }

      if (tok === "{") {
        const nestedClose = findMatchingBraceLeaf(leaves, k);
        if (nestedClose > k) {
          k = nestedClose + 1;
          continue;
        }
      }
      k++;
    }

    definitions.push({
      kind: rawKind,
      name,
      attributes,
      attributeBindings,
      assumptions,
      constraints,
      constraintSpecs,
      implementation: parseImplementationBinding(attributes["implementation"]),
    });

    i = closeIdx;
  }

  const knownNames = new Set(definitions.map((d) => d.name));
  for (const def of definitions) {
    def.dependsOn = collectDefinitionDependencies(def, knownNames);
  }

  return { packageName, definitions };
}

function collectQualifiedRoots(
  expr: string,
  knownNames: ReadonlySet<string>,
  selfName: string,
  out: Set<string>,
): void {
  const leaves = collectCstLeaves(parseSysmlSource(`package _w { require constraint { ${expr} } }`));
  // Skip wrapper leaves `package _w { require constraint {` ... `}` `}`
  const start = Math.min(6, leaves.length);
  const end = Math.max(start, leaves.length - 2);
  for (let i = start; i + 2 < end; i++) {
    const rootLeaf = leaves[i]!;
    if (isSysmlIdentLeaf(rootLeaf.text) && leaves[i + 1]!.text === "." && isSysmlIdentLeaf(leaves[i + 2]!.text)) {
      const root = rootLeaf.text;
      if (root !== selfName && knownNames.has(root)) {
        out.add(root);
      }
    }
  }
}

function splitExplicitDependencies(explicit: string): string[] {
  const tokens: string[] = [];
  let start = -1;
  for (let i = 0; i <= explicit.length; i++) {
    const ch = i < explicit.length ? explicit[i]! : ",";
    const isSep = ch === "," || ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
    if (isSep) {
      if (start >= 0) {
        tokens.push(explicit.slice(start, i));
        start = -1;
      }
    } else if (start < 0) {
      start = i;
    }
  }
  return tokens;
}

function collectDefinitionDependencies(def: SysmlDefinitionBlock, knownNames: ReadonlySet<string>): string[] {
  const deps = new Set<string>();
  const explicit = def.attributes["dependsOn"];
  if (explicit) {
    for (const token of splitExplicitDependencies(explicit)) {
      const dep = token.trim();
      if (dep && dep !== def.name) deps.add(dep);
    }
  }
  for (const expr of Object.values(def.attributeBindings ?? {})) {
    collectQualifiedRoots(expr, knownNames, def.name, deps);
  }
  for (const expr of def.assumptions) {
    collectQualifiedRoots(expr, knownNames, def.name, deps);
  }
  for (const expr of def.constraints) {
    collectQualifiedRoots(expr, knownNames, def.name, deps);
  }
  return Array.from(deps);
}

/**
 * Topologically orders SysML definitions by explicit (`dependsOn`) and inferred
 * cross-definition (`UpstreamDef.attr`) dependencies while preserving declaration order
 * among independent definitions.
 */
export function resolveSysmlExecutionOrder(definitions: readonly SysmlDefinitionBlock[]): SysmlDefinitionBlock[] {
  const indexOf = new Map<string, number>();
  definitions.forEach((d, idx) => indexOf.set(d.name, idx));
  const knownNames = new Set(indexOf.keys());
  const inDegree = new Array<number>(definitions.length).fill(0);
  const dependents: number[][] = definitions.map(() => []);

  for (let i = 0; i < definitions.length; i++) {
    const def = definitions[i]!;
    const deps = new Set(def.dependsOn ?? collectDefinitionDependencies(def, knownNames));
    for (const depName of deps) {
      const depIdx = indexOf.get(depName);
      if (depIdx === undefined) {
        throw new Error(`SysML definition '${def.name}' declares unknown dependency '${depName}'.`);
      }
      if (depIdx === i) continue;
      dependents[depIdx]!.push(i);
      inDegree[i]!++;
    }
  }

  const ready: number[] = [];
  for (let i = 0; i < inDegree.length; i++) {
    if (inDegree[i] === 0) ready.push(i);
  }

  const ordered: SysmlDefinitionBlock[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => a - b);
    const cur = ready.shift()!;
    ordered.push(definitions[cur]!);
    for (const next of dependents[cur]!) {
      inDegree[next]!--;
      if (inDegree[next] === 0) ready.push(next);
    }
  }

  if (ordered.length !== definitions.length) {
    const stuck = definitions.filter((_, idx) => (inDegree[idx] ?? 0) > 0).map((d) => d.name);
    throw new Error(`Circular dependency detected among SysML definitions: ${stuck.join(", ")}.`);
  }
  return ordered;
}

/**
 * Evaluates a definition's `assume constraint` preconditions against upstream/local context
 * before kernel execution, allowing conditional DAG branches to be skipped cleanly.
 */
export function evaluateSysmlAssumptions(
  def: SysmlDefinitionBlock,
  env: Readonly<Record<string, number | boolean | string>> = {},
): SysmlAssumptionEvaluation {
  if (def.assumptions.length === 0) {
    return { active: true, details: "No assume constraint preconditions." };
  }
  const combined = def.assumptions.map((a) => `(${a})`).join(" and ");
  const mergedEnv: Record<string, number | boolean | string> = {
    ...resolveDefinitionInputs(def, env),
    ...env,
  };
  const res = verifySysML2ConstraintBlock(combined, mergedEnv);
  return {
    active: res.satisfied,
    combinedAssumption: combined,
    details: res.satisfied
      ? `Precondition '${combined}' satisfied.`
      : `Precondition '${combined}' is false; definition skipped (vacuous).`,
  };
}

/**
 * Resolves a definition's input parameters by coercing literal attributes, merging
 * CLI/caller overrides, and evaluating unquoted cross-definition / arithmetic bindings.
 */
export function resolveDefinitionInputs(
  def: SysmlDefinitionBlock,
  upstreamEnv: Readonly<Record<string, number | boolean | string>> = {},
  overrides: Readonly<Record<string, number | boolean | string>> = {},
): Record<string, number | boolean | string> {
  const resolved: Record<string, number | boolean | string> = {
    ...coerceSysmlAttributes(def.attributes),
  };
  const scopedPrefix = `${def.name}.`;
  const directOverrides: Record<string, number | boolean | string> = {};

  for (const [k, v] of Object.entries(overrides)) {
    if (k.startsWith(scopedPrefix)) {
      directOverrides[k.slice(scopedPrefix.length)] = v;
    } else if (!k.includes(".")) {
      directOverrides[k] = v;
    }
  }
  for (const [k, v] of Object.entries(directOverrides)) {
    resolved[k] = v;
  }

  const localEnv: Record<string, number | boolean | string> = {
    ...upstreamEnv,
    ...resolved,
  };
  const overriddenKeys = new Set(Object.keys(directOverrides));

  for (const [key, expr] of Object.entries(def.attributeBindings ?? {})) {
    if (overriddenKeys.has(key)) continue;
    try {
      const val = evaluateSysML2Expression(parseSysML2Expression(expr), localEnv);
      const valid =
        typeof val === "number" ? Number.isFinite(val) : typeof val === "boolean" || typeof val === "string";
      if (valid) {
        resolved[key] = val;
        localEnv[key] = val;
      }
    } catch {
      // Keep string representation when an attribute value is not an expression
    }
  }

  return resolved;
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
