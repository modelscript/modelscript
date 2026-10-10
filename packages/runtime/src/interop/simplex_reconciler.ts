// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Multi-Domain Physics-Simplex Parameter Conflict Reconciler.
 *
 * Implements bounded linear programming (Two-Phase Simplex) to automatically resolve
 * multi-domain parameter discrepancies across Modelica, SysML v2, STEP CAD, FEA, and ReqIF
 * while strictly adhering to multi-variable physical constraints and bounds.
 *
 * Mathematical formulation:
 *   min_{x} \sum_{i, d} w_{i, d} (d_{i, d}^+ + d_{i, d}^-)
 *   subject to:
 *     x_i - d_{i, d}^+ + d_{i, d}^- = p_{i, d}       (domain proposal deviation)
 *     l_i <= x_i <= u_i                             (physical bounds)
 *     \sum_j A_{k, j} x_j <= b_k                     (inequality physics constraints)
 *     \sum_j E_{m, j} x_j == f_m                     (equality physics constraints)
 *     d_{i, d}^+, d_{i, d}^- >= 0
 */

export interface DomainProposal {
  domain: string; // e.g. "sysml2", "modelica", "cad", "fea", "requirements"
  value: number;
  unit: string;
  weight?: number; // default: 1.0
  tolerance?: number;
}

export interface ParameterConflictDefinition {
  name: string;
  unit: string;
  bounds?: {
    min?: number;
    max?: number;
  };
  proposals: DomainProposal[];
}

export interface PhysicalLinearConstraint {
  name: string;
  type: "le" | "ge" | "eq";
  coefficients: Record<string, number>; // parameterName -> coefficient
  rhs: number;
  unit?: string;
}

export interface ReconcileProblem {
  name?: string;
  parameters: Record<string, ParameterConflictDefinition>;
  constraints?: PhysicalLinearConstraint[];
  tolerance?: number;
}

export interface ParameterReconcileResult {
  parameterName: string;
  unit: string;
  optimalValue: number;
  bounds: { min: number; max: number };
  domainDeviations: Record<
    string,
    {
      proposed: number;
      deviation: number;
      relativeError: number;
    }
  >;
}

export interface SimplexReconcileResult {
  status: "OPTIMAL" | "INFEASIBLE" | "UNBOUNDED";
  problemName?: string;
  parameters: Record<string, ParameterReconcileResult>;
  totalWeightedDeviation: number;
  activeConstraints: string[];
  recommendation: string;
}

/**
 * Two-Phase Simplex solver specifically structured for bounded physical deviation minimization.
 */
export class PhysicsSimplexReconciler {
  /**
   * Reconciles a multi-domain, multi-variable parameter conflict.
   */
  public static reconcile(problem: ReconcileProblem): SimplexReconcileResult {
    const paramNames = Object.keys(problem.parameters);
    if (paramNames.length === 0) {
      return {
        status: "OPTIMAL",
        problemName: problem.name,
        parameters: {},
        totalWeightedDeviation: 0,
        activeConstraints: [],
        recommendation: "No parameters specified.",
      };
    }

    // Determine parameter bounds
    const bounds: Record<string, { min: number; max: number }> = {};
    for (const pName of paramNames) {
      const def = problem.parameters[pName]!;
      let minVal = def.bounds?.min;
      let maxVal = def.bounds?.max;

      // If bounds are unassigned, derive reasonable envelope from domain proposals
      if (minVal === undefined || maxVal === undefined) {
        const propVals = def.proposals.map((p) => p.value);
        const minProp = propVals.length > 0 ? Math.min(...propVals) : 0;
        const maxProp = propVals.length > 0 ? Math.max(...propVals) : 100;
        const span = Math.max(Math.abs(maxProp - minProp), Math.abs(minProp) * 0.5, 1.0);

        if (minVal === undefined) minVal = Math.min(0, minProp - span);
        if (maxVal === undefined) maxVal = maxProp + span;
      }

      if (minVal > maxVal) {
        return {
          status: "INFEASIBLE",
          problemName: problem.name,
          parameters: {},
          totalWeightedDeviation: Infinity,
          activeConstraints: [`Invalid bounds on ${pName}: min (${minVal}) > max (${maxVal})`],
          recommendation: `Physical bounds conflict on parameter '${pName}'.`,
        };
      }

      bounds[pName] = { min: minVal, max: maxVal };
    }

    // Index variables:
    // x_i in [0, U_i] where original x_i = bounds[i].min + x'_i, U_i = bounds[i].max - bounds[i].min
    // For each proposal (i, d):
    // d_{i, d}^+, d_{i, d}^- >= 0
    // Equation: x'_i - d_{i, d}^+ + d_{i, d}^- = p_{i, d} - bounds[i].min
    const paramIndexMap = new Map<string, number>();
    paramNames.forEach((name, idx) => paramIndexMap.set(name, idx));
    const nParams = paramNames.length;

    // Collect all deviation variables
    interface DeviationVar {
      paramIdx: number;
      paramName: string;
      domain: string;
      proposed: number;
      weight: number;
      posCol: number;
      negCol: number;
    }

    const devVars: DeviationVar[] = [];
    let currentCol = nParams;

    for (const pName of paramNames) {
      const pIdx = paramIndexMap.get(pName)!;
      const def = problem.parameters[pName]!;
      let totalW = 0;
      let weightedSum = 0;
      for (const prop of def.proposals) {
        const w = prop.weight ?? 1.0;
        totalW += w;
        weightedSum += w * prop.value;
        devVars.push({
          paramIdx: pIdx,
          paramName: pName,
          domain: prop.domain,
          proposed: prop.value,
          weight: w,
          posCol: currentCol++,
          negCol: currentCol++,
        });
      }

      // Add center-seeking tie breaker when multiple proposals exist
      if (def.proposals.length > 1 && totalW > 0) {
        const meanVal = weightedSum / totalW;
        devVars.push({
          paramIdx: pIdx,
          paramName: pName,
          domain: "__center__",
          proposed: meanVal,
          weight: 1e-5,
          posCol: currentCol++,
          negCol: currentCol++,
        });
      }
    }

    const numStructuralVars = currentCol; // x'_0..n-1, plus all d^+ and d^-

    // Constraints to build:
    // 1. Proposal equations: x'_i - d^+ + d^- = p - min
    // 2. Upper bounds: x'_i + s_ub_i = U_i
    // 3. User linear constraints: \sum c_j (x'_j + min_j) <= / >= / == rhs
    interface LinearRow {
      coeffs: Record<number, number>; // col -> coeff
      rhs: number;
      type: "eq" | "le";
      label: string;
    }

    const rows: LinearRow[] = [];

    // 1. Proposal equality rows
    for (const d of devVars) {
      const minVal = bounds[d.paramName]!.min;
      const targetRhs = d.proposed - minVal;
      rows.push({
        coeffs: {
          [d.paramIdx]: 1.0,
          [d.posCol]: -1.0,
          [d.negCol]: 1.0,
        },
        rhs: targetRhs,
        type: "eq",
        label: `Proposal_${d.paramName}_${d.domain}`,
      });
    }

    // 2. Parameter upper bound rows
    for (let i = 0; i < nParams; i++) {
      const pName = paramNames[i]!;
      const uVal = bounds[pName]!.max - bounds[pName]!.min;
      rows.push({
        coeffs: { [i]: 1.0 },
        rhs: uVal,
        type: "le",
        label: `Bound_${pName}_Max`,
      });
    }

    // 3. User physical linear constraints
    if (problem.constraints) {
      for (const c of problem.constraints) {
        const rowCoeffs: Record<number, number> = {};
        let constantShift = 0;

        for (const [pName, coeff] of Object.entries(c.coefficients)) {
          const pIdx = paramIndexMap.get(pName);
          if (pIdx !== undefined) {
            rowCoeffs[pIdx] = coeff;
            constantShift += coeff * bounds[pName]!.min;
          }
        }

        const effectiveRhs = c.rhs - constantShift;

        if (c.type === "le") {
          rows.push({
            coeffs: rowCoeffs,
            rhs: effectiveRhs,
            type: "le",
            label: c.name,
          });
        } else if (c.type === "ge") {
          // Multiply by -1 for le standard form: \sum -c_j x'_j <= -effectiveRhs
          const negCoeffs: Record<number, number> = {};
          for (const [k, v] of Object.entries(rowCoeffs)) {
            negCoeffs[Number(k)] = -v;
          }
          rows.push({
            coeffs: negCoeffs,
            rhs: -effectiveRhs,
            type: "le",
            label: c.name,
          });
        } else if (c.type === "eq") {
          rows.push({
            coeffs: rowCoeffs,
            rhs: effectiveRhs,
            type: "eq",
            label: c.name,
          });
        }
      }
    }

    // Solve using Two-Phase Simplex
    const solveResult = solveSimplexTableau(numStructuralVars, rows, devVars);

    if (solveResult.status !== "OPTIMAL") {
      return {
        status: solveResult.status,
        problemName: problem.name,
        parameters: {},
        totalWeightedDeviation: Infinity,
        activeConstraints: solveResult.activeConstraints,
        recommendation:
          solveResult.status === "INFEASIBLE"
            ? "Physical constraints are mutually contradictory. Relax boundary envelopes or tolerance limits."
            : "Optimization problem is unbounded.",
      };
    }

    // Map structural solutions back to physical domain parameter values
    const optimalParams: Record<string, ParameterReconcileResult> = {};
    const activeConstraints: string[] = [];

    for (let i = 0; i < nParams; i++) {
      const pName = paramNames[i]!;
      const shiftedVal = solveResult.solution[i] ?? 0;
      const b = bounds[pName]!;
      const optimalVal = Math.min(Math.max(b.min + shiftedVal, b.min), b.max);

      // Collect deviations for each domain proposal
      const domainDeviations: ParameterReconcileResult["domainDeviations"] = {};
      const def = problem.parameters[pName]!;

      for (const prop of def.proposals) {
        const dev = Math.abs(optimalVal - prop.value);
        const relErr = Math.abs(prop.value) > 1e-9 ? dev / Math.abs(prop.value) : dev;
        domainDeviations[prop.domain] = {
          proposed: prop.value,
          deviation: Number(dev.toFixed(6)),
          relativeError: Number(relErr.toFixed(6)),
        };
      }

      optimalParams[pName] = {
        parameterName: pName,
        unit: def.unit,
        optimalValue: Number(optimalVal.toFixed(6)),
        bounds: b,
        domainDeviations,
      };

      if (Math.abs(optimalVal - b.min) < 1e-5) {
        activeConstraints.push(`${pName} at lower bound (${b.min})`);
      } else if (Math.abs(optimalVal - b.max) < 1e-5) {
        activeConstraints.push(`${pName} at upper bound (${b.max})`);
      }
    }

    return {
      status: "OPTIMAL",
      problemName: problem.name,
      parameters: optimalParams,
      totalWeightedDeviation: Number(solveResult.optimalObjective.toFixed(6)),
      activeConstraints: [...activeConstraints, ...solveResult.activeConstraints],
      recommendation:
        solveResult.optimalObjective < 1e-4
          ? "Exact physical consensus achieved with zero constraint violation."
          : `Physics-Simplex compromise found with minimal weighted L1 deviation (${solveResult.optimalObjective.toFixed(
              4,
            )}).`,
    };
  }
}

interface TableauSolveResult {
  status: "OPTIMAL" | "INFEASIBLE" | "UNBOUNDED";
  optimalObjective: number;
  solution: number[];
  activeConstraints: string[];
}

function solveSimplexTableau(
  numStructuralVars: number,
  rows: { coeffs: Record<number, number>; rhs: number; type: "eq" | "le"; label: string }[],
  devVars: { posCol: number; negCol: number; weight: number }[],
): TableauSolveResult {
  const m = rows.length;

  // Count slack and artificial variables
  let numSlack = 0;
  let numArtificial = 0;
  const rowNeedsArtificial: boolean[] = [];

  for (let r = 0; r < m; r++) {
    const row = rows[r]!;
    if (row.type === "le") {
      if (row.rhs >= -1e-9) {
        numSlack++;
        rowNeedsArtificial.push(false);
      } else {
        // -coeff <= -rhs requires artificial
        numSlack++;
        numArtificial++;
        rowNeedsArtificial.push(true);
      }
    } else {
      // "eq" always requires artificial
      numArtificial++;
      rowNeedsArtificial.push(true);
    }
  }

  const numCols = numStructuralVars + numSlack + numArtificial; // plus 1 for RHS
  const totalCols = numCols + 1;
  const numRows = m;
  const totalRows = numRows + 1; // plus objective row

  // Tableau matrix T[0..totalRows-1][0..totalCols-1]
  const T: number[][] = Array.from({ length: totalRows }, () => new Array(totalCols).fill(0));
  const basic: number[] = new Array(numRows).fill(-1);

  let currentSlack = numStructuralVars;
  let currentArtificial = numStructuralVars + numSlack;

  // Build matrix rows
  for (let r = 0; r < m; r++) {
    const row = rows[r]!;
    let sign = 1.0;
    let rhs = row.rhs;

    if (row.type === "le") {
      if (rhs >= -1e-9) {
        for (const [col, coeff] of Object.entries(row.coeffs)) {
          T[r]![Number(col)] = coeff;
        }
        T[r]![currentSlack] = 1.0;
        T[r]![numCols] = Math.max(0, rhs);
        basic[r] = currentSlack;
        currentSlack++;
      } else {
        sign = -1.0;
        rhs = -rhs;
        for (const [col, coeff] of Object.entries(row.coeffs)) {
          T[r]![Number(col)] = sign * coeff;
        }
        T[r]![currentSlack] = -1.0;
        currentSlack++;
        T[r]![currentArtificial] = 1.0;
        T[r]![numCols] = rhs;
        basic[r] = currentArtificial;
        currentArtificial++;
      }
    } else {
      // eq
      if (rhs < -1e-9) {
        sign = -1.0;
        rhs = -rhs;
      }
      for (const [col, coeff] of Object.entries(row.coeffs)) {
        T[r]![Number(col)] = sign * coeff;
      }
      T[r]![currentArtificial] = 1.0;
      T[r]![numCols] = Math.max(0, rhs);
      basic[r] = currentArtificial;
      currentArtificial++;
    }
  }

  // Pivot operation
  const pivot = (leaveRow: number, enterCol: number) => {
    const pivotVal = T[leaveRow]![enterCol]!;
    for (let c = 0; c <= numCols; c++) {
      T[leaveRow]![c] /= pivotVal;
    }
    for (let r = 0; r <= numRows; r++) {
      if (r !== leaveRow) {
        const factor = T[r]![enterCol]!;
        if (Math.abs(factor) > 1e-15) {
          for (let c = 0; c <= numCols; c++) {
            T[r]![c] -= factor * T[leaveRow]![c]!;
          }
        }
      }
    }
    basic[leaveRow] = enterCol;
  };

  // Phase I: Minimize sum of artificials
  if (numArtificial > 0) {
    const numEligibleCols = numStructuralVars + numSlack;
    // Set Phase 1 objective row: z_1 = - \sum artificial
    for (let r = 0; r < numRows; r++) {
      if (rowNeedsArtificial[r]) {
        for (let c = 0; c < numEligibleCols; c++) {
          T[numRows]![c] -= T[r]![c]!;
        }
        T[numRows]![numCols] -= T[r]![numCols]!;
      }
    }

    let iter = 0;
    while (iter++ < 500) {
      let enterCol = -1;
      let minCost = -1e-9;
      for (let c = 0; c < numEligibleCols; c++) {
        if (T[numRows]![c]! < minCost) {
          minCost = T[numRows]![c]!;
          enterCol = c;
        }
      }
      if (enterCol === -1) break;

      let leaveRow = -1;
      let minRatio = Infinity;
      for (let r = 0; r < numRows; r++) {
        const coeff = T[r]![enterCol]!;
        if (coeff > 1e-9) {
          const ratio = Math.max(0, T[r]![numCols]!) / coeff;
          if (ratio < minRatio - 1e-12) {
            minRatio = ratio;
            leaveRow = r;
          }
        }
      }
      if (leaveRow === -1) break;
      pivot(leaveRow, enterCol);
    }

    // Check feasibility: artificial objective should be ~0
    if (T[numRows]![numCols]! < -1e-5) {
      const activeConstraints: string[] = [];
      for (let r = 0; r < numRows; r++) {
        if (basic[r]! >= numStructuralVars + numSlack) {
          activeConstraints.push(rows[r]?.label || `Row_${r}`);
        }
      }
      return {
        status: "INFEASIBLE",
        optimalObjective: Infinity,
        solution: [],
        activeConstraints,
      };
    }
  }

  // Phase II: Minimize original objective: \sum w (d^+ + d^-)
  // Clear objective row
  for (let c = 0; c <= numCols; c++) {
    T[numRows]![c] = 0;
  }

  // Target objective: minimize \sum w d^+ + w d^- (or maximize - \sum ...)
  // In simplex tableau where min cost rule is used: cost row has c_j
  for (const d of devVars) {
    T[numRows]![d.posCol] = d.weight;
    T[numRows]![d.negCol] = d.weight;
  }

  // Substitute out basic variables from Phase II objective row
  for (let r = 0; r < numRows; r++) {
    const basicCol = basic[r]!;
    const coeff = T[numRows]![basicCol]!;
    if (Math.abs(coeff) > 1e-12) {
      for (let c = 0; c <= numCols; c++) {
        T[numRows]![c] -= coeff * T[r]![c]!;
      }
    }
  }

  // Simplex Phase II iterations
  let iter2 = 0;
  const maxStructuralCols = numStructuralVars + numSlack;

  while (iter2++ < 500) {
    let enterCol = -1;
    let minCost = -1e-9;
    for (let c = 0; c < maxStructuralCols; c++) {
      if (T[numRows]![c]! < minCost) {
        minCost = T[numRows]![c]!;
        enterCol = c;
      }
    }
    if (enterCol === -1) break;

    let leaveRow = -1;
    let minRatio = Infinity;
    for (let r = 0; r < numRows; r++) {
      const coeff = T[r]![enterCol]!;
      if (coeff > 1e-9) {
        const ratio = Math.max(0, T[r]![numCols]!) / coeff;
        if (ratio < minRatio - 1e-12) {
          minRatio = ratio;
          leaveRow = r;
        }
      }
    }

    if (leaveRow === -1) {
      return {
        status: "UNBOUNDED",
        optimalObjective: -Infinity,
        solution: [],
        activeConstraints: [],
      };
    }

    pivot(leaveRow, enterCol);
  }

  // Extract solution
  const solution = new Array<number>(numStructuralVars).fill(0);
  for (let r = 0; r < numRows; r++) {
    const col = basic[r]!;
    if (col < numStructuralVars) {
      solution[col] = Math.max(0, T[r]![numCols]!);
    }
  }

  const optimalObjective = Math.max(0, -T[numRows]![numCols]!);

  return {
    status: "OPTIMAL",
    optimalObjective,
    solution,
    activeConstraints: [],
  };
}
