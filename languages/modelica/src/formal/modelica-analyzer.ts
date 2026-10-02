// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArraySegmentState,
  FixpointSolver,
  GenericCFG,
  NumericalInterval as Interval,
  ReducedProductState,
  type RTECheckResult,
  type VerificationSummary,
} from "@modelscript/runtime";
import { ModelicaAbstractEvaluator } from "./modelica-abstract-evaluator.js";
import { findCstNodesByType, ModelicaCFGLowerer, type ModelicaStatement } from "./modelica-cfg-lowerer.js";

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
  cfg?: GenericCFG;
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
    return this.analyzeCfg(cfg, variables, options);
  }

  /**
   * Analyzes a pre-constructed GenericCFG with declared inputs and local variables.
   */
  static analyzeCfg(
    cfg: GenericCFG,
    variables: ModelicaVariableDecl[] = [],
    options?: { functionName?: string; plantPreconditions?: Map<string, [number, number]> },
  ): ModelicaFormalProofResult {
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

    // 5. Compute path-sensitive definite assignment dataflow across CFG
    const instInitializedMap = this.computeDefiniteAssignment(cfg, initializedVars);

    // 6. Run Worklist Fixpoint Solver with Edge Condition Propagation
    const solver = new FixpointSolver(
      cfg,
      (inst, s, collect) => {
        const instInit = instInitializedMap.get(inst.id) ?? initializedVars;
        return ModelicaAbstractEvaluator.transfer(inst, s, collect, instInit, declaredVars);
      },
      thresholds,
      20,
      (edge, s) => {
        if (edge.conditionExpr) {
          return ModelicaAbstractEvaluator.assumeCondition(String(edge.conditionExpr), s);
        }
        return s;
      },
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

    // 6. Generate formatted formal verification executive summary table
    const fnLabel = options?.functionName ? ` for '${options.functionName}'` : "";
    const headerTitle = `Modelica Algorithmic Abstract Interpretation${fnLabel}`;
    const formattedMatrix = [
      `┌────────────────────────────────────────────────────────────────────────┐`,
      `│ ${headerTitle.slice(0, 70).padEnd(70)} │`,
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
      cfg,
      isCertifiedSafe,
      provenSafe,
      definiteBugs,
      potentialBugs,
      deadCodeBlocks: summary.deadCodeBlockCount,
      summary,
      formattedMatrix,
    };
  }

  /**
   * Computes path-sensitive definite assignment dataflow across the CFG.
   * Returns a map from CFGInstruction ID to the set of definitely assigned variables at that instruction.
   */
  static computeDefiniteAssignment(cfg: GenericCFG, initialVars: Set<string>): Map<number, Set<string>> {
    const instInitialized = new Map<number, Set<string>>();
    const inInitialized = new Map<number, Set<string>>();
    const outInitialized = new Map<number, Set<string>>();

    for (const bId of cfg.blocks.keys()) {
      inInitialized.set(bId, bId === cfg.entryBlockId ? new Set(initialVars) : new Set());
      outInitialized.set(bId, bId === cfg.entryBlockId ? new Set(initialVars) : new Set());
    }

    const rpo = cfg.computeRPO();
    let changed = true;
    let iterations = 0;
    const maxIterations = cfg.blocks.size * 2 + 5;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const bId of rpo) {
        const block = cfg.getBlock(bId);
        if (!block) continue;

        let currIn: Set<string>;
        if (bId === cfg.entryBlockId) {
          currIn = new Set(initialVars);
        } else if (block.predecessors.length > 0) {
          let intersect: Set<string> | null = null;
          for (const pId of block.predecessors) {
            const pOut = outInitialized.get(pId);
            if (pOut) {
              if (intersect === null) {
                intersect = new Set(pOut);
              } else {
                for (const v of intersect) {
                  if (!pOut.has(v)) intersect.delete(v);
                }
              }
            }
          }
          currIn = intersect ?? new Set();
        } else {
          currIn = new Set();
        }

        inInitialized.set(bId, currIn);

        const running = new Set(currIn);
        for (const inst of block.instructions) {
          instInitialized.set(inst.id, new Set(running));
          if (inst.targetVar && (inst.op === "ASSIGN" || inst.op === "ASSIGN_ARRAY")) {
            running.add(inst.targetVar);
          }
        }

        const prevOut = outInitialized.get(bId)!;
        if (running.size !== prevOut.size || Array.from(running).some((v) => !prevOut.has(v))) {
          outInitialized.set(bId, running);
          changed = true;
        }
      }
    }

    return instInitialized;
  }

  /**
   * Extracts declared variable specifications directly from a class_definition CST node.
   */
  static extractVariablesFromClassCst(classCst: any, db?: any, classId?: any): ModelicaVariableDecl[] {
    const variables: ModelicaVariableDecl[] = [];
    const seen = new Set<string>();

    if (classCst) {
      const compClauses = findCstNodesByType(classCst, "component_clause");
      for (const comp of compClauses) {
        const isInput = Boolean(findCstNodesByType(comp, "input")[0]);
        const isOutput = Boolean(findCstNodesByType(comp, "output")[0]);
        const typeSpec = findCstNodesByType(comp, "type_specifier")[0]?.text?.trim() || "Real";
        const normalizedType = /Integer/i.test(typeSpec)
          ? "Integer"
          : /Boolean/i.test(typeSpec)
            ? "Boolean"
            : /String/i.test(typeSpec)
              ? "String"
              : "Real";

        const compDecls = findCstNodesByType(comp, "component_declaration");
        for (const cd of compDecls) {
          const idNode = findCstNodesByType(cd, "identifier")[0];
          const vName = idNode?.text?.trim();
          if (!vName || seen.has(vName)) continue;
          seen.add(vName);

          const subNode =
            findCstNodesByType(cd, "array_subscripts")[0] ?? findCstNodesByType(comp, "array_subscripts")[0];
          const isArray = Boolean(subNode);
          let arrayDimension: number | undefined = undefined;
          if (subNode?.text) {
            const numMatch = /\b\d+\b/.exec(subNode.text);
            if (numMatch) {
              arrayDimension = Number(numMatch[0]);
            }
          }

          let initialBound: [number, number] | undefined = undefined;
          const modNode = findCstNodesByType(cd, "modification")[0];
          if (modNode?.text) {
            const eqMatch = /=\s*(-?\d+(?:\.\d+)?)/.exec(modNode.text);
            if (eqMatch && eqMatch[1]) {
              const val = Number(eqMatch[1]);
              initialBound = [val, val];
            }
          }

          variables.push({
            name: vName,
            type: normalizedType,
            isInput,
            isOutput,
            isArray,
            arrayDimension,
            initialBound,
          });
        }
      }
    }

    return variables;
  }

  /**
   * Analyzes a class or function directly from linear CST / CodeGraph.
   */
  static analyzeClassCst(
    db: any,
    classId: any,
    options?: { functionName?: string; plantPreconditions?: Map<string, [number, number]> },
  ): ModelicaFormalProofResult | null {
    const cst = typeof db?.cstNode === "function" ? db.cstNode(classId) : classId?.type ? classId : null;
    if (!cst) return null;

    const classSym = typeof db?.symbol === "function" ? db.symbol(classId) : null;
    const fnName =
      options?.functionName ?? classSym?.name ?? (findCstNodesByType(cst, "identifier")[0]?.text?.trim() || undefined);

    const variables = this.extractVariablesFromClassCst(cst, db, classId);
    const cfg = ModelicaCFGLowerer.lowerAlgorithmFromCst(db, classId);

    // Ensure the CFG contains executable instructions
    let hasInstructions = false;
    for (const block of cfg.blocks.values()) {
      if (block.instructions.length > 0) {
        hasInstructions = true;
        break;
      }
    }
    if (!hasInstructions) return null;

    return this.analyzeCfg(cfg, variables, {
      functionName: fnName,
      ...options,
    });
  }

  static analyzeClass = ModelicaAlgorithmAnalyzer.analyzeClassCst;
}
