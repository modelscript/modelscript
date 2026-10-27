// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-implied-eval */

/**
 * Closed-Loop Compiler Verification Engine.
 *
 * Implements the 4 sequential verification gates:
 * 1. Gate 1: WASM GLR Syntax & CST Integrity
 * 2. Gate 2: QUDV SI-7 Physical Dimensional Calculus
 * 3. Gate 3: SMT Real Simplex & Octagon DBM Requirement Feasibility
 * 4. Gate 4: DAE Arena Structural Balance (N_eq == N_var) & BLT Causalization
 */

import {
  createSysML2QueryEngine,
  createSysML2WorkspaceIndex,
  extractSysML2Constraints,
  formatDimension,
  isDimensionless,
  loadEmbeddedKerMLStdlib,
  resolveTypeDimension,
  verifyConstraintSet,
  type ExtractedConstraint,
  type SMTRequirementCheckResult,
} from "@modelscript/sysml2";

export type ClosedLoopLanguage = "sysml2" | "sysml" | "modelica";

export interface GateDiagnostic {
  gate: 1 | 2 | 3 | 4;
  gateName: "WASM GLR Syntax" | "QUDV Physical Dimensions" | "SMT Requirement Feasibility" | "DAE Structural Balance";
  severity: "error" | "warning";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  code?: string | undefined;
  sourceContext?: string | undefined;
  metadata?: Record<string, any> | undefined;
}

export interface GateVerificationResult {
  gate: 1 | 2 | 3 | 4;
  gateName: "WASM GLR Syntax" | "QUDV Physical Dimensions" | "SMT Requirement Feasibility" | "DAE Structural Balance";
  passed: boolean;
  diagnostics: GateDiagnostic[];
  metadata?:
    | {
        astNodeCount?: number | undefined;
        inferredDimensions?: Record<string, string> | undefined;
        checkedFeatures?: number | undefined;
        isConsistent?: boolean | undefined;
        conflictingRequirements?: string[] | undefined;
        unsatCore?: string[] | undefined;
        numVariables?: number | undefined;
        numEquations?: number | undefined;
        numConstraints?: number | undefined;
        degreesOfFreedom?: number | undefined;
        isBalanced?: boolean | undefined;
        bltBlocksCount?: number | undefined;
        status?: string | undefined;
      }
    | undefined;
}

export interface ClosedLoopCandidateVerification {
  allPassed: boolean;
  gates: GateVerificationResult[];
  summary: string;
  timestamp: string;
}

export interface VerifyCandidateOptions {
  parser?: any;
  targetGates?: (1 | 2 | 3 | 4)[] | undefined;
  documentUri?: string | undefined;
}

/**
 * Resolves a default WASM parser for the specified language.
 */
export async function getWasmParserForLanguage(lang: ClosedLoopLanguage): Promise<any | null> {
  const norm = lang.toLowerCase();
  if (norm === "sysml2" || norm === "sysml") {
    if ((globalThis as any).sysml2Parser) return (globalThis as any).sysml2Parser;
    try {
      const { createRequire } = await import("node:module");
      const req = createRequire(import.meta.url);
      let wasmPath: string | undefined;
      try {
        wasmPath = req.resolve("@modelscript/sysml2/parser.wasm");
      } catch {
        try {
          wasmPath = req.resolve("@modelscript/sysml2/dist/parser.wasm");
        } catch {
          const path = await import("node:path");
          const fs = await import("node:fs");
          const cwd = typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : "/";
          const candidate = path.resolve(cwd, "languages/sysml2/dist/parser.wasm");
          if (fs.existsSync(candidate)) wasmPath = candidate;
        }
      }
      if (wasmPath) {
        const { createWasmParser } = await import("@modelscript/dsl/bindings");
        const { parser } = await createWasmParser(wasmPath);
        (globalThis as any).sysml2Parser = parser;
        return parser;
      }
    } catch {
      // ignore
    }
  } else if (norm === "modelica") {
    if ((globalThis as any).modelicaParser) return (globalThis as any).modelicaParser;
    try {
      const { createRequire } = await import("node:module");
      const req = createRequire(import.meta.url);
      let wasmPath: string | undefined;
      try {
        wasmPath = req.resolve("@modelscript/modelica/parser.wasm");
      } catch {
        try {
          wasmPath = req.resolve("@modelscript/modelica/dist/parser.wasm");
        } catch {
          const path = await import("node:path");
          const fs = await import("node:fs");
          const cwd = typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : "/";
          const candidate = path.resolve(cwd, "languages/modelica/dist/parser.wasm");
          if (fs.existsSync(candidate)) wasmPath = candidate;
        }
      }
      if (wasmPath) {
        const { createWasmParser } = await import("@modelscript/dsl/bindings");
        const { parser } = await createWasmParser(wasmPath);
        (globalThis as any).modelicaParser = parser;
        return parser;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Gate 1: WASM GLR Syntax Parser & CST Integrity
 */
export async function verifyGate1Syntax(
  code: string,
  language: ClosedLoopLanguage,
  parserOverride?: any,
): Promise<{ result: GateVerificationResult; tree?: any }> {
  const diagnostics: GateDiagnostic[] = [];
  const parser = parserOverride ?? (await getWasmParserForLanguage(language));

  if (!parser) {
    // If no parser is loadable in current environment, do a structural sanity check
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      diagnostics.push({
        gate: 1,
        gateName: "WASM GLR Syntax",
        severity: "error",
        message: `Mismatched brace delimiters: found ${openBraces} '{' vs ${closeBraces} '}'.`,
      });
    }
    return {
      result: {
        gate: 1,
        gateName: "WASM GLR Syntax",
        passed: diagnostics.length === 0,
        diagnostics,
        metadata: { status: "Structural fallback parser used" },
      },
    };
  }

  let tree: any = null;
  try {
    tree = parser.parse(code);
  } catch (err: any) {
    diagnostics.push({
      gate: 1,
      gateName: "WASM GLR Syntax",
      severity: "error",
      message: `Fatal parser exception: ${err?.message ?? String(err)}`,
    });
    return {
      result: {
        gate: 1,
        gateName: "WASM GLR Syntax",
        passed: false,
        diagnostics,
      },
    };
  }

  if (!tree || !tree.rootNode) {
    diagnostics.push({
      gate: 1,
      gateName: "WASM GLR Syntax",
      severity: "error",
      message: "Parser produced an empty syntax tree.",
    });
    return {
      result: {
        gate: 1,
        gateName: "WASM GLR Syntax",
        passed: false,
        diagnostics,
      },
    };
  }

  let nodeCount = 0;
  const walk = (node: any) => {
    if (!node) return;
    nodeCount++;
    const hasErr = typeof node.hasError === "function" ? node.hasError() : Boolean(node.hasError);
    if (!hasErr && node.type !== "ERROR") return;

    const isMissing = typeof node.isMissing === "function" ? node.isMissing() : Boolean(node.isMissing);
    const isError = node.type === "ERROR" || isMissing;

    if (isError) {
      const pos = node.startPosition || { row: 0, column: 0 };
      const snippet = node.text ? node.text.trim() : "";
      diagnostics.push({
        gate: 1,
        gateName: "WASM GLR Syntax",
        severity: "error",
        message: isMissing
          ? `Missing expected syntax token at line ${pos.row + 1}, column ${pos.column + 1}.`
          : `Syntax error near '${snippet || "<unknown>"}' at line ${pos.row + 1}, column ${pos.column + 1}.`,
        line: pos.row + 1,
        column: pos.column + 1,
        startOffset: node.startIndex ?? node.startOffset,
        endOffset: node.endIndex ?? node.endOffset,
        sourceContext: snippet,
      });
    }

    const children = node.children || [];
    for (const child of children) {
      walk(child);
    }
  };

  walk(tree.rootNode);

  // Check delimiter balance
  const openBraces = (code.match(/\{/g) || []).length;
  const closeBraces = (code.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    diagnostics.push({
      gate: 1,
      gateName: "WASM GLR Syntax",
      severity: "error",
      message: `Syntax error: unbalanced braces (found ${openBraces} '{' vs ${closeBraces} '}').`,
    });
  }

  // Fallback: if tree.rootNode indicates an error but no node was explicitly flagged
  if (
    diagnostics.length === 0 &&
    (typeof tree.rootNode.hasError === "function" ? tree.rootNode.hasError() : Boolean(tree.rootNode.hasError))
  ) {
    diagnostics.push({
      gate: 1,
      gateName: "WASM GLR Syntax",
      severity: "error",
      message: "Syntax error detected in model declaration.",
    });
  }

  return {
    result: {
      gate: 1,
      gateName: "WASM GLR Syntax",
      passed: diagnostics.length === 0,
      diagnostics,
      metadata: { astNodeCount: nodeCount },
    },
    tree,
  };
}

/**
 * Gate 2: QUDV SI-7 Dimensional Calculus
 */
export async function verifyGate2Dimensions(
  code: string,
  language: ClosedLoopLanguage,
  tree?: any,
  documentUri = "file:///candidate/model.sysml",
): Promise<GateVerificationResult> {
  const diagnostics: GateDiagnostic[] = [];
  const inferredDims: Record<string, string> = {};

  const norm = language.toLowerCase();
  if (norm === "sysml2" || norm === "sysml") {
    if (!tree) {
      return {
        gate: 2,
        gateName: "QUDV Physical Dimensions",
        passed: true,
        diagnostics: [],
        metadata: { status: "Skipped: no CST tree available" },
      };
    }

    const ws = createSysML2WorkspaceIndex();
    loadEmbeddedKerMLStdlib(ws);

    ws.register(documentUri, () => tree.rootNode);
    const unified = ws.toUnified();
    const qe = createSysML2QueryEngine(unified, tree);
    const db = qe.toQueryDB();

    let checkedCount = 0;

    // Collect all symbol entries
    const entries: any[] = [];
    if (unified.symbols instanceof Map) {
      for (const entry of unified.symbols.values()) entries.push(entry);
    } else if (Array.isArray((unified as any).symbols)) {
      for (const entry of (unified as any).symbols as any[]) entries.push(entry);
    } else if (typeof (unified as any).symbols === "object" && (unified as any).symbols !== null) {
      for (const entry of Object.values((unified as any).symbols)) entries.push(entry);
    }

    // 1. Check all symbol entries for dimensional assignment errors
    for (const entry of entries) {
      if (!entry) continue;
      if (entry.resourceId && entry.resourceId !== documentUri) continue;
      checkedCount++;

      // Check dimensional assignment lint
      try {
        const assignDiag = (qe as any).fetch("lint__dimensionalAssignment", entry.id);
        if (assignDiag && (assignDiag as any).message) {
          diagnostics.push({
            gate: 2,
            gateName: "QUDV Physical Dimensions",
            severity: "error",
            message: (assignDiag as any).message,
            startOffset: (assignDiag as any).range?.startOffset,
            endOffset: (assignDiag as any).range?.endOffset,
            metadata: { featureName: entry.name, rule: "dimensionalAssignment" },
          });
        }
      } catch {
        // query hook not registered or evaluation error
      }

      // Check constraint dimensional lint
      if (
        entry.ruleName === "AssertConstraintUsage" ||
        entry.ruleName === "ConstraintUsage" ||
        entry.ruleName === "ConstraintDefinition"
      ) {
        try {
          const constrDiag = (qe as any).fetch("lint__dimensionalConstraint", entry.id);
          if (constrDiag && (constrDiag as any).message) {
            diagnostics.push({
              gate: 2,
              gateName: "QUDV Physical Dimensions",
              severity: "error",
              message: (constrDiag as any).message,
              startOffset: (constrDiag as any).range?.startOffset,
              endOffset: (constrDiag as any).range?.endOffset,
              metadata: { constraintName: entry.name, rule: "dimensionalConstraint" },
            });
          }
        } catch {
          // ignore
        }
      }

      // Check connection dimensional lint
      if (entry.ruleName === "ConnectionUsage") {
        try {
          const connDiag = (qe as any).fetch("lint__connectionDimensionalConsistency", entry.id);
          if (connDiag && (connDiag as any).message) {
            diagnostics.push({
              gate: 2,
              gateName: "QUDV Physical Dimensions",
              severity: "error",
              message: (connDiag as any).message,
              startOffset: (connDiag as any).range?.startOffset,
              endOffset: (connDiag as any).range?.endOffset,
              metadata: { connectionName: entry.name, rule: "connectionDimensionalConsistency" },
            });
          }
        } catch {
          // ignore
        }
      }

      // Record known resolved type dimensions for metadata
      if (entry.name) {
        const dim = resolveTypeDimension(db, entry.name);
        if (dim && !isDimensionless(dim)) {
          inferredDims[entry.name] = formatDimension(dim);
        }
      }
    }

    return {
      gate: 2,
      gateName: "QUDV Physical Dimensions",
      passed: diagnostics.length === 0,
      diagnostics,
      metadata: {
        checkedFeatures: checkedCount,
        inferredDimensions: inferredDims,
      },
    };
  } else if (norm === "modelica") {
    // 1. Check unit bracket additions: e.g. 5[m] + 10[s]
    const unitMatches = code.matchAll(/\b([a-zA-Z0-9_]+)\s*=\s*([^;\s\r\n]+(?:\s+[^;\s\r\n]+)*);/g);
    for (const match of unitMatches) {
      const expr = match[2]!.trim();
      // Check for obvious incompatible addition of different unit markers if present
      if (/\b(kg|m|s|N|Pa|W|J|V|A|Ohm|F|H)\b/.test(expr)) {
        // e.g., 5[m] + 10[s]
        const m = expr.match(/\[([a-zA-Z]+)\][^[+]*\+[^[]*\[([a-zA-Z]+)\]/);
        if (m && m[1] !== m[2]) {
          diagnostics.push({
            gate: 2,
            gateName: "QUDV Physical Dimensions",
            severity: "error",
            message: `Dimensional mismatch in Modelica expression '${expr.trim()}': cannot add unit [${m[1]}] to [${m[2]}].`,
          });
        }
      }
    }

    // 2. Check SI unit type incompatibilities:
    // e.g. Modelica.SIunits.Length len = weight; where weight is Modelica.SIunits.Mass
    const declMatches = code.matchAll(
      /\b(?:Modelica\s*\.\s*SIunits\s*\.\s*)?([A-Z][a-zA-Z0-9_]*)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\([^)]*\))?(?:\s*=\s*([^;\s\r\n]+(?:\s+[^;\s\r\n]+)*))?\s*;/g,
    );
    const varTypes = new Map<string, string>();
    const varAssignments: { varName: string; declaredType: string; rhs: string }[] = [];
    for (const dm of declMatches) {
      const typeName = dm[1]!;
      const varName = dm[2]!;
      const rhs = dm[3];
      varTypes.set(varName, typeName);
      if (rhs) {
        varAssignments.push({ varName, declaredType: typeName, rhs: rhs.trim() });
      }
    }

    const incompatiblePairs: Record<string, string[]> = {
      Length: ["Mass", "Time", "Voltage", "Current", "Pressure", "Temperature", "Power"],
      Mass: ["Length", "Time", "Voltage", "Current", "Pressure", "Temperature", "Power"],
      Time: ["Length", "Mass", "Voltage", "Current", "Pressure", "Temperature", "Power"],
      Voltage: ["Length", "Mass", "Time", "Current", "Pressure", "Temperature"],
      Current: ["Length", "Mass", "Time", "Voltage", "Pressure", "Temperature"],
      Pressure: ["Length", "Mass", "Time", "Voltage", "Current"],
    };

    for (const { varName, declaredType, rhs } of varAssignments) {
      const rhsVar = rhs.replace(/[^a-zA-Z0-9_.]/g, "");
      const rhsType = varTypes.get(rhsVar);
      if (rhsType && incompatiblePairs[declaredType]?.includes(rhsType)) {
        diagnostics.push({
          gate: 2,
          gateName: "QUDV Physical Dimensions",
          severity: "error",
          message: `Dimensional mismatch: cannot assign '${rhsVar}' of type ${rhsType} to '${varName}' of type ${declaredType}.`,
          metadata: { featureName: varName, declaredType, rhsType },
        });
      }
    }

    return {
      gate: 2,
      gateName: "QUDV Physical Dimensions",
      passed: diagnostics.length === 0,
      diagnostics,
    };
  }

  return {
    gate: 2,
    gateName: "QUDV Physical Dimensions",
    passed: true,
    diagnostics: [],
  };
}

/**
 * Gate 3: SMT Real Simplex & Requirement Feasibility
 */
export async function verifyGate3Requirements(
  code: string,
  language: ClosedLoopLanguage,
  tree?: any,
  documentUri = "file:///candidate/model.sysml",
): Promise<GateVerificationResult> {
  const diagnostics: GateDiagnostic[] = [];
  const norm = language.toLowerCase();

  if (norm === "sysml2" || norm === "sysml") {
    let constraints: ExtractedConstraint[] = [];

    if (tree) {
      const ws = createSysML2WorkspaceIndex();
      loadEmbeddedKerMLStdlib(ws);
      ws.register(documentUri, () => tree.rootNode);
      const unified = ws.toUnified();
      const qe = createSysML2QueryEngine(unified, tree);
      const db = qe.toQueryDB();
      constraints = extractSysML2Constraints(db) || [];
    }

    // Also parse explicit inline constraints from code if queryDB didn't extract any
    if (constraints.length === 0) {
      const constraintMatches = code.matchAll(/(?:\bassert\s+)?\bconstraint(?:\s+([a-zA-Z0-9_]+))?\s*\{([^}]+)\}/g);
      for (const m of constraintMatches) {
        const body = m[2]!.trim();
        const compMatch = body.match(
          /\b([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*(<=|>=|==|<|>)\s*([0-9]+(?:\.[0-9]+)?)/,
        );
        if (compMatch) {
          constraints.push({
            lhs: compMatch[1]!,
            operator: compMatch[2] as any,
            rhs: parseFloat(compMatch[3]!),
            expression: body,
            source: "sysml2",
            requirementName: m[1] || "inlineConstraint",
          });
        }
      }
    }

    // Inline requirement bounds: doc /* ... */ or attribute bounds
    const reqMatches = code.matchAll(
      /\brequirement\s+(?:def\s+)?([a-zA-Z0-9_]+)\s*\{[^{}]*?\battribute\s+([a-zA-Z0-9_]+)(?:\s*:\s*[a-zA-Z0-9_.]+)?\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*;[^{}]*?\}/g,
    );
    for (const rm of reqMatches) {
      const reqName = rm[1];
      const attrName = rm[2]!;
      const val = parseFloat(rm[3]!);
      // If code specifies requirement limit
      constraints.push({
        lhs: attrName,
        operator: "<=",
        rhs: val,
        expression: `${attrName} <= ${val}`,
        source: "sysml2",
        requirementName: reqName,
      });
    }

    if (constraints.length === 0) {
      return {
        gate: 3,
        gateName: "SMT Requirement Feasibility",
        passed: true,
        diagnostics: [],
        metadata: { isConsistent: true, numConstraints: 0 },
      };
    }

    const checkResult: SMTRequirementCheckResult = verifyConstraintSet(constraints);

    if (!checkResult.isConsistent) {
      for (const violated of checkResult.violatedConstraints) {
        diagnostics.push({
          gate: 3,
          gateName: "SMT Requirement Feasibility",
          severity: "error",
          message: `SMT Requirement Conflict in '${violated.requirementName ?? "system constraint"}': ${violated.reason} (Expression: '${violated.expression}').`,
          metadata: {
            requirementName: violated.requirementName,
            expression: violated.expression,
          },
        });
      }

      return {
        gate: 3,
        gateName: "SMT Requirement Feasibility",
        passed: false,
        diagnostics,
        metadata: {
          isConsistent: false,
          conflictingRequirements: checkResult.conflictingRequirements,
          unsatCore: checkResult.conflictingRequirements,
        },
      };
    }

    return {
      gate: 3,
      gateName: "SMT Requirement Feasibility",
      passed: true,
      diagnostics: [],
      metadata: {
        isConsistent: true,
        numConstraints: constraints.length,
      },
    };
  } else if (norm === "modelica") {
    // Modelica parameter and assertion consistency
    const boundVars = new Map<string, number>();
    const clean = stripComments(code);
    const paramRegex =
      /\b(?:(?:parameter|constant)\s+)?(?!parameter\b|constant\b)[A-Za-z_][A-Za-z0-9_.]*\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\([^()]*\))?\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*;/g;
    for (const pm of clean.matchAll(paramRegex)) {
      const val = Number(pm[2]);
      if (Number.isFinite(val)) {
        boundVars.set(pm[1]!, val);
      }
    }

    const assertMatches = clean.matchAll(/\bassert\s*\(([^,]+),\s*"([^"]+)"(?:\s*,[^)]*)?\)\s*;/g);
    for (const am of assertMatches) {
      const expr = am[1]!.trim();
      const msg = am[2]!;
      const evalResult = evaluateModelicaBooleanExpr(expr, boundVars);
      if (evalResult === false) {
        diagnostics.push({
          gate: 3,
          gateName: "SMT Requirement Feasibility",
          severity: "error",
          message: `Infeasible Modelica assertion '${expr}': ${msg}`,
        });
      }
    }

    return {
      gate: 3,
      gateName: "SMT Requirement Feasibility",
      passed: diagnostics.length === 0,
      diagnostics,
    };
  }

  return {
    gate: 3,
    gateName: "SMT Requirement Feasibility",
    passed: true,
    diagnostics: [],
  };
}

function evaluateModelicaBooleanExpr(expr: string, boundVars: ReadonlyMap<string, number>): boolean | null {
  const trimmed = expr.trim();
  if (trimmed === "false") return false;
  if (trimmed === "true") return true;

  // Handle logical 'and' / 'or' / 'not'
  let jsExpr = trimmed
    .replace(/\band\b/g, "&&")
    .replace(/\bor\b/g, "||")
    .replace(/\bnot\b/g, "!")
    .replace(/<>/g, "!==");

  // Replace single '=' equality if not part of <=, >=, !=, ==
  jsExpr = jsExpr.replace(/(?<![<>!=])=(?!=)/g, "===");

  // Substitute bound variables; if an unknown identifier remains, only evaluate if purely numeric
  const idRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  let hasUnbound = false;
  jsExpr = jsExpr.replace(idRegex, (id) => {
    if (id === "true" || id === "false" || id === "Math") return id;
    if (boundVars.has(id)) return `(${boundVars.get(id)})`;
    hasUnbound = true;
    return id;
  });
  if (hasUnbound) return null;

  try {
    const fn = new Function(`return Boolean(${jsExpr});`) as () => boolean;
    return fn();
  } catch {
    return null;
  }
}

function stripComments(source: string): string {
  let result = "";
  let i = 0;
  const len = source.length;
  while (i < len) {
    const ch = source[i];
    if (ch === '"') {
      result += ch;
      i++;
      while (i < len) {
        const c = source[i];
        result += c;
        if (c === "\\") {
          i++;
          if (i < len) result += source[i];
        } else if (c === '"') {
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (ch === "/" && i + 1 < len) {
      const next = source[i + 1];
      if (next === "/") {
        i += 2;
        while (i < len && source[i] !== "\n" && source[i] !== "\r") {
          i++;
        }
        continue;
      }
      if (next === "*") {
        i += 2;
        while (i + 1 < len && !(source[i] === "*" && source[i + 1] === "/")) {
          i++;
        }
        i += 2;
        continue;
      }
    }
    result += ch;
    i++;
  }
  return result;
}

/**
 * Compute maximum bipartite matching (equation -> variable) and Tarjan SCC BLT blocks.
 */
function analyzeBipartiteAndBLT(
  variables: string[],
  equationStrings: string[],
): { matchedCount: number; bltBlocksCount: number; unmatchedVars: string[] } {
  const nVars = variables.length;
  const nEqs = equationStrings.length;
  const adj: number[][] = Array.from({ length: nEqs }, () => []);

  for (let e = 0; e < nEqs; e++) {
    const eqText = equationStrings[e]!;
    for (let v = 0; v < nVars; v++) {
      const varName = variables[v]!;
      const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\b`).test(eqText)) {
        adj[e]!.push(v);
      }
    }
    // If an equation references no recognized variable directly (e.g. connect), allow fallback edges
    if (adj[e]!.length === 0 && nVars > 0) {
      for (let v = 0; v < nVars; v++) adj[e]!.push(v);
    }
  }

  // Augmenting path bipartite matching
  const matchVarToEq = new Int32Array(nVars).fill(-1);
  const matchEqToVar = new Int32Array(nEqs).fill(-1);

  const dfsAugment = (eqIdx: number, visited: Uint8Array): boolean => {
    for (const vIdx of adj[eqIdx]!) {
      if (visited[vIdx]) continue;
      visited[vIdx] = 1;
      if (matchVarToEq[vIdx] === -1 || dfsAugment(matchVarToEq[vIdx]!, visited)) {
        matchVarToEq[vIdx] = eqIdx;
        matchEqToVar[eqIdx] = vIdx;
        return true;
      }
    }
    return false;
  };

  let matchedCount = 0;
  for (let e = 0; e < nEqs; e++) {
    const visited = new Uint8Array(nVars);
    if (dfsAugment(e, visited)) {
      matchedCount++;
    }
  }

  const unmatchedVars: string[] = [];
  for (let v = 0; v < nVars; v++) {
    if (matchVarToEq[v] === -1) unmatchedVars.push(variables[v]!);
  }

  // Tarjan's Strongly Connected Components (SCC) for BLT decomposition on matched equations
  let index = 0;
  const indices = new Int32Array(nEqs).fill(-1);
  const lowlink = new Int32Array(nEqs).fill(-1);
  const onStack = new Uint8Array(nEqs);
  const stack: number[] = [];
  let sccCount = 0;

  const strongConnect = (e: number) => {
    indices[e] = index;
    lowlink[e] = index;
    index++;
    stack.push(e);
    onStack[e] = 1;

    for (const v of adj[e]!) {
      const targetEq = matchVarToEq[v]!;
      if (targetEq >= 0 && targetEq !== e) {
        if (indices[targetEq] === -1) {
          strongConnect(targetEq);
          lowlink[e] = Math.min(lowlink[e]!, lowlink[targetEq]!);
        } else if (onStack[targetEq]) {
          lowlink[e] = Math.min(lowlink[e]!, indices[targetEq]!);
        }
      }
    }

    if (lowlink[e] === indices[e]) {
      sccCount++;
      while (stack.length > 0) {
        const w = stack.pop()!;
        onStack[w] = 0;
        if (w === e) break;
      }
    }
  };

  for (let e = 0; e < nEqs; e++) {
    if (indices[e] === -1) strongConnect(e);
  }

  return {
    matchedCount,
    bltBlocksCount: sccCount > 0 ? sccCount : nEqs,
    unmatchedVars,
  };
}

/**
 * Gate 4: DAE Arena Structural Balance & BLT Causalization
 */
export async function verifyGate4DAEBalance(
  code: string,
  language: ClosedLoopLanguage,
  _tree?: any,
  _lspContext?: any,
): Promise<GateVerificationResult> {
  const diagnostics: GateDiagnostic[] = [];
  const norm = language.toLowerCase();

  if (norm === "modelica") {
    // Robust Modelica equation & variable structural balance
    const cleanCode = stripComments(code);

    // 1. Separate declarations from equation/algorithm sections
    const eqMatch = cleanCode.match(/\bequation\b([\s\S]*?)(?:\balgorithm\b|\bend\b|$)/);
    const declPart = cleanCode.split(/\bequation\b/)[0] ?? cleanCode;

    // 2. Extract dynamic unknown state variables (exclude parameters, constants, and inputs)
    const declStatements = declPart
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const declaredVars = new Set<string>();

    // Walk CST if provided to extract component_clause nodes
    if (_tree?.rootNode) {
      const visitCst = (node: any) => {
        if (node.type === "component_clause") {
          const text = String(node.text ?? "");
          if (!/\b(?:parameter|constant|input)\b/.test(text)) {
            const m = text.match(
              /^\s*(?:(?:public|protected)\s+)?(?:(?:output|discrete)\s+)?(?!public\b|protected\b|output\b|discrete\b)[A-Za-z_][a-zA-Z0-9_.]*\s+([^=;()]+)/,
            );
            if (m?.[1]) {
              for (const rawId of m[1].split(",")) {
                const id = rawId.trim().split(/\s+/)[0];
                if (id && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) declaredVars.add(id);
              }
            }
          }
        }
        if (Array.isArray(node.children)) {
          for (const child of node.children) visitCst(child);
        }
      };
      visitCst(_tree.rootNode);
    }

    for (const stmt of declStatements) {
      if (
        stmt.startsWith("model ") ||
        stmt.startsWith("class ") ||
        stmt.startsWith("package ") ||
        stmt.startsWith("block ") ||
        stmt.startsWith("import ") ||
        stmt.startsWith("extends ") ||
        stmt.startsWith("annotation")
      ) {
        continue;
      }

      // Check variability prefix
      const isParam = /\bparameter\b/.test(stmt);
      const isConst = /\bconstant\b/.test(stmt);
      const isInput = /\binput\b/.test(stmt);
      if (isParam || isConst || isInput) {
        continue;
      }

      // Extract variable name(s): e.g. Real x, y; or Modelica.SIunits.Length len;
      const typeIdentMatch = stmt.match(
        /(?:(?:public|protected)\s+)?(?:(?:output|discrete)\s+)?(?:(?:Modelica\s*\.\s*SIunits\s*\.\s*)?[A-Za-z_][a-zA-Z0-9_.]*)\s+([^=;()]+)/,
      );
      if (typeIdentMatch && typeIdentMatch[1]) {
        const idents = typeIdentMatch[1]
          .split(",")
          .map((id) => id.trim().split(/\s+/)[0])
          .filter((id) => id!.length > 0 && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id!));
        for (const id of idents) {
          declaredVars.add(id!);
        }
      }
    }

    // 3. Extract equations in equation section
    const equationStrings: string[] = [];
    if (eqMatch && eqMatch[1]) {
      const rawEqs = eqMatch[1]
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const eq of rawEqs) {
        if (/\bconnect\s*\(/.test(eq)) {
          equationStrings.push(eq, eq);
        } else if (eq.includes("=") || /\bder\s*\(/.test(eq)) {
          equationStrings.push(eq);
        }
      }
    }

    const eqCount = equationStrings.length;
    const varCount = declaredVars.size;

    if (varCount > 0 || eqCount > 0) {
      if (eqCount !== varCount) {
        const diff = eqCount - varCount;
        diagnostics.push({
          gate: 4,
          gateName: "DAE Structural Balance",
          severity: "error",
          message: `DAE structurally unbalanced: found ${eqCount} equations for ${varCount} dynamic variables (${
            diff > 0 ? `overdetermined by +${diff}` : `underdetermined by ${diff}`
          }).`,
          metadata: { numEquations: eqCount, numVariables: varCount, degreesOfFreedom: varCount - eqCount },
        });

        return {
          gate: 4,
          gateName: "DAE Structural Balance",
          passed: false,
          diagnostics,
          metadata: {
            numEquations: eqCount,
            numVariables: varCount,
            degreesOfFreedom: varCount - eqCount,
            isBalanced: false,
          },
        };
      }
    }

    // Perform bipartite matching & Tarjan SCC BLT block decomposition
    const { matchedCount, bltBlocksCount, unmatchedVars } = analyzeBipartiteAndBLT([...declaredVars], equationStrings);

    if (varCount > 0 && matchedCount < varCount) {
      diagnostics.push({
        gate: 4,
        gateName: "DAE Structural Balance",
        severity: "error",
        message: `DAE structurally singular: ${unmatchedVars.length} variable(s) (${unmatchedVars.join(", ")}) could not be matched to an independent equation.`,
        metadata: {
          numEquations: eqCount,
          numVariables: varCount,
          matchedCount,
          unmatchedVars,
        },
      });
      return {
        gate: 4,
        gateName: "DAE Structural Balance",
        passed: false,
        diagnostics,
        metadata: {
          numEquations: eqCount,
          numVariables: varCount,
          degreesOfFreedom: varCount - matchedCount,
          isBalanced: false,
          bltBlocksCount,
        },
      };
    }

    return {
      gate: 4,
      gateName: "DAE Structural Balance",
      passed: true,
      diagnostics: [],
      metadata: {
        numEquations: eqCount,
        numVariables: varCount,
        degreesOfFreedom: 0,
        isBalanced: true,
        bltBlocksCount,
      },
    };
  } else if (norm === "sysml2" || norm === "sysml") {
    // Check parametric equations in SysML v2
    // Count unknown attributes (not parameter or initialized) vs equality constraints
    const attrMatches = code.matchAll(
      /\battribute\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([a-zA-Z0-9_:]+)(?:\s*=\s*([^;\s\r\n]+(?:\s+[^;\s\r\n]+)*))?\s*;/g,
    );
    const uninitializedAttrs: string[] = [];
    for (const am of attrMatches) {
      const full = am[0];
      if (!full.includes("=")) {
        uninitializedAttrs.push(am[1]!);
      }
    }

    const eqMatches = code.matchAll(/(?:\bassert\s+)?\bconstraint\s*\{([^}=]+=[^}]+)\}/g);
    const equations: string[] = [];
    for (const em of eqMatches) {
      equations.push(em[1]!.trim());
    }

    if (uninitializedAttrs.length > 0 && equations.length > 0) {
      if (uninitializedAttrs.length !== equations.length) {
        const diff = equations.length - uninitializedAttrs.length;
        diagnostics.push({
          gate: 4,
          gateName: "DAE Structural Balance",
          severity: "error",
          message: `SysML v2 parametric constraint system unbalanced: ${equations.length} equations for ${
            uninitializedAttrs.length
          } unknown state variables (${diff > 0 ? "overdetermined" : "underdetermined"}).`,
          metadata: {
            numEquations: equations.length,
            numVariables: uninitializedAttrs.length,
            degreesOfFreedom: uninitializedAttrs.length - equations.length,
          },
        });

        return {
          gate: 4,
          gateName: "DAE Structural Balance",
          passed: false,
          diagnostics,
          metadata: {
            numEquations: equations.length,
            numVariables: uninitializedAttrs.length,
            degreesOfFreedom: uninitializedAttrs.length - equations.length,
            isBalanced: false,
          },
        };
      }
    }

    return {
      gate: 4,
      gateName: "DAE Structural Balance",
      passed: true,
      diagnostics: [],
      metadata: {
        isBalanced: true,
        numEquations: equations.length,
        numVariables: uninitializedAttrs.length,
        status: "Static architecture and parametric constraints structurally balanced",
      },
    };
  }

  return {
    gate: 4,
    gateName: "DAE Structural Balance",
    passed: true,
    diagnostics: [],
    metadata: { isBalanced: true },
  };
}

/**
 * Main Closed-Loop Verification Engine.
 */
export class ClosedLoopCompilerEngine {
  constructor(public readonly lspContext?: any) {}

  /**
   * Runs candidate code through the 4 verification gates.
   * Gate 1 certifies syntax and CST structure; once certified,
   * semantic gates (2: Dimensions, 3: SMT Feasibility, 4: DAE Balance)
   * execute concurrently to return a complete, aggregated diagnostic vector.
   */
  public async verifyCandidate(
    code: string,
    language: ClosedLoopLanguage = "sysml2",
    options?: VerifyCandidateOptions,
  ): Promise<ClosedLoopCandidateVerification> {
    const targetGates = new Set(options?.targetGates ?? [1, 2, 3, 4]);
    const gates: GateVerificationResult[] = [];
    const docUri = options?.documentUri ?? "file:///candidate/model.sysml";

    // --- Gate 1: Syntax (Prerequisite for semantic CST analysis) ---
    let tree: any = null;
    try {
      if (targetGates.has(1)) {
        const g1 = await verifyGate1Syntax(code, language, options?.parser);
        gates.push(g1.result);
        tree = g1.tree;
        if (!g1.result.passed) {
          return {
            allPassed: false,
            gates,
            summary: `Failed at Gate 1 (WASM GLR Syntax) with ${g1.result.diagnostics.length} syntax errors.`,
            timestamp: new Date().toISOString(),
          };
        }
      }

      // --- Gates 2, 3, 4: Semantic Verification Gates (Evaluated Concurrently) ---
      const semanticTasks: Promise<GateVerificationResult>[] = [];
      if (targetGates.has(2)) {
        semanticTasks.push(verifyGate2Dimensions(code, language, tree, docUri));
      }
      if (targetGates.has(3)) {
        semanticTasks.push(verifyGate3Requirements(code, language, tree, docUri));
      }
      if (targetGates.has(4)) {
        semanticTasks.push(verifyGate4DAEBalance(code, language, tree, this.lspContext));
      }

      if (semanticTasks.length > 0) {
        const semanticResults = await Promise.all(semanticTasks);
        for (const res of semanticResults) {
          gates.push(res);
        }
      }

      const failedGates = gates.filter((g) => !g.passed);
      if (failedGates.length > 0) {
        const totalDiags = failedGates.reduce((sum, g) => sum + g.diagnostics.length, 0);
        const gateLabels = failedGates.map((g) => `Gate ${g.gate} (${g.gateName})`).join(", ");
        return {
          allPassed: false,
          gates,
          summary: `Failed at ${gateLabels} with ${totalDiags} total diagnostic${totalDiags === 1 ? "" : "s"}.`,
          timestamp: new Date().toISOString(),
        };
      }

      return {
        allPassed: true,
        gates,
        summary: `All ${gates.length} verification gates certified successfully.`,
        timestamp: new Date().toISOString(),
      };
    } finally {
      tree?.delete?.();
    }
  }
}
