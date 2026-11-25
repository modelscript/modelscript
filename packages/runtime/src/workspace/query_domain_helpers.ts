// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Domain-specific analysis helpers extracted from `WasmQueryEngine`:
 * - Bipartite equation balance & Tarjan algebraic loop detection
 * - Modelica ↔ SysML v2 physical quantity / unit parity verification
 * - CAD solid ↔ FEA mesh geometric shape binding
 */

import type { ParityReport, QueryHooks, ShapeBinding, SymbolEntry, SymbolId, SymbolIndex } from "../runtime.js";

/** Minimal host context required by structural equation / algebraic loop helpers. */
export interface EquationHelperHost {
  index: SymbolIndex;
  resolveEntry(id: SymbolId): SymbolEntry | undefined;
  getCstNode(id: SymbolId): unknown | null;
  hasHook(ruleName: string, queryName: string): boolean;
  query<T = unknown>(queryName: string, id: SymbolId): T;
}

/**
 * Helper that extracts unknown continuous/discrete variables and non-initial equation strings
 * for a class/model `symbolId` (used by `checkEquationBalance` and `checkAlgebraicLoops`).
 */
export function extractSymbolVarsAndEquations(
  host: EquationHelperHost,
  symbolId: SymbolId,
): {
  varNames: Set<string>;
  equations: string[];
} {
  const varNames = new Set<string>();
  const equations: string[] = [];

  // 1. Collect non-parameter, non-constant child variables from symbol table
  const children = host.index.childrenOf.get(symbolId) ?? [];
  for (const cid of children) {
    const centry = host.resolveEntry(cid);
    if (!centry) continue;
    if (
      centry.kind === "Component" ||
      centry.kind === "Variable" ||
      centry.ruleName === "component_declaration" ||
      centry.ruleName === "component_clause"
    ) {
      const queriedVar = host.hasHook(centry.ruleName, "variability") ? host.query("variability", cid) : undefined;
      const variability = String(queriedVar ?? centry.metadata?.["variability"] ?? "").toLowerCase();
      const causality = String(centry.metadata?.["causality"] ?? "").toLowerCase();
      const isParamOrConst =
        variability === "parameter" ||
        variability === "constant" ||
        Boolean(centry.metadata?.["isParameter"]) ||
        Boolean(centry.metadata?.["isConstant"]);
      if (!isParamOrConst && causality !== "input" && centry.name) {
        varNames.add(centry.name);
      }
    }
  }

  // 2. Collect equations from registered query hook if available
  const queriedEqs = host.query("equations", symbolId);
  if (Array.isArray(queriedEqs) && queriedEqs.length > 0) {
    for (const eq of queriedEqs) {
      if (typeof eq === "string") {
        equations.push(eq);
      } else if (eq && typeof eq === "object" && typeof (eq as { text?: unknown }).text === "string") {
        equations.push((eq as { text: string }).text);
      } else {
        equations.push(String(eq));
      }
    }
  }

  // 3. Otherwise inspect CST nodes or structured equation sections
  interface CstLikeNode {
    type?: unknown;
    kind?: unknown;
    ruleName?: unknown;
    text?: unknown;
    namedChildren?: unknown;
    children?: unknown;
  }
  const cst = host.getCstNode(symbolId) as CstLikeNode | null;
  if (equations.length === 0 && cst) {
    const eqNodeKinds = new Set([
      "equation",
      "simple_equation",
      "connect_clause",
      "if_equation",
      "for_equation",
      "when_equation",
      "Equation",
      "Constraint",
    ]);
    const visitNode = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as CstLikeNode;
      const kind = String(n.type ?? n.kind ?? n.ruleName ?? "");
      if (kind === "initial_equation_section" || kind === "annotation" || kind === "comment") {
        return;
      }
      if (eqNodeKinds.has(kind)) {
        if (typeof n.text === "string" && n.text.trim().length > 0) {
          equations.push(n.text.trim());
        } else {
          equations.push(kind);
        }
        return;
      }
      const nodeChildren = n.namedChildren ?? n.children;
      if (Array.isArray(nodeChildren)) {
        for (const ch of nodeChildren) visitNode(ch);
      }
    };
    visitNode(cst);

    // Fallback if CST only provides raw source text (e.g. unit-test mock CST)
    if (equations.length === 0 && typeof cst.text === "string" && cst.text.length > 0) {
      const cleanText = cst.text
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/"(?:\\.|[^"\\])*"/g, '""');

      // Also discover component declarations if children were not indexed
      if (varNames.size === 0) {
        const declRegex = /\b(?:(parameter|constant|input)\s+)?(?:Real|Integer|Boolean)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
        let m: RegExpExecArray | null;
        while ((m = declRegex.exec(cleanText)) !== null) {
          const prefix = m[1];
          const name = m[2];
          if (!prefix && name) {
            varNames.add(name);
          }
        }
      }

      // Extract statements inside non-initial `equation` sections, or top-level equations
      const eqSectionRegex =
        /\b(initial\s+)?equation\b([\s\S]*?)(?=\b(?:initial\s+equation|algorithm|initial\s+algorithm|end)\b|$)/g;
      let secMatch: RegExpExecArray | null;
      let foundSection = false;
      while ((secMatch = eqSectionRegex.exec(cleanText)) !== null) {
        if (secMatch[1]) continue;
        foundSection = true;
        const body = secMatch[2] ?? "";
        const stmts = body
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const stmt of stmts) {
          const withoutRelOps = stmt.replace(/<=|>=|==|<>|:=/g, " ");
          if (withoutRelOps.includes("=") || /^connect\s*\(/.test(stmt)) {
            equations.push(stmt);
          }
        }
      }

      if (!foundSection) {
        const stmts = String(cleanText)
          .split(";")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0);
        for (const stmt of stmts) {
          if (/^\b(parameter|constant|model|class|block|connector|record|function|package|end)\b/.test(stmt)) {
            continue;
          }
          const withoutRelOps = stmt.replace(/<=|>=|==|<>|:=/g, " ");
          if (withoutRelOps.includes("=")) {
            // Strip leading type specifier if it is a variable declaration with binding
            if (!/^(?:Real|Integer|Boolean|String)\b/.test(stmt)) {
              equations.push(stmt);
            }
          }
        }
      }
    }
  }

  return { varNames, equations };
}

/**
 * Evaluates bipartite structural equation balancing for a symbol.
 */
export function checkEquationBalanceForSymbol(
  host: EquationHelperHost,
  symbolId: SymbolId,
): {
  isBalanced: boolean;
  varCount: number;
  eqCount: number;
  difference: number;
  status: "balanced" | "under-determined" | "over-determined";
} {
  const entry = host.resolveEntry(symbolId);
  if (!entry) {
    return { isBalanced: true, varCount: 0, eqCount: 0, difference: 0, status: "balanced" };
  }

  const { varNames, equations } = extractSymbolVarsAndEquations(host, symbolId);
  const varCount = varNames.size;
  const eqCount = equations.length;

  const diff = eqCount - varCount;
  return {
    isBalanced: diff === 0,
    varCount,
    eqCount,
    difference: diff,
    status: diff === 0 ? "balanced" : diff < 0 ? "under-determined" : "over-determined",
  };
}

/**
 * Computes strongly connected components (algebraic loops) for equations in a symbol
 * using maximum bipartite matching (DFS augmenting paths) followed by Tarjan's SCC algorithm.
 */
export function checkAlgebraicLoopsForSymbol(
  host: EquationHelperHost,
  symbolId: SymbolId,
): {
  hasLoops: boolean;
  loopCount: number;
  loops: { size: number; vars: string[] }[];
} {
  const entry = host.resolveEntry(symbolId);
  if (!entry) {
    return { hasLoops: false, loopCount: 0, loops: [] };
  }

  const { varNames, equations } = extractSymbolVarsAndEquations(host, symbolId);
  if (varNames.size === 0 || equations.length === 0) {
    return { hasLoops: false, loopCount: 0, loops: [] };
  }

  const vars = Array.from(varNames);
  const varToIdx = new Map<string, number>();
  for (let i = 0; i < vars.length; i++) {
    varToIdx.set(vars[i]!, i);
  }

  // Build equation-to-variable incidence lists (excluding der(x) state occurrences)
  const stripDerCalls = (s: string): string => {
    let result = "";
    let i = 0;
    while (i < s.length) {
      if (s.startsWith("der", i) && (i === 0 || !/[A-Za-z0-9_]/.test(s[i - 1]!))) {
        let j = i + 3;
        while (j < s.length && /\s/.test(s[j]!)) j++;
        if (j < s.length && s[j] === "(") {
          let depth = 1;
          j++;
          while (j < s.length && depth > 0) {
            if (s[j] === "(") depth++;
            else if (s[j] === ")") depth--;
            j++;
          }
          result += " ";
          i = j;
          continue;
        }
      }
      result += s[i];
      i++;
    }
    return result;
  };

  const eqVars: number[][] = [];
  for (const eqText of equations) {
    const strippedDer = stripDerCalls(eqText);
    const idents = strippedDer.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
    const inc = new Set<number>();
    for (const id of idents) {
      const vIdx = varToIdx.get(id);
      if (vIdx !== undefined) inc.add(vIdx);
    }
    eqVars.push(Array.from(inc));
  }

  // Maximum bipartite matching: match each equation e to an unknown variable v
  const numVars = vars.length;
  const numEqs = eqVars.length;
  const varMatch = new Int32Array(numVars).fill(-1); // varIdx -> eqIdx
  const eqMatch = new Int32Array(numEqs).fill(-1); // eqIdx -> varIdx

  const augment = (eqIdx: number, visitedVars: Uint8Array): boolean => {
    const candidates = eqVars[eqIdx]!;
    for (let i = 0; i < candidates.length; i++) {
      const v = candidates[i]!;
      if (visitedVars[v]) continue;
      visitedVars[v] = 1;
      if (varMatch[v] === -1 || augment(varMatch[v]!, visitedVars)) {
        varMatch[v] = eqIdx;
        eqMatch[eqIdx] = v;
        return true;
      }
    }
    return false;
  };

  for (let e = 0; e < numEqs; e++) {
    const visited = new Uint8Array(numVars);
    augment(e, visited);
  }

  // Build directed dependency graph among matched variables:
  // If equation e is matched to variable u, and variable v != u appears in e, add edge u -> v.
  const adj: number[][] = Array.from({ length: numVars }, () => []);
  for (let u = 0; u < numVars; u++) {
    const e = varMatch[u]!;
    if (e < 0) continue;
    for (const v of eqVars[e]!) {
      if (v !== u) {
        adj[u]!.push(v);
      }
    }
  }

  // Tarjan's Strongly Connected Components algorithm
  let index = 0;
  const indices = new Int32Array(numVars).fill(-1);
  const lowlink = new Int32Array(numVars).fill(-1);
  const onStack = new Uint8Array(numVars);
  const stack: number[] = [];
  const loops: { size: number; vars: string[] }[] = [];

  const strongConnect = (v: number): void => {
    indices[v] = index;
    lowlink[v] = index;
    index++;
    stack.push(v);
    onStack[v] = 1;

    for (const w of adj[v]!) {
      if (indices[w] === -1) {
        strongConnect(w);
        if (lowlink[w]! < lowlink[v]!) lowlink[v] = lowlink[w]!;
      } else if (onStack[w]) {
        if (indices[w]! < lowlink[v]!) lowlink[v] = indices[w]!;
      }
    }

    if (lowlink[v] === indices[v]) {
      const scc: string[] = [];
      while (stack.length > 0) {
        const w = stack.pop()!;
        onStack[w] = 0;
        scc.push(vars[w]!);
        if (w === v) break;
      }
      if (scc.length > 1) {
        scc.reverse();
        loops.push({ size: scc.length, vars: scc });
      }
    }
  };

  for (let v = 0; v < numVars; v++) {
    if (indices[v] === -1) {
      strongConnect(v);
    }
  }

  return {
    hasLoops: loops.length > 0,
    loopCount: loops.length,
    loops,
  };
}

/**
 * Verifies dimensional, unit, and type compatibility between a Modelica variable symbol
 * and a SysML v2 attribute symbol, returning a detailed `ParityReport`.
 */
export function computePhysicalQuantityParity(
  mEntry: SymbolEntry | undefined,
  sEntry: SymbolEntry | undefined,
): ParityReport {
  if (!mEntry || !sEntry) {
    return {
      compatible: false,
      reason: `Symbol not found: modelica=${Boolean(mEntry)}, sysml=${Boolean(sEntry)}`,
    };
  }

  const mType = (mEntry.metadata?.["type"] || mEntry.ruleName || "").toString();
  const mUnit = (mEntry.metadata?.["unit"] || "").toString();
  const sType = (sEntry.metadata?.["type"] || sEntry.ruleName || "").toString();
  const sUnit = (sEntry.metadata?.["unit"] || "").toString();

  const normalizeUnit = (u: string) => u.replace(/\*/g, ".").replace(/\s+/g, "").toLowerCase();
  const normMUnit = normalizeUnit(mUnit);
  const normSUnit = normalizeUnit(sUnit);

  const isTorque = (t: string, u: string) =>
    /torque/i.test(t) || u === "n.m" || u === "nm" || u === "n*m" || u === "kg.m2/s2";
  const isMass = (t: string, u: string) => /mass/i.test(t) || u === "kg" || u === "g";
  const isVoltage = (t: string, u: string) => /voltage|potential/i.test(t) || u === "v";
  const isLength = (t: string, u: string) => /length|distance|radius|diameter/i.test(t) || u === "m" || u === "mm";

  let compatible = false;
  let reason: string | undefined;

  if (normMUnit && normSUnit && normMUnit === normSUnit) {
    compatible = true;
  } else if (isTorque(mType, normMUnit) && isTorque(sType, normSUnit)) {
    compatible = true;
  } else if (isMass(mType, normMUnit) && isMass(sType, normSUnit)) {
    compatible = true;
  } else if (isVoltage(mType, normMUnit) && isVoltage(sType, normSUnit)) {
    compatible = true;
  } else if (isLength(mType, normMUnit) && isLength(sType, normSUnit)) {
    compatible = true;
  } else if (!mUnit && !sUnit) {
    const isReal = (t: string) => /real|float|double/i.test(t);
    const isInt = (t: string) => /int/i.test(t);
    const isBool = (t: string) => /bool/i.test(t);
    const isStr = (t: string) => /string/i.test(t);

    if (
      (isReal(mType) && isReal(sType)) ||
      (isInt(mType) && isInt(sType)) ||
      (isBool(mType) && isBool(sType)) ||
      (isStr(mType) && isStr(sType))
    ) {
      compatible = true;
    } else {
      compatible = false;
      reason = `Type mismatch between Modelica '${mType}' and SysML '${sType}'`;
    }
  } else {
    compatible = false;
    reason = `Unit mismatch: Modelica '${mUnit || mType}' vs SysML '${sUnit || sType}'`;
  }

  return {
    compatible,
    modelicaType: mType,
    modelicaUnit: mUnit,
    sysmlType: sType,
    sysmlUnit: sUnit,
    reason,
  };
}

/**
 * Computes the geometric shape and mesh binding summary between a CAD solid symbol
 * and an FEA mesh symbol (`surfaceArea`, `volume`, `meshElementCount`).
 */
export function computeGeometricShapeBinding(
  cadSymbolId: SymbolId,
  feaMeshId: SymbolId,
  cadEntry: SymbolEntry | undefined,
  feaEntry: SymbolEntry | undefined,
): ShapeBinding {
  const bound = Boolean(cadEntry && feaEntry);
  const cadMeta = cadEntry?.metadata || {};
  const feaMeta = feaEntry?.metadata || {};

  const asNum = (v: unknown): number | undefined =>
    typeof v === "number" ? v : typeof v === "string" && !isNaN(Number(v)) ? Number(v) : undefined;

  return {
    bound,
    cadSymbolId,
    feaMeshId,
    shapeName: cadEntry?.name ?? undefined,
    surfaceArea: asNum(cadMeta["surfaceArea"] ?? cadMeta["area"]),
    volume: asNum(cadMeta["volume"]),
    meshElementCount: asNum(feaMeta["elementCount"] ?? feaMeta["meshElementCount"] ?? feaMeta["nodeCount"]),
  };
}

/** Unused type import anchor to keep QueryHooks available for callers extending host helpers. */
export type _DomainHelperHooksRef = QueryHooks;
