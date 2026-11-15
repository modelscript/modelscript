// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic Declarative Triple Graph Grammar (TGG) Pattern Interpreter.
 *
 * Evaluates `rule.source($, v)`, `rule.target($, v)`, and `rule.where(v)` directly
 * over `PolyglotNode` graphs in both forward (`source -> target`) and backward
 * (`target -> source`) directions, coordinating with `PolyglotTransformer`'s
 * `SemanticTheoryCoordinator` and shadow complement store.
 */

import { invertExpression } from "@modelscript/dsl/codegen/analysis/inversion";
import type { TGGConstraint, TGGPattern, TGGRuleOptions } from "@modelscript/dsl/dsl/language.js";
import type { PolyglotNode, PolyglotTransformer } from "./polyglot-transformer.js";

const NODE_NAME_KEYS: string[] = [
  "name",
  "id",
  "reqId",
  "blockName",
  "jointName",
  "varName",
  "swcName",
  "portName",
  "runnableName",
  "modelName",
];

/**
 * Registers an additional property key used to resolve a PolyglotNode's canonical name.
 */
export function registerNodeNameKey(key: string): void {
  if (!NODE_NAME_KEYS.includes(key)) {
    NODE_NAME_KEYS.push(key);
  }
}

export interface EvaluatedTGGRule {
  rule: TGGRuleOptions;
  sourcePattern: TGGPattern;
  targetPattern: TGGPattern;
  contextSourcePattern?: TGGPattern | undefined;
  contextTargetPattern?: TGGPattern | undefined;
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
      ? (rule.source(patternBuilderProxy, varTokenProxy) as TGGPattern)
      : ((rule.source as TGGPattern | undefined) ?? { nodeType: "Unknown", bindings: {} });
  const targetPattern: TGGPattern =
    typeof rule.target === "function"
      ? (rule.target(patternBuilderProxy, varTokenProxy) as TGGPattern)
      : ((rule.target as TGGPattern | undefined) ?? { nodeType: "Unknown", bindings: {} });
  const constraints: TGGConstraint[] =
    typeof rule.where === "function" ? rule.where(varTokenProxy) : (rule.where ?? []);

  const ctxObj = typeof rule.context === "function" ? rule.context(patternBuilderProxy, varTokenProxy) : rule.context;
  const evalPat = (p: any): TGGPattern | undefined => {
    if (!p) return undefined;
    return typeof p === "function" ? p(patternBuilderProxy, varTokenProxy) : p;
  };
  const contextSourcePattern = evalPat(ctxObj?.source);
  const contextTargetPattern = evalPat(ctxObj?.target);

  return {
    rule,
    sourcePattern,
    targetPattern,
    ...(contextSourcePattern ? { contextSourcePattern } : {}),
    ...(contextTargetPattern ? { contextTargetPattern } : {}),
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
  contextNode?: PolyglotNode,
  contextPattern?: TGGPattern,
): PatternMatchResult | null {
  if (transformer && !transformer.checkNAC(evaluatedRule.rule, node)) {
    return null;
  }

  let specificity = 0;
  const env: Record<string, any> = {};
  const varToProp: Record<string, string> = {};

  if (contextPattern) {
    if (!contextNode) return null;
    if (contextNode.kind && contextPattern.nodeType && contextNode.kind !== contextPattern.nodeType) {
      if (!contextNode["typeSpecifier"] || !typesMatch(contextNode["typeSpecifier"], contextPattern.nodeType)) {
        return null;
      }
    }
    specificity += 1;
    for (const [ctxKey, ctxExpected] of Object.entries(contextPattern.bindings || {})) {
      const ctxActual = readNodeProperty(contextNode, ctxKey);
      if (isVarToken(ctxExpected)) {
        const varName = stripVar(ctxExpected);
        if (ctxActual !== undefined) {
          env[varName] = ctxActual;
          varToProp[varName] = ctxKey;
          specificity += 1;
        }
      } else if (ctxActual === undefined || String(ctxActual) !== String(ctxExpected)) {
        return null;
      } else {
        specificity += 1;
      }
    }
  }

  if (node.kind && pattern.nodeType) {
    if (node.kind === pattern.nodeType) {
      specificity += 2;
    } else if (node["typeSpecifier"] && typesMatch(node["typeSpecifier"], pattern.nodeType)) {
      specificity += 2;
    } else {
      return null;
    }
  }

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

function evalSafeArithmeticExpr(expr: string): number | null {
  let pos = 0;
  const len = expr.length;

  const skipWs = () => {
    while (pos < len && /\s/.test(expr[pos]!)) pos++;
  };

  const parseExpr = (): number => {
    let left = parseTerm();
    while (true) {
      skipWs();
      const ch = expr[pos];
      if (ch === "+") {
        pos++;
        left += parseTerm();
      } else if (ch === "-") {
        pos++;
        left -= parseTerm();
      } else {
        break;
      }
    }
    return left;
  };

  const parseTerm = (): number => {
    let left = parsePower();
    while (true) {
      skipWs();
      const ch = expr[pos];
      if (ch === "*") {
        pos++;
        left *= parsePower();
      } else if (ch === "/") {
        pos++;
        left /= parsePower();
      } else {
        break;
      }
    }
    return left;
  };

  const parsePower = (): number => {
    const base = parseUnary();
    skipWs();
    if (expr[pos] === "^") {
      pos++;
      return Math.pow(base, parsePower());
    }
    if (expr[pos] === "*" && expr[pos + 1] === "*") {
      pos += 2;
      return Math.pow(base, parsePower());
    }
    return base;
  };

  const parseUnary = (): number => {
    skipWs();
    if (expr[pos] === "-") {
      pos++;
      return -parseUnary();
    }
    if (expr[pos] === "+") {
      pos++;
      return parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    skipWs();
    if (expr[pos] === "(") {
      pos++;
      const val = parseExpr();
      skipWs();
      if (expr[pos] !== ")") throw new Error("Unclosed parenthesis");
      pos++;
      return val;
    }

    const numMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(expr.slice(pos));
    if (numMatch) {
      pos += numMatch[0].length;
      return Number(numMatch[0]);
    }

    const fnMatch = /^(?:Math\.)?([A-Za-z_]\w*)\s*\(/.exec(expr.slice(pos));
    if (fnMatch) {
      const fnName = fnMatch[1]!;
      pos += fnMatch[0].length;
      const args: number[] = [];
      skipWs();
      if (expr[pos] !== ")") {
        args.push(parseExpr());
        skipWs();
        while (expr[pos] === ",") {
          pos++;
          args.push(parseExpr());
          skipWs();
        }
      }
      if (expr[pos] !== ")") throw new Error("Unclosed function call");
      pos++;
      switch (fnName) {
        case "sqrt":
          return Math.sqrt(args[0]!);
        case "pow":
          return Math.pow(args[0]!, args[1]!);
        case "exp":
          return Math.exp(args[0]!);
        case "log":
        case "ln":
          return Math.log(args[0]!);
        case "abs":
          return Math.abs(args[0]!);
        case "sin":
          return Math.sin(args[0]!);
        case "cos":
          return Math.cos(args[0]!);
        case "tan":
          return Math.tan(args[0]!);
        case "min":
          return Math.min(...args);
        case "max":
          return Math.max(...args);
        default:
          throw new Error(`Unsupported function: ${fnName}`);
      }
    }

    throw new Error(`Unexpected token at ${pos}`);
  };

  try {
    const val = parseExpr();
    skipWs();
    if (pos !== len || !Number.isFinite(val)) return null;
    return val;
  } catch {
    return null;
  }
}

function evalSimpleInvertibleExpr(exprStr: string, env: Record<string, any>): void {
  const s = exprStr.trim();
  const assignIdx = s.indexOf("=");
  if (assignIdx === -1 || s[assignIdx + 1] === "=") return;
  const lhs = s.slice(0, assignIdx).trim();
  const rhs = s.slice(assignIdx + 1).trim();
  if (!lhs || env[lhs] !== undefined) return;

  const mathReserved = new Set(["Math", "sqrt", "pow", "exp", "log", "ln", "abs", "sin", "cos", "tan", "min", "max"]);
  let allResolved = true;
  const resolvedRhs = rhs.replace(/\b([A-Za-z_]\w*)\b/g, (ident) => {
    if (mathReserved.has(ident)) return ident;
    if (ident in env && env[ident] !== undefined) {
      return String(env[ident]);
    }
    allResolved = false;
    return ident;
  });

  if (!allResolved) return;
  const numericVal = evalSafeArithmeticExpr(resolvedRhs);
  if (numericVal !== null) {
    env[lhs] = numericVal;
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
            ? (mapOrName as Record<string, string>)
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
        } else if (direction === "backward") {
          if (typeof bwdExpr === "string" && bwdExpr.trim().length > 0) {
            evalSimpleInvertibleExpr(bwdExpr, env);
          } else if (typeof fwdExpr === "string") {
            const inv = invertExpression(fwdExpr);
            if (inv.isInvertible && inv.sourceVar && inv.invertedExpr) {
              evalSimpleInvertibleExpr(`${inv.sourceVar} = ${inv.invertedExpr}`, env);
            }
          }
        }
      } else if (c.kind === "compute") {
        const [rawTarget, expr] = c.args;
        const targetVar = isVarToken(rawTarget) ? stripVar(rawTarget) : String(rawTarget ?? "");
        if (targetVar && env[targetVar] === undefined && typeof expr === "string") {
          evalSimpleInvertibleExpr(`${targetVar} = ${expr}`, env);
        }
      } else if (c.kind === "exprMap" || c.kind === "physicalPort") {
        const [rawA, rawB] = c.args;
        const varA = isVarToken(rawA) ? stripVar(rawA) : null;
        const varB = isVarToken(rawB) ? stripVar(rawB) : null;
        const valA = varA ? env[varA] : rawA;
        const valB = varB ? env[varB] : rawB;
        if (direction === "forward" && varB && env[varB] === undefined && valA !== undefined) {
          env[varB] = valA;
        } else if (direction === "backward" && varA && env[varA] === undefined && valB !== undefined) {
          env[varA] = valB;
        }
      } else if (c.kind === "path") {
        const [rawRoot, pathStr, rawTarget] = c.args;
        const rootVar = isVarToken(rawRoot) ? stripVar(rawRoot) : null;
        const targetVar = isVarToken(rawTarget) ? stripVar(rawTarget) : null;
        const rootObj = rootVar ? env[rootVar] : rawRoot;
        if (
          targetVar &&
          env[targetVar] === undefined &&
          rootObj &&
          typeof rootObj === "object" &&
          typeof pathStr === "string"
        ) {
          let cur: any = rootObj;
          for (const seg of pathStr.split("/").filter(Boolean)) {
            if (cur == null) break;
            cur = cur[seg];
          }
          if (cur !== undefined) env[targetVar] = cur;
        }
      } else if (c.kind === "mapList") {
        const [rawSrc, rawTgt] = c.args;
        const srcVar = isVarToken(rawSrc) ? stripVar(rawSrc) : null;
        const tgtVar = isVarToken(rawTgt) ? stripVar(rawTgt) : null;
        if (direction === "forward" && srcVar && tgtVar && Array.isArray(env[srcVar]) && env[tgtVar] === undefined) {
          env[tgtVar] = [...env[srcVar]];
        } else if (
          direction === "backward" &&
          srcVar &&
          tgtVar &&
          Array.isArray(env[tgtVar]) &&
          env[srcVar] === undefined
        ) {
          env[srcVar] = [...env[tgtVar]];
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

  const resolvedKey = NODE_NAME_KEYS.find((k) => properties[k] !== undefined && properties[k] !== null);
  const resolvedName = String(resolvedKey ? properties[resolvedKey] : fallbackName);

  const node: PolyglotNode = {
    ...properties,
    kind: pattern.nodeType,
    name: resolvedName,
    properties,
  };

  return node;
}
