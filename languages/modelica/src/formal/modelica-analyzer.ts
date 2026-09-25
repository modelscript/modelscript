// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArraySegmentState,
  FixpointSolver,
  NumericalInterval as Interval,
  ReducedProductState,
  type RTECheckResult,
  type VerificationSummary,
} from "@modelscript/runtime";
import { ModelicaAbstractEvaluator } from "./modelica-abstract-evaluator.js";
import { ModelicaCFGLowerer, type ModelicaStatement } from "./modelica-cfg-lowerer.js";

export interface ModelicaVariableDecl {
  name: string;
  type?: "Real" | "Integer" | "Boolean" | "String";
  isInput?: boolean;
  isOutput?: boolean;
  isArray?: boolean;
  arrayDimension?: number;
  initialBound?: [number, number]; // e.g. [0, 100]
}

export interface ModelicaFormalProofResult {
  functionName?: string;
  isCertifiedSafe: boolean; // True if 0 definite bugs and 0 potential bugs
  provenSafe: RTECheckResult[];
  definiteBugs: RTECheckResult[];
  potentialBugs: RTECheckResult[];
  deadCodeBlocks: number;
  summary: VerificationSummary;
  formattedMatrix: string;
}

export class ModelicaAlgorithmAnalyzer {
  /**
   * Analyzes raw Modelica algorithmic source text directly.
   */
  static analyzeCode(
    code: string,
    variables: ModelicaVariableDecl[] = [],
    options?: { functionName?: string; plantPreconditions?: Map<string, [number, number]> },
  ): ModelicaFormalProofResult {
    const statements = ModelicaCFGLowerer.parseStatements(code);
    return this.analyze(statements, variables, options);
  }

  /**
   * Analyzes a list of Modelica statements with declared inputs and local variables.
   */
  static analyze(
    statements: ModelicaStatement[],
    variables: ModelicaVariableDecl[] = [],
    options?: { functionName?: string; plantPreconditions?: Map<string, [number, number]> },
  ): ModelicaFormalProofResult {
    const lowerer = new ModelicaCFGLowerer();
    const cfg = lowerer.lower(statements);

    // 1. Track declared and initialized variables
    const declaredVars = new Set<string>();
    const initializedVars = new Set<string>();

    for (const v of variables) {
      declaredVars.add(v.name);
      if (v.isInput || v.initialBound !== undefined || v.isArray) {
        initializedVars.add(v.name);
      }
    }

    // 2. Gather literal constants & array dimensions as widening thresholds
    const thresholdsSet = new Set<number>([-1, 0, 1, 10, 100, 1000]);
    for (const v of variables) {
      if (v.arrayDimension) {
        thresholdsSet.add(v.arrayDimension);
        thresholdsSet.add(v.arrayDimension + 1);
      }
      if (v.initialBound) {
        thresholdsSet.add(v.initialBound[0]);
        thresholdsSet.add(v.initialBound[1]);
      }
    }
    const thresholds = Array.from(thresholdsSet).sort((a, b) => a - b);

    // 3. Build initial abstract state
    let state = ReducedProductState.top(Math.max(32, variables.length * 2));

    for (const v of variables) {
      if (v.isArray && v.arrayDimension) {
        const arrState = new ArraySegmentState(
          new Interval(v.arrayDimension, v.arrayDimension),
          v.initialBound ? new Interval(v.initialBound[0], v.initialBound[1]) : Interval.TOP,
        );
        state.arraySegments.set(v.name, arrState);
      } else if (v.initialBound) {
        state = new ReducedProductState(
          state.intervals.set(v.name, new Interval(v.initialBound[0], v.initialBound[1])),
          state.octagon,
          state.varIndices,
          state.arraySegments,
          false,
        );
      }
    }

    // 4. Inject continuous plant flowpipe bounds (0 false alarms bridge)
    if (options?.plantPreconditions) {
      for (const [varName, [lo, hi]] of options.plantPreconditions) {
        state = new ReducedProductState(
          state.intervals.set(varName, new Interval(lo, hi)),
          state.octagon,
          state.varIndices,
          state.arraySegments,
          false,
        );
        initializedVars.add(varName);
      }
    }

    state = state.reduce();

    // 5. Run Worklist Fixpoint Solver
    const solver = new FixpointSolver(
      cfg,
      (inst, s, collect) => ModelicaAbstractEvaluator.transfer(inst, s, collect, initializedVars, declaredVars),
      thresholds,
    );

    const summary = solver.solve(state);

    const provenSafe: RTECheckResult[] = [];
    const definiteBugs: RTECheckResult[] = [];
    const potentialBugs: RTECheckResult[] = [];

    for (const c of summary.checks) {
      if (c.verdict === "proven_safe") provenSafe.push(c);
      else if (c.verdict === "definite_bug") definiteBugs.push(c);
      else if (c.verdict === "potential_bug") potentialBugs.push(c);
    }

    const isCertifiedSafe = definiteBugs.length === 0 && potentialBugs.length === 0;

    // 6. Generate formatted Polyspace-style executive summary table
    const fnLabel = options?.functionName ? ` for '${options.functionName}'` : "";
    const formattedMatrix = [
      `┌────────────────────────────────────────────────────────────────────────┐`,
      `│ Modelica Algorithmic Abstract Interpretation (Astrée/Polyspace Grade)${fnLabel.padEnd(20)}│`,
      `├─────────────────────────────┬──────────┬──────────┬──────────┬─────────┤`,
      `│ Check Category              │ Proven ✓ │ Defect ✗ │ Unproven │ Dead ◌  │`,
      `├─────────────────────────────┼──────────┼──────────┼──────────┼─────────┤`,
      `│ Array Subscripts (In-Bounds)│ ${String(provenSafe.filter((c) => c.category === "array_out_of_bounds").length).padStart(8)} │ ${String(definiteBugs.filter((c) => c.category === "array_out_of_bounds").length).padStart(8)} │ ${String(potentialBugs.filter((c) => c.category === "array_out_of_bounds").length).padStart(8)} │    -    │`,
      `│ Division by Zero            │ ${String(provenSafe.filter((c) => c.category === "division_by_zero").length).padStart(8)} │ ${String(definiteBugs.filter((c) => c.category === "division_by_zero").length).padStart(8)} │ ${String(potentialBugs.filter((c) => c.category === "division_by_zero").length).padStart(8)} │    -    │`,
      `│ Math Function Domain        │ ${String(provenSafe.filter((c) => c.category === "math_domain").length).padStart(8)} │ ${String(definiteBugs.filter((c) => c.category === "math_domain").length).padStart(8)} │ ${String(potentialBugs.filter((c) => c.category === "math_domain").length).padStart(8)} │    -    │`,
      `│ Uninitialized Variables     │ ${String(provenSafe.filter((c) => c.category === "uninitialized_read").length).padStart(8)} │ ${String(definiteBugs.filter((c) => c.category === "uninitialized_read").length).padStart(8)} │ ${String(potentialBugs.filter((c) => c.category === "uninitialized_read").length).padStart(8)} │    -    │`,
      `├─────────────────────────────┼──────────┼──────────┼──────────┼─────────┤`,
      `│ TOTALS                      │ ${String(provenSafe.length).padStart(8)} │ ${String(definiteBugs.length).padStart(8)} │ ${String(potentialBugs.length).padStart(8)} │ ${String(summary.deadCodeBlockCount).padStart(7)} │`,
      `└─────────────────────────────┴──────────┴──────────┴──────────┴─────────┘`,
      `STATUS: ${isCertifiedSafe ? "100% CERTIFIED SAFE (Zero Run-Time Errors)" : "VERIFICATION FAILED: Violations Detected"}`,
    ].join("\n");

    return {
      functionName: options?.functionName,
      isCertifiedSafe,
      provenSafe,
      definiteBugs,
      potentialBugs,
      deadCodeBlocks: summary.deadCodeBlockCount,
      summary,
      formattedMatrix,
    };
  }
}
