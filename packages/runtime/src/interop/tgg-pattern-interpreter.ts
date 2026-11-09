// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic Declarative Triple Graph Grammar (TGG) Pattern Interpreter.
 *
 * Evaluates `rule.source($, v)`, `rule.target($, v)`, and `rule.where(v)` directly
 * over `PolyglotNode` graphs in both forward (`source -> target`) and backward
 * (`target -> source`) directions, coordinating with `PolyglotTransformer`'s
 * `SemanticTheoryCoordinator` and shadow complement store.
 */

import type { TGGConstraint, TGGPattern, TGGRuleOptions } from "@modelscript/dsl/dsl/language.js";
import type { PolyglotNode, PolyglotTransformer } from "./polyglot-transformer.js";

export interface EvaluatedTGGRule {
  rule: TGGRuleOptions;
  sourcePattern: TGGPattern;
  targetPattern: TGGPattern;
  constraints: TGGConstraint[];
  priority: number;
}

export interface PatternMatchResult {
  rule: EvaluatedTGGRule;
  env: Record<string, any>;
  specificity: number;
  varToProp: Record<string, string>;
}

export interface GraphSyncChange {
  elementId: string;
  ruleName: string;
  property: string;
  sourceOldVal: any;
  targetNewVal: any;
  reconciledVal: any;
  strategy: string;
}

export interface GraphSyncResult {
  reconciledSource: PolyglotNode;
  changes: GraphSyncChange[];
  conflicts: ReturnType<PolyglotTransformer["getConflicts"]>;
}

const VAR_PREFIX = "__var_";

function isVarToken(val: unknown): val is string {
  return typeof val === "string" && val.startsWith(VAR_PREFIX);
}

function stripVar(val: unknown): string {
  return isVarToken(val) ? val.slice(VAR_PREFIX.length) : String(val ?? "");
}

const patternBuilderProxy: any = new Proxy(
  {},
  {
    get:
      (_, prop: string) =>
      (bindings: Record<string, any> = {}, children?: TGGPattern[], expr?: any): TGGPattern => ({
        nodeType: prop,
        bindings: bindings || {},
        ...(children ? { children } : {}),
        ...(expr ? { expr } : {}),
      }),
  },
);

const varTokenProxy = (name: string): string => `${VAR_PREFIX}${name}`;

/**
 * Evaluates a declarative `TGGRuleOptions` into normalized source/target `TGGPattern` descriptors.
 */
export function evaluateRuleDescriptor(rule: TGGRuleOptions): EvaluatedTGGRule {
  const sourcePattern: TGGPattern =
    typeof rule.source === "function"
      ? rule.source(patternBuilderProxy, varTokenProxy)
      : (rule.source ?? { nodeType: "Unknown", bindings: {} });
  const targetPattern: TGGPattern =
    typeof rule.target === "function"
      ? rule.target(patternBuilderProxy, varTokenProxy)
      : (rule.target ?? { nodeType: "Unknown", bindings: {} });
  const constraints: TGGConstraint[] =
    typeof rule.where === "function" ? rule.where(varTokenProxy) : (rule.where ?? []);

  return {
    rule,
    sourcePattern,
    targetPattern,
    constraints,
    priority: rule.priority ?? 0,
  };
}

function readNodeProperty(node: PolyglotNode, key: string): any {
  if (key in node && node[key] !== undefined) {
    return node[key];
  }
  const props = node["properties"] as Record<string, any> | undefined;
  if (props && key in props && props[key] !== undefined) {
    return props[key];
  }
  const mods = node["modifications"] as Record<string, any> | undefined;
  if (mods && key in mods && mods[key] !== undefined) {
    return mods[key];
  }
  if (node.attributes) {
    const attr = node.attributes.find((a) => a.name === key);
    if (attr && attr.value !== undefined) return attr.value;
  }
  return undefined;
}

function typesMatch(actualType: string | undefined, expectedType: string): boolean {
  if (!actualType) return false;
  if (actualType === expectedType) return true;
  const actualShort = actualType.split(".").pop() || actualType;
  const expectedShort = expectedType.split(".").pop() || expectedType;
  return actualShort === expectedShort && (actualType.includes(".") || expectedType.includes("."));
}

/**
 * Attempts to unify `node` against `pattern`, returning bound variables and match specificity.
 */
export function matchNodePattern(
  node: PolyglotNode,
  pattern: TGGPattern,
  evaluatedRule: EvaluatedTGGRule,
  transformer?: PolyglotTransformer,
): PatternMatchResult | null {
  if (transformer && !transformer.checkNAC(evaluatedRule.rule, node)) {
    return null;
  }

  let specificity = 0;
  if (node.kind && pattern.nodeType) {
    if (node.kind === pattern.nodeType) {
      specificity += 2;
    } else if (node["typeSpecifier"] && typesMatch(node["typeSpecifier"], pattern.nodeType)) {
      specificity += 2;
    } else {
      return null;
    }
  }

  const env: Record<string, any> = {};
  const varToProp: Record<string, string> = {};

  for (const [propKey, expectedVal] of Object.entries(pattern.bindings || {})) {
    const actualVal = readNodeProperty(node, propKey);
    if (isVarToken(expectedVal)) {
      const varName = stripVar(expectedVal);
      if (actualVal !== undefined) {
        if (varName in env && String(env[varName]) !== String(actualVal)) {
          return null;
        }
        env[varName] = actualVal;
        varToProp[varName] = propKey;
        specificity += 1;
      }
    } else if (expectedVal !== undefined) {
      if (propKey === "typeSpecifier" && typeof expectedVal === "string") {
        if (!typesMatch(typeof actualVal === "string" ? actualVal : node["typeSpecifier"], expectedVal)) {
          return null;
        }
      } else if (String(actualVal) !== String(expectedVal)) {
        return null;
      }
      specificity += 4;
    }
  }

  return {
    rule: evaluatedRule,
    env,
    specificity: specificity + evaluatedRule.priority * 10,
    varToProp,
  };
}

function evalSimpleInvertibleExpr(exprStr: string, env: Record<string, any>): void {
  const s = exprStr.trim();
  const assignIdx = s.indexOf("=");
  if (assignIdx === -1 || s[assignIdx + 1] === "=") return;
  const lhs = s.slice(0, assignIdx).trim();
  const rhs = s.slice(assignIdx + 1).trim();
  if (!lhs || env[lhs] !== undefined) return;

  // Replace bound identifiers in rhs
  let resolvedRhs = rhs;
  let allResolved = true;
  resolvedRhs = resolvedRhs.replace(/\b([A-Za-z_]\w*)\b/g, (ident) => {
    if (ident in env && env[ident] !== undefined) {
      return String(env[ident]);
    }
    allResolved = false;
    return ident;
  });

  if (!allResolved) return;
  if (/^[\d.+\-*/()\s]+$/.test(resolvedRhs)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const val = Function(`"use strict"; return (${resolvedRhs});`)();
      if (typeof val === "number" && Number.isFinite(val)) {
        env[lhs] = val;
      }
    } catch {
      env[lhs] = resolvedRhs;
    }
  } else {
    env[lhs] = resolvedRhs;
  }
}

/**
 * Solves `where` constraints bidirectionally over variable environment `env`.
 */
export function solveWhereConstraints(
  constraints: TGGConstraint[],
  env: Record<string, any>,
  direction: "forward" | "backward",
  typeMaps: Record<string, Record<string, string>> = {},
): void {
  const propagateEqualities = () => {
    for (const c of constraints) {
      if (c.kind === "eq" || c.kind === "reconcile" || c.kind === "reconcilePhysics") {
        const [rawA, rawB] = c.args;
        const varA = isVarToken(rawA) ? stripVar(rawA) : null;
        const varB = isVarToken(rawB) ? stripVar(rawB) : null;
        const valA = varA ? env[varA] : rawA;
        const valB = varB ? env[varB] : rawB;

        if (direction === "forward") {
          if (varB && env[varB] === undefined && valA !== undefined) {
            env[varB] = valA;
          } else if (varA && env[varA] === undefined && valB !== undefined) {
            env[varA] = valB;
          }
        } else {
          if (varA && env[varA] === undefined && valB !== undefined) {
            env[varA] = valB;
          } else if (varB && env[varB] === undefined && valA !== undefined) {
            env[varB] = valA;
          }
        }
      } else if (c.kind === "typeMap") {
        const [rawSrc, rawTgt, mapOrName] = c.args;
        const srcVar = isVarToken(rawSrc) ? stripVar(rawSrc) : null;
        const tgtVar = isVarToken(rawTgt) ? stripVar(rawTgt) : null;
        const dict: Record<string, string> =
          typeof mapOrName === "object" && mapOrName !== null
            ? mapOrName
            : (typeMaps[String(mapOrName)] ?? typeMaps[String(mapOrName).toLowerCase()] ?? {});

        if (direction === "forward" && srcVar && tgtVar && env[srcVar] !== undefined && env[tgtVar] === undefined) {
          const srcVal = String(env[srcVar]);
          env[tgtVar] = dict[srcVal] ?? srcVal;
        } else if (
          direction === "backward" &&
          srcVar &&
          tgtVar &&
          env[tgtVar] !== undefined &&
          env[srcVar] === undefined
        ) {
          const tgtVal = String(env[tgtVar]);
          const invEntry = Object.entries(dict).find(([, v]) => v === tgtVal);
          env[srcVar] = invEntry ? invEntry[0] : tgtVal;
        }
      } else if (c.kind === "formatUri") {
        const [rawId, prefix, rawTarget] = c.args;
        const idVar = isVarToken(rawId) ? stripVar(rawId) : null;
        const targetVar = isVarToken(rawTarget) ? stripVar(rawTarget) : null;
        const pfx = String(prefix ?? "");
        if (direction === "forward" && idVar && targetVar && env[idVar] !== undefined && env[targetVar] === undefined) {
          env[targetVar] = `${pfx}${env[idVar]}`;
        } else if (
          direction === "backward" &&
          idVar &&
          targetVar &&
          env[targetVar] !== undefined &&
          env[idVar] === undefined
        ) {
          const s = String(env[targetVar]);
          env[idVar] = s.startsWith(pfx) ? s.slice(pfx.length) : s;
        }
      } else if (c.kind === "invertible") {
        const [fwdExpr, bwdExpr] = c.args;
        if (direction === "forward" && typeof fwdExpr === "string") {
          evalSimpleInvertibleExpr(fwdExpr, env);
        } else if (direction === "backward" && typeof bwdExpr === "string") {
          evalSimpleInvertibleExpr(bwdExpr, env);
        }
      }
    }
  };

  propagateEqualities();

  // Apply defaults for any unbound variables
  for (const c of constraints) {
    if (c.kind === "defaultVal") {
      const [rawTarget, defaultVal] = c.args;
      const targetVar = isVarToken(rawTarget) ? stripVar(rawTarget) : null;
      if (targetVar && env[targetVar] === undefined) {
        env[targetVar] = defaultVal;
      }
    }
  }

  propagateEqualities();
}

/**
 * Extracts all field names declared in `tggComplement([...])` constraints on a rule.
 */
export function extractComplementFields(constraints: TGGConstraint[]): string[] {
  const fields: string[] = [];
  for (const c of constraints) {
    if (c.kind === "complement" && Array.isArray(c.args[0])) {
      for (const f of c.args[0]) {
        if (typeof f === "string" && !fields.includes(f)) {
          fields.push(f);
        }
      }
    }
  }
  return fields;
}

/**
 * Instantiates a `PolyglotNode` from a `TGGPattern` and solved variable bindings `env`.
 */
export function instantiateNodePattern(
  pattern: TGGPattern,
  env: Record<string, any>,
  fallbackName: string,
  complementData?: Record<string, any>,
): PolyglotNode {
  const properties: Record<string, any> = {};
  if (complementData) {
    for (const [k, v] of Object.entries(complementData)) {
      if (v !== undefined) {
        properties[k] = v;
      }
    }
  }

  for (const [propKey, patternVal] of Object.entries(pattern.bindings || {})) {
    if (isVarToken(patternVal)) {
      const varName = stripVar(patternVal);
      if (env[varName] !== undefined) {
        properties[propKey] = env[varName];
      }
    } else {
      properties[propKey] = patternVal;
    }
  }

  const resolvedName = String(
    properties["name"] ??
      properties["id"] ??
      properties["reqId"] ??
      properties["blockName"] ??
      properties["jointName"] ??
      properties["varName"] ??
      properties["swcName"] ??
      properties["portName"] ??
      properties["runnableName"] ??
      properties["modelName"] ??
      fallbackName,
  );

  const node: PolyglotNode = {
    ...properties,
    kind: pattern.nodeType,
    name: resolvedName,
    properties,
  };

  return node;
}
