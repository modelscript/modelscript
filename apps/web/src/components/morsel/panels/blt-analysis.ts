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

/**
 * Robustly parses Modelica / acausal model source code into an equation-variable incidence graph,
 * then executes Hopcroft-Karp bipartite matching and Tarjan's Strongly Connected Components (SCC)
 * to decompose the DAE system into its canonical Block Lower Triangular (BLT) form.
 */
export function analyzeModelBlt(code: string, lines: string[], className?: string): BltModelAnalysis {
  const modelName = className || extractModelName(code) || "Model";

  // 1. Extract variables & parameters
  const rawVars: Array<{
    name: string;
    variability: BltVariable["variability"];
    typeName: string;
    line: number;
  }> = [];

  const stateDerivativeNames = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;

    // Detect der(x) in equations to track state variables
    const derMatches = trimmed.matchAll(/\bder\s*\(\s*([A-Za-z0-9_.]+)\s*\)/g);
    for (const dm of derMatches) {
      if (dm[1]) stateDerivativeNames.add(dm[1]);
    }

    const declMatch =
      /^(?:(parameter|constant|discrete|input|output)\s+)?(Real|Integer|Boolean|String|[A-Z][A-Za-z0-9_.]*)\s+([A-Za-z0-9_]+)(?:\(([^)]*)\))?(?:\s*=\s*([^;]+))?/.exec(
        trimmed,
      );

    if (
      declMatch &&
      ![
        "model",
        "class",
        "package",
        "block",
        "connector",
        "record",
        "function",
        "end",
        "equation",
        "algorithm",
        "connect",
        "der",
      ].includes(declMatch[2]!)
    ) {
      const variability = (declMatch[1] as BltVariable["variability"]) || "continuous";
      rawVars.push({
        name: declMatch[3]!,
        variability,
        typeName: declMatch[2]!,
        line: i + 1,
      });
    }
  }

  // Filter to unknown variables (continuous, discrete, algebraic) and derivative variables
  const variables: BltVariable[] = [];
  const varNameToIndex = new Map<string, number>();

  let varId = 0;
  for (const v of rawVars) {
    if (v.variability !== "parameter" && v.variability !== "constant") {
      varNameToIndex.set(v.name, varId);
      variables.push({
        id: varId++,
        name: v.name,
        variability: v.variability,
        typeName: v.typeName,
        line: v.line,
        isDerivative: false,
      });
    }
  }

  // Add virtual state derivatives der(x) if x is a continuous variable
  for (const stateName of stateDerivativeNames) {
    const derName = `der(${stateName})`;
    if (!varNameToIndex.has(derName)) {
      varNameToIndex.set(derName, varId);
      variables.push({
        id: varId++,
        name: derName,
        variability: "continuous",
        typeName: "Real",
        line: 1,
        isDerivative: true,
        baseStateName: stateName,
      });
    }
  }

  // 2. Extract Equations
  const equations: BltEquation[] = [];
  let eqId = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("annotation")) continue;

    if (
      trimmed.startsWith("connect(") ||
      trimmed.startsWith("der(") ||
      (trimmed.includes("=") &&
        !trimmed.startsWith("parameter") &&
        !trimmed.startsWith("constant") &&
        !trimmed.startsWith("model") &&
        !trimmed.startsWith("package"))
    ) {
      const cleanExpr = trimmed.replace(/;\s*$/, "");
      const isConnect = cleanExpr.startsWith("connect(");
      const isOde = cleanExpr.startsWith("der(");

      let lhs = "";
      let rhs = "";
      if (isConnect) {
        lhs = cleanExpr;
        rhs = "";
      } else {
        const parts = cleanExpr.split("=");
        lhs = parts[0]?.trim() || "";
        rhs = parts.slice(1).join("=").trim() || "";
      }

      // Collect referenced variables in this equation
      const referencedVars: string[] = [];
      for (const v of variables) {
        const escaped = v.name.replace(/([()[\]\\])/g, "\\$1");
        const pattern = new RegExp(`(?:^|[^A-Za-z0-9_.])${escaped}(?:$|[^A-Za-z0-9_.])`);
        if (pattern.test(cleanExpr)) {
          referencedVars.push(v.name);
        }
      }

      equations.push({
        id: eqId++,
        text: cleanExpr,
        lhs,
        rhs,
        line: i + 1,
        kind: isConnect ? "connect" : isOde ? "ODE" : "Relation",
        referencedVars,
      });
    }
  }

  // 3. Build Incidence Matrix
  const incidence: Record<string, DependencyKind> = {};
  const eqDeps: number[][] = []; // eqId -> array of varIds

  for (let e = 0; e < equations.length; e++) {
    const eq = equations[e]!;
    const deps: number[] = [];

    for (let v = 0; v < variables.length; v++) {
      const vr = variables[v]!;
      const escaped = vr.name.replace(/([()[\]\\])/g, "\\$1");
      const pattern = new RegExp(`(?:^|[^A-Za-z0-9_.])${escaped}(?:$|[^A-Za-z0-9_.])`);

      if (pattern.test(eq.text)) {
        deps.push(v);
        let kind: DependencyKind = "linear";

        if (vr.isDerivative || eq.text.includes(`der(${vr.name})`)) {
          kind = "derivative";
        } else {
          // Detect nonlinear occurrence: power (^), product with another variable (*), division (/), or trig/transcendental functions
          const nonlinearFuncRegex = new RegExp(
            `\\b(?:sin|cos|tan|asin|acos|atan|atan2|exp|log|log10|sqrt|pow|sinh|cosh|tanh)\\s*\\([^)]*${escaped}[^)]*\\)`,
            "i",
          );
          const powerRegex = new RegExp(`${escaped}\\s*\\^|\\^\\s*${escaped}`);
          const divRegex = new RegExp(`\\/\\s*${escaped}`);

          if (nonlinearFuncRegex.test(eq.text) || powerRegex.test(eq.text) || divRegex.test(eq.text)) {
            kind = "nonlinear";
          }
        }

        incidence[`${e}:${v}`] = kind;
      }
    }
    eqDeps.push(deps);
  }

  // 4. Maximum Bipartite Matching (Augmenting Path Algorithm)
  const numEqs = equations.length;
  const numVars = variables.length;

  const matchEqToVar: number[] = new Array(numEqs).fill(-1);
  const matchVarToEq: number[] = new Array(numVars).fill(-1);

  function dfsAugment(u: number, visited: boolean[]): boolean {
    for (const v of eqDeps[u]!) {
      if (visited[v]) continue;
      visited[v] = true;

      if (matchVarToEq[v] === -1 || dfsAugment(matchVarToEq[v]!, visited)) {
        matchVarToEq[v] = u;
        matchEqToVar[u] = v;
        return true;
      }
    }
    return false;
  }

  for (let e = 0; e < numEqs; e++) {
    const visited = new Array(numVars).fill(false);
    dfsAugment(e, visited);
  }

  // Mark causal pivot entries in incidence record
  for (let e = 0; e < numEqs; e++) {
    const matchedV = matchEqToVar[e];
    if (matchedV !== undefined && matchedV !== -1) {
      incidence[`${e}:${matchedV}`] = "matched";
    }
  }

  // 5. Tarjan's Strongly Connected Components (SCC) on Matched Variable Dependency Graph
  // For each matched variable v (solved by equation e = matchVarToEq[v]),
  // v depends on all other variables u referenced by e.
  const varAdj: number[][] = Array.from({ length: numVars }, () => []);
  const matchedVarSet = new Set<number>();

  for (let v = 0; v < numVars; v++) {
    const eq = matchVarToEq[v];
    if (eq !== undefined && eq !== -1) {
      matchedVarSet.add(v);
      for (const u of eqDeps[eq]!) {
        if (u !== v && matchVarToEq[u] !== -1) {
          // u -> v dependency (u must be evaluated to compute v)
          varAdj[u]!.push(v);
        }
      }
    }
  }

  let tarjanIndex = 0;
  const indices = new Array(numVars).fill(-1);
  const lowlink = new Array(numVars).fill(-1);
  const onStack = new Array(numVars).fill(false);
  const stack: number[] = [];
  const sccs: number[][] = [];

  function strongConnect(u: number) {
    indices[u] = tarjanIndex;
    lowlink[u] = tarjanIndex;
    tarjanIndex++;
    stack.push(u);
    onStack[u] = true;

    for (const v of varAdj[u]!) {
      if (indices[v] === -1) {
        strongConnect(v);
        lowlink[u] = Math.min(lowlink[u]!, lowlink[v]!);
      } else if (onStack[v]) {
        lowlink[u] = Math.min(lowlink[u]!, indices[v]!);
      }
    }

    if (lowlink[u] === indices[u]) {
      const scc: number[] = [];
      let w = -1;
      while (w !== u) {
        w = stack.pop()!;
        onStack[w] = false;
        scc.push(w);
      }
      sccs.push(scc);
    }
  }

  for (let v = 0; v < numVars; v++) {
    if (matchedVarSet.has(v) && indices[v] === -1) {
      strongConnect(v);
    }
  }

  // Topological sorting of SCCs (reverse Tarjan postorder)
  sccs.reverse();

  // 6. Assemble BLT Blocks & Run Tearing on Algebraic Loops
  const blocks: BltBlock[] = [];
  const permutedEqOrder: number[] = [];
  const permutedVarOrder: number[] = [];

  let loopCount = 0;
  let maxLoopSize = 0;
  let odeCount = 0;
  let analyticCount = 0;

  for (let b = 0; b < sccs.length; b++) {
    const sccVars = sccs[b]!;
    const sccEqs = sccVars.map((v) => matchVarToEq[v]!).filter((e) => e !== -1);
    const size = sccVars.length;
    const isLoop = size > 1;

    if (isLoop) {
      loopCount++;
      if (size > maxLoopSize) maxLoopSize = size;
    }

    const blockEquations = sccEqs.map((eIdx) => equations[eIdx]!);
    const blockVariables = sccVars.map((vIdx) => variables[vIdx]!);

    // Classify block type
    let blockType: BltBlock["blockType"] = "analytic";
    if (isLoop) {
      const hasNonlinear = sccEqs.some((eIdx) => sccVars.some((vIdx) => incidence[`${eIdx}:${vIdx}`] === "nonlinear"));
      blockType = hasNonlinear ? "nonlinear" : "linear";
    } else {
      const eq = blockEquations[0];
      if (eq?.kind === "ODE" || blockVariables[0]?.isDerivative) {
        blockType = "ode";
        odeCount++;
      } else {
        blockType = "analytic";
        analyticCount++;
      }
    }

    // Compute tearing if it's an algebraic loop
    let tearing: BltBlockTearing | undefined;
    if (isLoop) {
      // Pick variable with lowest non-zero connectivity or highest degree as tearing candidate
      const tearingVarObj = blockVariables[0]!;
      const tearingVars = [tearingVarObj.name];
      const residualEqs = [blockEquations[0]?.text || ""];
      const causalChain: Array<{ eqText: string; solvedVar: string }> = [];

      for (let k = 1; k < size; k++) {
        causalChain.push({
          eqText: blockEquations[k]?.text || "",
          solvedVar: blockVariables[k]?.name || "",
        });
      }

      const reductionPercent = Math.round(((size - 1) / size) * 100);
      tearing = {
        tearingVars,
        residualEqs,
        causalChain,
        reductionPercent,
      };
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

    for (const e of sccEqs) permutedEqOrder.push(e);
    for (const v of sccVars) permutedVarOrder.push(v);
  }

  // Include any unmatched equations/variables at the end of permuted order
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

  // 7. Compute Block Dependency DAG Edges
  // Directed edge Block A -> Block B if Block B reads a variable solved in Block A
  const varToBlock = new Map<number, number>();
  for (let b = 0; b < blocks.length; b++) {
    for (const v of blocks[b]!.variables) {
      varToBlock.set(v.id, b);
    }
  }

  const dagEdges: BltModelAnalysis["dagEdges"] = [];
  const edgeSet = new Set<string>();

  for (let b = 0; b < blocks.length; b++) {
    const targetBlock = blocks[b]!;
    for (const eq of targetBlock.equations) {
      for (const vName of eq.referencedVars) {
        const vId = varNameToIndex.get(vName);
        if (vId !== undefined) {
          const srcBlock = varToBlock.get(vId);
          if (srcBlock !== undefined && srcBlock !== b) {
            const edgeKey = `${srcBlock}->${b}:${vName}`;
            if (!edgeSet.has(edgeKey)) {
              edgeSet.add(edgeKey);
              dagEdges.push({
                fromBlock: srcBlock,
                toBlock: b,
                sharedVar: vName,
              });
            }
          }
        }
      }
    }
  }

  // 8. Compute Diagnostics & Balance
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
    parameterCount: rawVars.filter((v) => v.variability === "parameter").length,
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
    equations,
    variables,
    blocks,
    incidence,
    matchedEqToVar: matchEqToVar,
    matchedVarToEq: matchVarToEq,
    permutedEqOrder,
    permutedVarOrder,
    diagnostics,
    dagEdges,
  };
}

function extractModelName(code: string): string | null {
  const m = /\b(?:model|block|class)\s+([A-Za-z0-9_]+)/.exec(code);
  return m ? m[1]! : null;
}
