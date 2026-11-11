// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  BltBlock,
  BltBlockTearing,
  BltDiagnostics,
  BltEquation,
  BltModelAnalysis,
  BltVariable,
  DependencyKind,
} from "./blt-types.js";
import { scanModelicaStructure } from "./modelica-scanner.js";

const NONLINEAR_FUNCTIONS = new Set([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "exp",
  "log",
  "log10",
  "sqrt",
  "pow",
  "abs",
  "sign",
  "semiLinear",
  "smooth",
]);

const EXPR_KEYWORDS = new Set([
  "if",
  "then",
  "elseif",
  "else",
  "and",
  "or",
  "not",
  "true",
  "false",
  "time",
  "for",
  "in",
  "der",
  "pre",
  "edge",
  "change",
  "initial",
  "terminal",
  "noEvent",
  "sample",
  "reinit",
  "div",
  "mod",
  "rem",
  "ceil",
  "floor",
  "integer",
  "min",
  "max",
  "sum",
  "product",
  "size",
  "ndims",
  "zeros",
  "ones",
  "fill",
  "identity",
  "diagonal",
  "transpose",
  "symmetric",
  "cross",
  "skew",
  "outerProduct",
  "scalar",
  "vector",
  "matrix",
  "homotopy",
]);

interface TokenizedOccurrence {
  name: string;
  isDerivative: boolean;
  baseStateName?: string | undefined;
  inNonlinearContext: boolean;
  termGroupId: number;
}

interface TokenizedEquation {
  occurrences: TokenizedOccurrence[];
  lhsPrimaryTarget: string | null;
}

export interface AnalyzeBltOptions {
  sourceKind?: "flattened" | "source" | undefined;
  localLineMap?: Map<string, number> | undefined;
}

/**
 * Parses Modelica / acausal DAE source code (or compiler-flattened DAE) into a clean
 * equation-variable incidence graph in O(N) token time, then executes Hopcroft-Karp
 * O(E * sqrt(V)) maximum bipartite matching, Tarjan's Strongly Connected Components (SCC),
 * and greedy feedback-vertex cycle tearing to decompose the system into canonical BLT form.
 */
export function analyzeModelBlt(
  code: string,
  _lines: string[],
  className?: string,
  options?: AnalyzeBltOptions,
): BltModelAnalysis {
  const structure = scanModelicaStructure(code, className);
  const modelName = className || structure.className || "Model";
  const lineLookup = options?.localLineMap;

  const resolveEditorLine = (symbolName: string, fallbackLine: number): number => {
    if (!lineLookup || lineLookup.size === 0) return fallbackLine;
    const exact = lineLookup.get(symbolName);
    if (exact !== undefined) return exact;
    const root = symbolName.split(/[.[]/)[0]!;
    return lineLookup.get(root) ?? fallbackLine;
  };

  // 1. Pre-scan scalar/differential equations (excluding unexpanded `connect(...)` macros)
  const rawScannedEqs = structure.equations.filter((eq) => eq.kind !== "connect");
  const tokenizedEqs: TokenizedEquation[] = [];
  const stateDerivativeNames = new Set<string>();
  const referencedIdentifiers = new Set<string>();

  for (const eq of rawScannedEqs) {
    const iterSet = new Set(eq.loopIterators);
    const tok = tokenizeEquationExpression(eq.text, eq.lhs, iterSet);
    tokenizedEqs.push(tok);
    for (const occ of tok.occurrences) {
      if (occ.isDerivative && occ.baseStateName) {
        stateDerivativeNames.add(occ.baseStateName);
      } else {
        referencedIdentifiers.add(occ.name);
      }
    }
  }

  // 2. Collect parameters, integrated state variables, and unknown variables (deduplicated)
  let parameterCount = 0;
  const seenDeclNames = new Set<string>();
  const stateVariables: BltVariable[] = [];
  const variables: BltVariable[] = [];
  const varNameToIndex = new Map<string, number>();

  let varId = 0;
  let stateId = 0;

  const registerUnknownVariable = (
    name: string,
    variability: BltVariable["variability"],
    typeName: string,
    line: number,
    isDerivative: boolean,
    baseStateName?: string,
  ) => {
    if (varNameToIndex.has(name)) return;
    varNameToIndex.set(name, varId);
    variables.push({
      id: varId++,
      name,
      variability,
      typeName,
      line: resolveEditorLine(baseStateName ?? name, line),
      isDerivative,
      ...(baseStateName !== undefined ? { baseStateName } : {}),
    });
  };

  for (const decl of structure.declarations) {
    if (seenDeclNames.has(decl.name)) continue;
    seenDeclNames.add(decl.name);

    if (decl.variability === "parameter" || decl.variability === "constant") {
      parameterCount++;
      continue;
    }

    // Top-level external `input` signals without binding equations are known exogenous inputs
    if (decl.variability === "input" && !decl.bindingExpr) {
      continue;
    }

    // Expand small 1D constant-size arrays `Real x[N]` when scalar elements `x[1]`...`x[N]` are referenced in equations
    if (decl.isScalarType && decl.arrayDims.length === 1 && decl.arrayDims[0]! >= 1 && decl.arrayDims[0]! <= 64) {
      const dim = decl.arrayDims[0]!;
      let hasIndexedRef = false;
      for (let k = 1; k <= dim; k++) {
        const elemName = `${decl.name}[${k}]`;
        if (referencedIdentifiers.has(elemName) || stateDerivativeNames.has(elemName)) {
          hasIndexedRef = true;
          break;
        }
      }
      if (hasIndexedRef) {
        for (let k = 1; k <= dim; k++) {
          const elemName = `${decl.name}[${k}]`;
          if (stateDerivativeNames.has(elemName)) {
            stateVariables.push({
              id: stateId++,
              name: elemName,
              variability: decl.variability,
              typeName: decl.typeName,
              line: resolveEditorLine(decl.name, decl.line),
              isDerivative: false,
            });
            registerUnknownVariable(`der(${elemName})`, "continuous", "Real", decl.line, true, elemName);
          } else {
            registerUnknownVariable(elemName, decl.variability, decl.typeName, decl.line, false);
          }
        }
        continue;
      }
    }

    // Only include scalar declarations OR custom-typed variables directly referenced in scalar equations
    // (prevents composite subcomponent blocks like `Sine sin1(f=5)` from polluting unknown variables)
    const isReferencedDirectly = referencedIdentifiers.has(decl.name) || stateDerivativeNames.has(decl.name);
    if (!decl.isScalarType && !isReferencedDirectly) {
      continue;
    }

    if (stateDerivativeNames.has(decl.name)) {
      // Differentiated continuous state x(t): integrated by ODE solver; der(x) is the BLT unknown!
      stateVariables.push({
        id: stateId++,
        name: decl.name,
        variability: decl.variability,
        typeName: decl.typeName,
        line: resolveEditorLine(decl.name, decl.line),
        isDerivative: false,
      });
      registerUnknownVariable(`der(${decl.name})`, "continuous", "Real", decl.line, true, decl.name);
    } else {
      registerUnknownVariable(decl.name, decl.variability, decl.typeName, decl.line, false);
    }
  }

  // Ensure any `der(x)` from inherited base classes without local declaration is also registered
  for (const stateName of stateDerivativeNames) {
    const derName = `der(${stateName})`;
    if (!varNameToIndex.has(derName)) {
      stateVariables.push({
        id: stateId++,
        name: stateName,
        variability: "continuous",
        typeName: "Real",
        line: resolveEditorLine(stateName, 1),
        isDerivative: false,
      });
      registerUnknownVariable(derName, "continuous", "Real", 1, true, stateName);
    }
  }

  // 3. Build Equations & O(tokens) Sparse Incidence Matrix
  const equations: BltEquation[] = [];
  const incidence: Record<string, DependencyKind> = {};
  const eqDeps: number[][] = [];
  const eqLhsPreferredVar: number[] = [];

  for (let eIdx = 0; eIdx < rawScannedEqs.length; eIdx++) {
    const rawEq = rawScannedEqs[eIdx]!;
    const tokEq = tokenizedEqs[eIdx]!;

    // Count unknown variables per multiplicative term group to detect `u * v` bilinear nonlinearity
    const unknownsByTermGroup = new Map<number, Set<number>>();
    for (const occ of tokEq.occurrences) {
      const vId = varNameToIndex.get(occ.name);
      if (vId !== undefined) {
        let gSet = unknownsByTermGroup.get(occ.termGroupId);
        if (!gSet) {
          gSet = new Set<number>();
          unknownsByTermGroup.set(occ.termGroupId, gSet);
        }
        gSet.add(vId);
      }
    }

    const depMap = new Map<number, DependencyKind>();
    for (const occ of tokEq.occurrences) {
      const vId = varNameToIndex.get(occ.name);
      if (vId === undefined) continue;

      const multipliedWithOtherUnknown = (unknownsByTermGroup.get(occ.termGroupId)?.size ?? 0) > 1;
      let kind: DependencyKind = "linear";
      if (occ.isDerivative || variables[vId]!.isDerivative) {
        kind = "derivative";
      } else if (occ.inNonlinearContext || multipliedWithOtherUnknown) {
        kind = "nonlinear";
      }

      const prev = depMap.get(vId);
      if (!prev || (prev === "linear" && kind !== "linear")) {
        depMap.set(vId, kind);
      }
    }

    const deps = Array.from(depMap.keys());
    const referencedVars = deps.map((vId) => variables[vId]!.name);

    // Resolve editor line: if flattened equation has no local line match, map via LHS/first referenced var
    let resolvedEqLine = rawEq.line;
    if (lineLookup && lineLookup.size > 0) {
      const probe = tokEq.lhsPrimaryTarget ?? referencedVars[0];
      if (probe) {
        resolvedEqLine = resolveEditorLine(probe.replace(/^der\((.*)\)$/, "$1"), rawEq.line);
      }
    }

    const eqId = equations.length;
    for (const [vId, kind] of depMap.entries()) {
      incidence[`${eqId}:${vId}`] = kind;
    }

    equations.push({
      id: eqId,
      text: rawEq.text,
      lhs: rawEq.lhs,
      rhs: rawEq.rhs,
      line: resolvedEqLine,
      kind: rawEq.kind,
      referencedVars,
    });
    eqDeps.push(deps);

    const prefV = tokEq.lhsPrimaryTarget ? (varNameToIndex.get(tokEq.lhsPrimaryTarget) ?? -1) : -1;
    eqLhsPreferredVar.push(prefV);
  }

  // 4. Hopcroft-Karp O(E * sqrt(V)) Maximum Bipartite Matching
  const numEqs = equations.length;
  const numVars = variables.length;

  const { matchEqToVar, matchVarToEq } = hopcroftKarpMatching(numEqs, numVars, eqDeps, eqLhsPreferredVar);

  // Preserve base dependency kinds before marking matched pivots (for accurate nonlinear loop classification)
  const rawIncidence: Record<string, DependencyKind> = { ...incidence };
  for (let e = 0; e < numEqs; e++) {
    const matchedV = matchEqToVar[e]!;
    if (matchedV !== -1) {
      incidence[`${e}:${matchedV}`] = "matched";
    }
  }

  // 5. Tarjan's Strongly Connected Components (SCC) on Matched Variable Dependency Graph
  // For each matched variable v (solved by equation e = matchVarToEq[v]),
  // every other matched variable u in eqDeps[e] must be evaluated before v (directed edge u -> v).
  const varAdj: number[][] = Array.from({ length: numVars }, () => []);
  const isVarMatched = new Uint8Array(numVars);

  for (let v = 0; v < numVars; v++) {
    const eq = matchVarToEq[v]!;
    if (eq !== -1) {
      isVarMatched[v] = 1;
      for (const u of eqDeps[eq]!) {
        if (u !== v && matchVarToEq[u] !== -1) {
          varAdj[u]!.push(v);
        }
      }
    }
  }

  let tarjanIndex = 0;
  const indices = new Int32Array(numVars).fill(-1);
  const lowlink = new Int32Array(numVars).fill(-1);
  const onStack = new Uint8Array(numVars);
  const stack: number[] = [];
  const sccs: number[][] = [];

  // Iterative Tarjan SCC to prevent call-stack overflow on deep 5,000+ equation DAE chains
  const callNode: number[] = [];
  const callEdgeIdx: number[] = [];

  for (let startV = 0; startV < numVars; startV++) {
    if (!isVarMatched[startV] || indices[startV] !== -1) continue;

    callNode.push(startV);
    callEdgeIdx.push(0);
    indices[startV] = tarjanIndex;
    lowlink[startV] = tarjanIndex;
    tarjanIndex++;
    stack.push(startV);
    onStack[startV] = 1;

    while (callNode.length > 0) {
      const top = callNode.length - 1;
      const u = callNode[top]!;
      const adj = varAdj[u]!;
      const ei = callEdgeIdx[top]!;

      if (ei < adj.length) {
        callEdgeIdx[top] = ei + 1;
        const w = adj[ei]!;
        if (indices[w] === -1) {
          indices[w] = tarjanIndex;
          lowlink[w] = tarjanIndex;
          tarjanIndex++;
          stack.push(w);
          onStack[w] = 1;
          callNode.push(w);
          callEdgeIdx.push(0);
        } else if (onStack[w]) {
          if (indices[w]! < lowlink[u]!) lowlink[u] = indices[w]!;
        }
      } else {
        callNode.pop();
        callEdgeIdx.pop();
        if (callNode.length > 0) {
          const parent = callNode[callNode.length - 1]!;
          if (lowlink[u]! < lowlink[parent]!) lowlink[parent] = lowlink[u]!;
        }
        if (lowlink[u] === indices[u]) {
          const scc: number[] = [];
          let w = -1;
          while (w !== u) {
            w = stack.pop()!;
            onStack[w] = 0;
            scc.push(w);
          }
          sccs.push(scc);
        }
      }
    }
  }

  // Reverse Tarjan postorder yields canonical forward causal BLT evaluation order
  sccs.reverse();

  // 6. Assemble BLT Blocks & Compute Cycle-Breaking Tearing on Algebraic Loops
  const blocks: BltBlock[] = [];
  const permutedEqOrder: number[] = [];
  const permutedVarOrder: number[] = [];
  const eqToBlock = new Array<number>(numEqs).fill(-1);
  const varToBlock = new Array<number>(numVars).fill(-1);

  let loopCount = 0;
  let maxLoopSize = 0;
  let odeCount = 0;
  let analyticCount = 0;

  for (let b = 0; b < sccs.length; b++) {
    const sccVars = sccs[b]!;
    const sccEqs = sccVars.map((v) => matchVarToEq[v]!);
    const size = sccVars.length;
    const isLoop = size > 1;

    if (isLoop) {
      loopCount++;
      if (size > maxLoopSize) maxLoopSize = size;
    }

    let tearing: BltBlockTearing | undefined;
    let orderedVars = sccVars;
    let orderedEqs = sccEqs;

    if (isLoop) {
      const tornResult = computeLoopTearing(sccVars, sccEqs, equations, variables, eqDeps, rawIncidence);
      tearing = tornResult.tearing;
      orderedVars = tornResult.orderedVars;
      orderedEqs = tornResult.orderedEqs;
    }

    const blockEquations = orderedEqs.map((eIdx) => equations[eIdx]!);
    const blockVariables = orderedVars.map((vIdx) => variables[vIdx]!);

    let blockType: BltBlock["blockType"] = "analytic";
    if (isLoop) {
      const hasNonlinear = orderedEqs.some((eIdx) =>
        orderedVars.some((vIdx) => rawIncidence[`${eIdx}:${vIdx}`] === "nonlinear"),
      );
      blockType = hasNonlinear ? "nonlinear" : "linear";
    } else {
      if (blockVariables[0]?.isDerivative || blockEquations[0]?.kind === "ODE") {
        blockType = "ode";
        odeCount++;
      } else {
        blockType = "analytic";
        analyticCount++;
      }
    }

    blocks.push({
      index: b,
      size,
      isLoop,
      blockType,
      equations: blockEquations,
      variables: blockVariables,
      tearing,
    });

    for (const e of orderedEqs) {
      eqToBlock[e] = b;
      permutedEqOrder.push(e);
    }
    for (const v of orderedVars) {
      varToBlock[v] = b;
      permutedVarOrder.push(v);
    }
  }

  // Append any unmatched equations/variables at the end of permuted order
  const unmatchedEqs: number[] = [];
  for (let e = 0; e < numEqs; e++) {
    if (matchEqToVar[e] === -1) {
      unmatchedEqs.push(e);
      permutedEqOrder.push(e);
    }
  }

  const unmatchedVars: number[] = [];
  for (let v = 0; v < numVars; v++) {
    if (matchVarToEq[v] === -1) {
      unmatchedVars.push(v);
      permutedVarOrder.push(v);
    }
  }

  // 7. Compute Block Dependency DAG Edges & Topological Parallel Execution Wave-Fronts
  const dagEdges: BltModelAnalysis["dagEdges"] = [];
  const edgeSet = new Set<string>();
  const blockPreds: number[][] = Array.from({ length: blocks.length }, () => []);

  for (let b = 0; b < blocks.length; b++) {
    const targetBlock = blocks[b]!;
    for (const eq of targetBlock.equations) {
      for (const vId of eqDeps[eq.id]!) {
        const srcBlock = varToBlock[vId]!;
        if (srcBlock !== -1 && srcBlock !== b) {
          const vName = variables[vId]!.name;
          const edgeKey = `${srcBlock}->${b}:${vName}`;
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            dagEdges.push({
              fromBlock: srcBlock,
              toBlock: b,
              sharedVar: vName,
            });
            blockPreds[b]!.push(srcBlock);
          }
        }
      }
    }
  }

  // Since `blocks` is already in topological order (`srcBlock < b` for all DAG edges),
  // compute parallel depth wave-fronts in a single linear pass!
  const blockDepth = new Int32Array(blocks.length);
  let maxDepth = -1;
  for (let b = 0; b < blocks.length; b++) {
    let d = 0;
    for (const pred of blockPreds[b]!) {
      if (pred < b && blockDepth[pred]! + 1 > d) {
        d = blockDepth[pred]! + 1;
      }
    }
    blockDepth[b] = d;
    if (d > maxDepth) maxDepth = d;
  }

  const dagLevels: number[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (let b = 0; b < blocks.length; b++) {
    dagLevels[blockDepth[b]!]!.push(b);
  }

  // 8. Compute Diagnostics & Solvability Balance
  const dof = numVars - numEqs;
  const isBalanced = numEqs > 0 && numEqs === numVars && unmatchedEqs.length === 0 && unmatchedVars.length === 0;

  let status: BltDiagnostics["status"] = "balanced";
  if (numEqs === 0 && numVars === 0) {
    status = "balanced";
  } else if (dof > 0) {
    status = "under-determined";
  } else if (dof < 0) {
    status = "over-determined";
  } else if (unmatchedEqs.length > 0 || unmatchedVars.length > 0) {
    status = "singular";
  }

  const diagnostics: BltDiagnostics = {
    equationCount: numEqs,
    unknownCount: numVars,
    stateCount: stateVariables.length,
    parameterCount,
    degreesOfFreedom: dof,
    isBalanced,
    status,
    loopCount,
    maxLoopSize,
    odeCount,
    analyticCount,
    unmatchedEqs,
    unmatchedVars,
  };

  return {
    className: modelName,
    sourceKind: options?.sourceKind ?? "source",
    equations,
    variables,
    stateVariables,
    blocks,
    incidence,
    matchedEqToVar: matchEqToVar,
    matchedVarToEq: matchVarToEq,
    eqToBlock,
    varToBlock,
    permutedEqOrder,
    permutedVarOrder,
    diagnostics,
    dagEdges,
    dagLevels,
  };
}

/**
 * Hopcroft-Karp O(E * sqrt(V)) maximum cardinality bipartite matching with
 * greedy LHS causal pivot seeding.
 */
function hopcroftKarpMatching(
  numEqs: number,
  numVars: number,
  eqDeps: number[][],
  eqLhsPreferredVar: number[],
): { matchEqToVar: number[]; matchVarToEq: number[] } {
  const matchEqToVar = new Array<number>(numEqs).fill(-1);
  const matchVarToEq = new Array<number>(numVars).fill(-1);

  if (numEqs === 0 || numVars === 0) {
    return { matchEqToVar, matchVarToEq };
  }

  // Pass 1: Seed natural LHS causal pivots (`der(x) = ...` -> `der(x)`, `y = ...` -> `y`)
  for (let e = 0; e < numEqs; e++) {
    const pref = eqLhsPreferredVar[e]!;
    if (pref !== -1 && matchVarToEq[pref] === -1 && eqDeps[e]!.includes(pref)) {
      matchEqToVar[e] = pref;
      matchVarToEq[pref] = e;
    }
  }

  // Pass 2: Seed remaining single-degree / greedy matches
  for (let e = 0; e < numEqs; e++) {
    if (matchEqToVar[e] !== -1) continue;
    for (const v of eqDeps[e]!) {
      if (matchVarToEq[v] === -1) {
        matchEqToVar[e] = v;
        matchVarToEq[v] = e;
        break;
      }
    }
  }

  // Pass 3: Hopcroft-Karp BFS shortest augmenting path layers + DFS augmentation
  const dist = new Int32Array(numEqs);
  const queue = new Int32Array(numEqs);
  const nextEdgeIdx = new Int32Array(numEqs);
  const INF = 0x3fffffff;

  const bfs = (): boolean => {
    let qHead = 0;
    let qTail = 0;
    let shortestAugLen = INF;

    for (let e = 0; e < numEqs; e++) {
      if (matchEqToVar[e] === -1) {
        dist[e] = 0;
        queue[qTail++] = e;
      } else {
        dist[e] = INF;
      }
    }

    while (qHead < qTail) {
      const u = queue[qHead++]!;
      const du = dist[u]!;
      if (du >= shortestAugLen) continue;

      for (const v of eqDeps[u]!) {
        const nextEq = matchVarToEq[v]!;
        if (nextEq === -1) {
          if (du + 1 < shortestAugLen) shortestAugLen = du + 1;
        } else if (dist[nextEq] === INF) {
          dist[nextEq] = du + 1;
          queue[qTail++] = nextEq;
        }
      }
    }

    return shortestAugLen !== INF;
  };

  const dfs = (u: number): boolean => {
    const deps = eqDeps[u]!;
    while (nextEdgeIdx[u]! < deps.length) {
      const v = deps[nextEdgeIdx[u]!]!;
      nextEdgeIdx[u]!++;
      const nextEq = matchVarToEq[v]!;
      if (nextEq === -1 || (dist[nextEq] === dist[u]! + 1 && dfs(nextEq))) {
        matchEqToVar[u] = v;
        matchVarToEq[v] = u;
        return true;
      }
    }
    dist[u] = INF;
    return false;
  };

  while (bfs()) {
    nextEdgeIdx.fill(0);
    for (let e = 0; e < numEqs; e++) {
      if (matchEqToVar[e] === -1) {
        dfs(e);
      }
    }
  }

  return { matchEqToVar, matchVarToEq };
}

/**
 * Greedy Feedback Vertex Set tearing for coupled algebraic loop SCCs (Cellier & Elmqvist).
 * Selects a minimal set of tearing (iteration) variables whose assumption renders the
 * remaining `(size - k)` inner equations strictly acyclic (DAG) in topological order.
 */
function computeLoopTearing(
  sccVars: number[],
  sccEqs: number[],
  equations: BltEquation[],
  variables: BltVariable[],
  eqDeps: number[][],
  rawIncidence: Record<string, DependencyKind>,
): {
  tearing: BltBlockTearing;
  orderedVars: number[];
  orderedEqs: number[];
} {
  const n = sccVars.length;
  const localIndexByVar = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    localIndexByVar.set(sccVars[i]!, i);
  }

  // Local dependency graph: edge `i -> j` means var `i` is needed to evaluate var `j` (via eq `sccEqs[j]`)
  const outNeighbors: number[][] = Array.from({ length: n }, () => []);
  const inNeighbors: number[][] = Array.from({ length: n }, () => []);
  const nonlinearScore = new Int32Array(n);

  for (let j = 0; j < n; j++) {
    const eqId = sccEqs[j]!;
    const pivotVar = sccVars[j]!;
    // If pivot occurs nonlinearly in its own matched equation, strongly prefer tearing it
    if (rawIncidence[`${eqId}:${pivotVar}`] === "nonlinear") {
      nonlinearScore[j]! += 3;
    }
    for (const depVar of eqDeps[eqId]!) {
      const i = localIndexByVar.get(depVar);
      if (i !== undefined && i !== j) {
        outNeighbors[i]!.push(j);
        inNeighbors[j]!.push(i);
        if (rawIncidence[`${eqId}:${depVar}`] === "nonlinear") {
          nonlinearScore[i]! += 2;
        }
      }
    }
  }

  const isTorn = new Uint8Array(n);
  const tornLocalIndices: number[] = [];

  // Check if active (non-torn) subgraph is a DAG via Kahn's topological sort
  const tryTopoSortActive = (): number[] | null => {
    const inDeg = new Int32Array(n);
    let activeCount = 0;
    for (let i = 0; i < n; i++) {
      if (isTorn[i]) continue;
      activeCount++;
      for (const pred of inNeighbors[i]!) {
        if (!isTorn[pred]) inDeg[i]!++;
      }
    }
    const q: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!isTorn[i] && inDeg[i] === 0) q.push(i);
    }
    const order: number[] = [];
    let head = 0;
    while (head < q.length) {
      const u = q[head++]!;
      order.push(u);
      for (const v of outNeighbors[u]!) {
        if (isTorn[v]) continue;
        inDeg[v]!--;
        if (inDeg[v] === 0) q.push(v);
      }
    }
    return order.length === activeCount ? order : null;
  };

  let innerTopoOrder = tryTopoSortActive();
  while (innerTopoOrder === null && tornLocalIndices.length < n - 1) {
    // Pick active node participating in cycles with highest `inDeg * outDeg + nonlinearScore`
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < n; i++) {
      if (isTorn[i]) continue;
      let activeIn = 0;
      let activeOut = 0;
      for (const p of inNeighbors[i]!) if (!isTorn[p]) activeIn++;
      for (const c of outNeighbors[i]!) if (!isTorn[c]) activeOut++;
      if (activeIn === 0 || activeOut === 0) continue; // Cannot be on a cycle
      const score = activeIn * activeOut * 4 + activeIn + activeOut + nonlinearScore[i]!;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) {
      // Fallback: pick first remaining active node
      bestIdx = isTorn.findIndex((t) => t === 0);
      if (bestIdx === -1) break;
    }
    isTorn[bestIdx] = 1;
    tornLocalIndices.push(bestIdx);
    innerTopoOrder = tryTopoSortActive();
  }

  const finalInner = innerTopoOrder ?? [];
  const tearingVars = tornLocalIndices.map((idx) => variables[sccVars[idx]!]!.name);
  const residualEqs = tornLocalIndices.map((idx) => equations[sccEqs[idx]!]!.text);
  const causalChain = finalInner.map((idx) => ({
    eqText: equations[sccEqs[idx]!]!.text,
    solvedVar: variables[sccVars[idx]!]!.name,
  }));

  const reductionPercent = Math.max(0, Math.round(((n - tearingVars.length) / n) * 100));

  // Order inner causal chain first, followed by torn residual closures along diagonal
  const combinedLocalOrder = [...finalInner, ...tornLocalIndices];
  return {
    tearing: {
      tearingVars,
      residualEqs,
      causalChain,
      reductionPercent,
    },
    orderedVars: combinedLocalOrder.map((idx) => sccVars[idx]!),
    orderedEqs: combinedLocalOrder.map((idx) => sccEqs[idx]!),
  };
}

/**
 * Single-pass linear-time expression tokenizer for Modelica equations.
 * Recognizes `der(path)`, dotted/quoted/subscripted identifiers, nonlinear function scopes,
 * exponentiation (`^`), division denominators (`/`), and multiplicative term groups (`*`).
 */
function tokenizeEquationExpression(fullText: string, lhsText: string, loopIterators: Set<string>): TokenizedEquation {
  const occurrences: TokenizedOccurrence[] = [];

  // Determine primary LHS pivot candidate (`der(x)` if LHS is `der(x)`, or `v` if LHS is a single identifier)
  let lhsPrimaryTarget: string | null = null;
  const trimmedLhs = lhsText.trim();
  const lhsDer = /^der\s*\(\s*([^)]+?)\s*\)$/.exec(trimmedLhs);
  if (lhsDer) {
    lhsPrimaryTarget = `der(${lhsDer[1]!.replace(/\s+/g, "")})`;
  } else if (
    /^(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)(?:(?:\[\d+\])*\.(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*))*(?:\[\d+\])*$/.test(
      trimmedLhs,
    )
  ) {
    lhsPrimaryTarget = trimmedLhs;
  }

  const n = fullText.length;
  let i = 0;
  let termGroupId = 0;
  let prevSignificantOp = "";

  // Stack for parentheses: tracks whether entering `(` was a nonlinear function call or denominator `/(...)`
  const parenNonlinearStack: boolean[] = [];

  while (i < n) {
    const ch = fullText.charCodeAt(i);

    if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
      i++;
      continue;
    }

    // Numeric literal — skip (including scientific notation `1.5e-3`)
    if (ch >= 48 && ch <= 57) {
      i++;
      while (
        i < n &&
        ((fullText.charCodeAt(i) >= 48 && fullText.charCodeAt(i) <= 57) || fullText.charCodeAt(i) === 46)
      ) {
        i++;
      }
      if (i < n && (fullText.charCodeAt(i) === 101 || fullText.charCodeAt(i) === 69)) {
        i++;
        if (i < n && (fullText.charCodeAt(i) === 43 || fullText.charCodeAt(i) === 45)) i++;
        while (i < n && fullText.charCodeAt(i) >= 48 && fullText.charCodeAt(i) <= 57) i++;
      }
      prevSignificantOp = "num";
      continue;
    }

    // Additive/relational separators split multiplicative term groups
    if (ch === 43 || ch === 45 || ch === 61 || ch === 44 || ch === 59 || ch === 60 || ch === 62 || ch === 58) {
      termGroupId++;
      prevSignificantOp = fullText[i]!;
      i++;
      continue;
    }

    if (ch === 42) {
      // `*` keeps the SAME `termGroupId` so `x * y` shares `termGroupId`!
      prevSignificantOp = "*";
      i++;
      continue;
    }

    if (ch === 47) {
      prevSignificantOp = "/";
      i++;
      continue;
    }

    if (ch === 94) {
      // `^` marks previous occurrence nonlinear if it was immediately preceding
      if (occurrences.length > 0 && prevSignificantOp === "ident") {
        occurrences[occurrences.length - 1]!.inNonlinearContext = true;
      }
      prevSignificantOp = "^";
      i++;
      continue;
    }

    if (ch === 40) {
      const parentNl = parenNonlinearStack.length > 0 ? parenNonlinearStack[parenNonlinearStack.length - 1]! : false;
      const denomOrPow = prevSignificantOp === "/" || prevSignificantOp === "^";
      parenNonlinearStack.push(parentNl || denomOrPow);
      termGroupId++;
      prevSignificantOp = "(";
      i++;
      continue;
    }

    if (ch === 41) {
      parenNonlinearStack.pop();
      termGroupId++;
      prevSignificantOp = ")";
      i++;
      continue;
    }

    // Identifier or single-quoted identifier `'...'`
    if (ch === 39 || (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95) {
      const pathTok = readComponentReferenceToken(fullText, i, loopIterators);
      if (!pathTok) {
        i++;
        continue;
      }
      i = pathTok.nextPos;

      // Peek next non-space char to detect function calls `fn(...)` or `der(...)`
      let k = i;
      while (k < n && (fullText.charCodeAt(k) === 32 || fullText.charCodeAt(k) === 9)) k++;
      const isCall = k < n && fullText.charCodeAt(k) === 40;

      if (pathTok.path === "der" && isCall) {
        const closeIdx = findSimpleCloseParen(fullText, k);
        if (closeIdx > k + 1) {
          const innerArg = fullText.slice(k + 1, closeIdx).replace(/\s+/g, "");
          occurrences.push({
            name: `der(${innerArg})`,
            isDerivative: true,
            baseStateName: innerArg,
            inNonlinearContext: false,
            termGroupId,
          });
          i = closeIdx + 1;
          prevSignificantOp = "ident";
          continue;
        }
      }

      if (isCall) {
        const fnShort = pathTok.path.includes(".")
          ? pathTok.path.slice(pathTok.path.lastIndexOf(".") + 1)
          : pathTok.path;
        const parentNl = parenNonlinearStack.length > 0 ? parenNonlinearStack[parenNonlinearStack.length - 1]! : false;
        const isNlFn = NONLINEAR_FUNCTIONS.has(fnShort) || prevSignificantOp === "/" || prevSignificantOp === "^";
        parenNonlinearStack.push(parentNl || isNlFn);
        termGroupId++;
        prevSignificantOp = "(";
        i = k + 1;
        continue;
      }

      if (EXPR_KEYWORDS.has(pathTok.path) || loopIterators.has(pathTok.path)) {
        if (pathTok.path === "then" || pathTok.path === "else" || pathTok.path === "elseif") {
          termGroupId++;
        }
        prevSignificantOp = "kw";
        continue;
      }

      const inParenNl = parenNonlinearStack.length > 0 ? parenNonlinearStack[parenNonlinearStack.length - 1]! : false;
      const inDirectNl = prevSignificantOp === "/" || prevSignificantOp === "^";

      occurrences.push({
        name: pathTok.path,
        isDerivative: false,
        inNonlinearContext: inParenNl || inDirectNl,
        termGroupId,
      });
      prevSignificantOp = "ident";
      continue;
    }

    i++;
  }

  return { occurrences, lhsPrimaryTarget };
}

function readComponentReferenceToken(
  text: string,
  start: number,
  loopIterators: Set<string>,
): { path: string; nextPos: number } | null {
  const n = text.length;
  let i = start;
  let result = "";

  while (i < n) {
    const ch = text.charCodeAt(i);
    if (ch === 39) {
      const segStart = i;
      i++;
      while (i < n && text.charCodeAt(i) !== 39) {
        if (text.charCodeAt(i) === 92) i++;
        i++;
      }
      if (i < n) i++;
      result += text.slice(segStart, i);
    } else if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95) {
      const segStart = i;
      i++;
      while (
        i < n &&
        ((text.charCodeAt(i) >= 65 && text.charCodeAt(i) <= 90) ||
          (text.charCodeAt(i) >= 97 && text.charCodeAt(i) <= 122) ||
          (text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57) ||
          text.charCodeAt(i) === 95)
      ) {
        i++;
      }
      result += text.slice(segStart, i);
    } else {
      break;
    }

    // Optional integer array subscripts `[1]` (only bind constant numeric subscripts into variable name;
    // symbolic index expressions like `x[i]` keep base `x` while scanning inside `[...]`)
    while (i < n && text.charCodeAt(i) === 91) {
      const closeB = text.indexOf("]", i + 1);
      if (closeB === -1) break;
      const inside = text.slice(i + 1, closeB).trim();
      if (/^\d+$/.test(inside)) {
        result += `[${inside}]`;
        i = closeB + 1;
      } else {
        // Symbolic subscript (e.g. loop iterator `x[i]`): stop path at `x`
        void loopIterators;
        break;
      }
    }

    // Dotted continuation `.member`
    if (i < n && text.charCodeAt(i) === 46 && i + 1 < n) {
      const nextCh = text.charCodeAt(i + 1);
      if (nextCh === 39 || (nextCh >= 65 && nextCh <= 90) || (nextCh >= 97 && nextCh <= 122) || nextCh === 95) {
        result += ".";
        i++;
        continue;
      }
    }
    break;
  }

  return result ? { path: result, nextPos: i } : null;
}

function findSimpleCloseParen(text: string, openPos: number): number {
  let depth = 0;
  for (let i = openPos; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 39) {
      i++;
      while (i < text.length && text.charCodeAt(i) !== 39) {
        if (text.charCodeAt(i) === 92) i++;
        i++;
      }
      continue;
    }
    if (ch === 40) depth++;
    else if (ch === 41) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
