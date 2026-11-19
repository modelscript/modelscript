// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module formal/formal-verifier
 *
 * On-demand formal verification suite for Modelica models (`M7xxx` diagnostic block).
 * Combines structural DAE verification (BLT, Dulmage-Mendelsohn, Pantelides index),
 * abstract interpretation (interval/affine DAE reachability, octagon relational bounds,
 * algorithmic fixpoint RTE verification), assert/branch satisfiability, and E-graph
 * algebraic equivalence/contradiction checking.
 *
 * Designed strictly for on-demand execution (`Context.verifyFormal`, `msx lint --formal`,
 * `msx verify`, and LSP `modelscript/runFormalVerification`) so keystroke/save latency is
 * unaffected.
 */

import { type Range, StringWriter } from "@modelscript/dsl/utils";
import {
  analyzeStructuralDaeIndex,
  areDimensionsEqual,
  type ArenaBltResult,
  ArenaDAEPrinter,
  BinOp,
  Causality,
  ChcSystem,
  collectArenaExprDeps,
  DaeBltReachabilityEngine,
  DAEBuilder,
  DaeIntervalEvaluator,
  DIMENSION_DIMENSIONLESS,
  DIMENSION_TIME,
  type DimensionVector,
  DpllTSolver,
  EqKind,
  ExprKind,
  type ExprNode,
  formatDimension,
  HybridModeConsistencyVerifier,
  IC3Engine,
  InductiveProver,
  type InductiveSpec,
  initBltWasm,
  Interval,
  IntervalNewtonRootFinder,
  type NonlinearConstraint,
  NumericalInterval,
  OctagonDBMF64,
  performBltTransformationArena,
  PolyglotDriftChecker,
  type PolyglotModelSource,
  RelationalVerifier,
  simplifyArenaExpr,
  SosBarrierSynthesizer,
  SpacerEngine,
  STANDARD_UNITS,
  type StlFormula,
  StlMonitor,
  type TrajectoryTrace,
  type TransitionSystem,
  Variability,
  VarType,
} from "@modelscript/runtime";
import type { Context } from "../context.js";
import { type DiagnosticSeverity, type ErrorCodeDef, type ModelicaDiagnostic, ModelicaErrorCode } from "../errors.js";
import type { CstNodeLike } from "../flattener/expressions/cst-utils.js";
import { ModelicaAlgorithmAnalyzer } from "./modelica-analyzer.js";
import { findCstNodesByType, ModelicaCFGLowerer } from "./modelica-cfg-lowerer.js";

/**
 * Extended formal diagnostic including owning class name and category metadata.
 */
export interface ModelicaFormalDiagnostic extends ModelicaDiagnostic {
  /** Modelica class name in which the formal finding occurred. */
  className: string;
  /** Formal engine category that emitted the diagnostic. */
  category:
    | "structural"
    | "abstract-interpretation"
    | "satisfiability"
    | "algebraic"
    | "hybrid"
    | "reachability"
    | "state-machine";
}

/**
 * Configuration options for on-demand `7xxx` formal verification.
 */
export interface FormalVerificationOptions {
  /** Restrict verification to specific class names (defaults to all top-level non-package classes). */
  classNames?: string[] | undefined;
  /** Enable structural DAE checks (`M7101..M7112`). Default: true. */
  structural?: boolean | undefined;
  /** Enable abstract interpretation & relational bounds (`M7201..M7213`). Default: true. */
  abstractInterpretation?: boolean | undefined;
  /** Enable assert, when, and branch guard satisfiability (`M7301..M7308`). Default: true. */
  satisfiability?: boolean | undefined;
  /** Enable hybrid mode consistency checks (`M7401..M7403`). Default: true. */
  hybrid?: boolean | undefined;
  /** Enable state machine guard/deadlock/IC3 reachability checks (`M7306`, `M7307`, `M7503`). Default: true. */
  stateMachine?: boolean | undefined;
  /** Enable validated continuous reachability flowpipe invariant checks (`M7601`). Default: true. */
  reachability?: boolean | undefined;
  /** Enable E-graph algebraic tautology/contradiction/redundancy (`M7701..M7703`). Default: true. */
  algebraic?: boolean | undefined;
  /** Minimum coupled BLT block size reported as a large algebraic loop (`M7105`). Default: 4. */
  largeLoopThreshold?: number | undefined;
  /** Reachability time horizon in seconds. Default: 1.0. */
  timeHorizon?: number | undefined;
  /** Per-class reachability time budget in milliseconds. Default: 2000. */
  budgetMs?: number | undefined;
}

/**
 * Summary counts and structured diagnostics returned by {@link verifyModelicaFormal}.
 */
export interface FormalVerificationResult {
  diagnostics: ModelicaFormalDiagnostic[];
  classesVerified: string[];
  durationMs: number;
  summary: {
    errors: number;
    warnings: number;
    info: number;
    structural: number;
    abstractInterpretation: number;
    satisfiability: number;
    hybrid: number;
    reachability: number;
    stateMachine: number;
    algebraic: number;
  };
}

function makeFormalDiag(
  def: ErrorCodeDef,
  className: string,
  category: ModelicaFormalDiagnostic["category"],
  range: Range | null,
  args: string[],
  severityOverride?: DiagnosticSeverity,
): ModelicaFormalDiagnostic {
  return {
    code: def.code,
    rule: def.rule,
    severity: severityOverride ?? def.severity,
    message: (def.message as (...a: string[]) => string)(...args),
    range,
    className,
    category,
  };
}

function nodeToRange(node: CstNodeLike | null | undefined): Range | null {
  if (!node) return null;
  if (node.startPosition && node.endPosition) {
    return {
      startIndex: node.startIndex ?? node.startOffset ?? 0,
      endIndex: node.endIndex ?? node.endOffset ?? 0,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
    };
  }
  return null;
}

function printArenaExprSafe(arena: DAEBuilder, exprId: number): string {
  if (exprId < 0) return "?";
  try {
    const out = new StringWriter();
    const printer = new ArenaDAEPrinter(out, arena, true);
    return printer.printExprToString(exprId);
  } catch {
    return `expr#${exprId}`;
  }
}

function printArenaEqSafe(arena: DAEBuilder, eqIdx: number): string {
  const lhs = arena.getEqLhs(eqIdx);
  const rhs = arena.getEqRhs(eqIdx);
  return `${printArenaExprSafe(arena, lhs)} = ${printArenaExprSafe(arena, rhs)}`;
}

function collectStateVarIndices(arena: DAEBuilder): Set<number> {
  const stateVars = new Set<number>();
  const scanDer = (exprId: number): void => {
    if (exprId < 0) return;
    const kind = arena.getExprKind(exprId);
    if (kind === ExprKind.Der) {
      const inner = arena.getExprData1(exprId);
      if (inner >= 0 && arena.getExprKind(inner) === ExprKind.Name) {
        const nameId = arena.getExprData1(inner);
        const vIdx = arena.lookupVariable(nameId);
        if (vIdx >= 0) stateVars.add(vIdx);
      }
      return;
    }
    if (kind === ExprKind.Unary || kind === ExprKind.Negate || kind === ExprKind.Pre) {
      scanDer(arena.getExprLeft(exprId));
    } else if (kind === ExprKind.Binary || kind === ExprKind.Subscript) {
      scanDer(arena.getExprLeft(exprId));
      scanDer(arena.getExprRight(exprId));
    } else if (kind === ExprKind.IfElse) {
      scanDer(arena.getExprData1(exprId));
      scanDer(arena.getExprLeft(exprId));
      scanDer(arena.getExprRight(exprId));
    } else if (kind === ExprKind.Call) {
      const count = arena.getExprRight(exprId);
      const base = arena.getExprLeft(exprId);
      for (let i = 0; i < count; i++) scanDer(base + i);
    }
  };

  for (let eq = 0; eq < arena.eqCount; eq++) {
    if (arena.isEqRemoved?.(eq)) continue;
    scanDer(arena.getEqLhs(eq));
    scanDer(arena.getEqRhs(eq));
  }
  return stateVars;
}

function isSimpleAliasEquation(arena: DAEBuilder, eqIdx: number): boolean {
  if (arena.getEqKind(eqIdx) !== EqKind.Simple) return false;
  const lhs = arena.getEqLhs(eqIdx);
  const rhs = arena.getEqRhs(eqIdx);
  return (
    lhs >= 0 &&
    rhs >= 0 &&
    arena.getExprKind(lhs) === ExprKind.Name &&
    arena.getExprKind(rhs) === ExprKind.Name &&
    arena.getExprData1(lhs) !== arena.getExprData1(rhs)
  );
}

/**
 * Checks structural singularity, subsystem balance, DAE index, algebraic loops,
 * missing iteration starts, and isolated variables using Pantelides + WASM BLT.
 */
async function checkStructuralFormal(
  arena: DAEBuilder,
  className: string,
  classRange: Range | null,
  largeLoopThreshold: number,
  classCst: CstNodeLike | null = null,
): Promise<{ diagnostics: ModelicaFormalDiagnostic[]; bltResult: ArenaBltResult | null }> {
  const diags: ModelicaFormalDiagnostic[] = [];
  if (arena.eqCount === 0 && arena.varCount === 0) {
    return { diagnostics: diags, bltResult: null };
  }

  // 1. Pryce Sigma-Matrix / Dulmage-Mendelsohn singularity & DAE index (M7101, M7102, M7103, M7110)
  try {
    const stateVars = collectStateVarIndices(arena);
    const indexAnalysis = analyzeStructuralDaeIndex(arena, stateVars);
    const sig = indexAnalysis.signatureMatrix;
    const unmatchedEqs = sig.eqIdxs.filter((_, row) => sig.rowMatch[row] === -1);
    const unmatchedVars = sig.varIdxs.filter((_, col) => sig.colMatch[col] === -1);

    if (unmatchedEqs.length > 0 && unmatchedVars.length > 0) {
      const eqPreview = unmatchedEqs
        .slice(0, 3)
        .map((e) => printArenaEqSafe(arena, e))
        .join("; ");
      const varPreview = unmatchedVars
        .slice(0, 3)
        .map((v) => arena.getVarName(v))
        .join(", ");
      diags.push(
        makeFormalDiag(ModelicaErrorCode.FORMAL_STRUCTURALLY_SINGULAR, className, "structural", classRange, [
          className,
          `${unmatchedEqs.length} unmatched equation(s) [${eqPreview}] and ${unmatchedVars.length} unmatched variable(s) [${varPreview}]`,
        ]),
      );
    } else if (unmatchedEqs.length > 0) {
      const eqPreview = unmatchedEqs
        .slice(0, 3)
        .map((e) => printArenaEqSafe(arena, e))
        .join("; ");
      diags.push(
        makeFormalDiag(ModelicaErrorCode.FORMAL_OVER_DETERMINED_SUBSYSTEM, className, "structural", classRange, [
          className,
          eqPreview,
        ]),
      );
    } else if (unmatchedVars.length > 0) {
      const varPreview = unmatchedVars
        .slice(0, 4)
        .map((v) => arena.getVarName(v))
        .join(", ");
      diags.push(
        makeFormalDiag(ModelicaErrorCode.FORMAL_UNDER_DETERMINED_SUBSYSTEM, className, "structural", classRange, [
          className,
          varPreview,
        ]),
      );
    }

    if (indexAnalysis.structuralIndex > 1) {
      diags.push(
        makeFormalDiag(ModelicaErrorCode.FORMAL_HIGH_INDEX_DAE, className, "structural", classRange, [
          className,
          String(indexAnalysis.structuralIndex),
        ]),
      );

      // M7104: Detect ambiguous dummy-derivative state selection when index > 1 and candidates lack stateSelect hints
      const candidateNames: string[] = [];
      for (let v = 0; v < arena.varCount; v++) {
        if (arena.isVarRemoved(v) || arena.isVarVirtual(v)) continue;
        if (arena.getVarType(v) !== VarType.Real) continue;
        const order = indexAnalysis.variableOrders?.get(v) ?? 0;
        if (!stateVars.has(v) && order <= 0) continue;
        const vn = arena.getVarName(v);
        if (!vn || vn.startsWith("$") || vn.includes(".der(")) continue;
        if (arena.getVarAttr(v, "stateSelect") === undefined) {
          candidateNames.push(vn);
        }
      }
      if (candidateNames.length >= 2) {
        diags.push(
          makeFormalDiag(ModelicaErrorCode.FORMAL_STATE_SELECTION_AMBIGUOUS, className, "structural", classRange, [
            className,
            candidateNames.slice(0, 5).join(", "),
          ]),
        );
      }
    }

    // M5052: Variable declares stateSelect = StateSelect.always but is neither differentiated nor selected as a state
    for (let v = 0; v < arena.varCount; v++) {
      if (arena.isVarRemoved(v) || arena.isVarVirtual(v)) continue;
      if (arena.getVarType(v) !== VarType.Real) continue;
      const ssExpr = arena.getVarAttr(v, "stateSelect");
      if (ssExpr === undefined) continue;
      const ssStr = printArenaExprSafe(arena, ssExpr).trim();
      if (
        ssStr === "StateSelect.always" ||
        ssStr.endsWith(".always") ||
        ssStr === "always" ||
        evalScalarLiteralNumber(arena, ssExpr) === 5
      ) {
        const order = indexAnalysis.variableOrders?.get(v) ?? 0;
        if (!stateVars.has(v) && order <= 0) {
          diags.push(
            makeFormalDiag(ModelicaErrorCode.STATESELECT_ALWAYS_NOT_STATE, className, "structural", classRange, [
              arena.getVarName(v),
            ]),
          );
        }
      }
    }
  } catch {
    // Structural index matrix is skipped when DAE contains only unsupported structures
  }

  // 2. Variable without equation incidence (M7108) & partial array equation coverage (M7107)
  const incidentVars = new Set<number>();
  for (let eq = 0; eq < arena.eqCount; eq++) {
    if (arena.isEqRemoved?.(eq)) continue;
    const kind = arena.getEqKind(eq);
    if (kind === EqKind.Connect) continue;
    collectArenaExprDeps(arena, arena.getEqLhs(eq), incidentVars, false);
    collectArenaExprDeps(arena, arena.getEqRhs(eq), incidentVars, false);
  }
  for (let v = 0; v < arena.varCount; v++) {
    const bExpr = arena.getVarBindingExpr(v);
    if (bExpr !== undefined) collectArenaExprDeps(arena, bExpr, incidentVars, false);
  }

  for (let v = 0; v < arena.varCount; v++) {
    if (arena.isVarRemoved(v) || arena.isVarVirtual(v)) continue;
    const varb = arena.getVarVariability(v);
    const caus = arena.getVarCausality(v);
    if (varb > Variability.Discrete || caus !== Causality.Local) continue;
    if (arena.getVarBindingExpr(v) !== undefined) continue;
    const name = arena.getVarName(v);
    if (!name || name.startsWith("$") || name.includes(".der(")) continue;
    if (!incidentVars.has(v)) {
      diags.push(
        makeFormalDiag(ModelicaErrorCode.FORMAL_VARIABLE_WITHOUT_EQUATION, className, "structural", classRange, [name]),
      );
    }
  }

  // M7107: Detect scalarized partial array coverage and symbolic for-loop bounds leaving elements uncovered
  {
    const arrayGroups = new Map<string, { covered: number[]; uncovered: string[] }>();
    for (let v = 0; v < arena.varCount; v++) {
      if (arena.isVarRemoved(v) || arena.isVarVirtual(v)) continue;
      if (arena.getVarVariability(v) > Variability.Discrete || arena.getVarCausality(v) !== Causality.Local) continue;
      if (arena.getVarBindingExpr(v) !== undefined) continue;
      const vn = arena.getVarName(v);
      const m = /^(.+)\[(\d+(?:,\d+)*)\]$/.exec(vn);
      if (!m) continue;
      const base = m[1]!;
      let grp = arrayGroups.get(base);
      if (!grp) {
        grp = { covered: [], uncovered: [] };
        arrayGroups.set(base, grp);
      }
      if (incidentVars.has(v)) grp.covered.push(v);
      else grp.uncovered.push(vn);
    }
    const emittedArrayNames = new Set<string>();
    for (const [base, grp] of arrayGroups.entries()) {
      if (grp.covered.length > 0 && grp.uncovered.length > 0) {
        emittedArrayNames.add(base);
        diags.push(
          makeFormalDiag(ModelicaErrorCode.FORMAL_ARRAY_EQUATION_UNBALANCED, className, "structural", classRange, [
            base,
            `element(s) ${grp.uncovered.slice(0, 4).join(", ")} lack defining equations while ${grp.covered.length} sibling element(s) are defined`,
          ]),
        );
      }
    }

    // Symbolic CST fallback (e.g. `parameter Integer N; Real x[N]; equation for i in 1:N-1 loop x[i] = ...`)
    if (classCst) {
      const symArrays = new Map<string, string>();
      const collectSymArrays = (n: CstNodeLike) => {
        if (!n) return;
        const nt = n.type || "";
        if (n !== classCst && (nt === "class_definition" || nt === "ClassDefinition")) return;
        if (nt === "component_clause" || nt === "ComponentClause") {
          const txt = String(n.text ?? "");
          const dm = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]/.exec(txt);
          if (dm && !/^(parameter|constant|input)\b/.test(txt.trimStart())) {
            symArrays.set(dm[1]!, dm[2]!);
          }
          return;
        }
        for (const ch of n.children ?? []) collectSymArrays(ch);
      };
      collectSymArrays(classCst);

      if (symArrays.size > 0) {
        const scanForEqs = (n: CstNodeLike) => {
          if (!n) return;
          const nt = n.type || "";
          if (n !== classCst && (nt === "class_definition" || nt === "ClassDefinition")) return;
          if (nt === "for_equation" || nt === "ForEquation") {
            const ft = String(n.text ?? "");
            const fm =
              /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+1\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*-\s*([0-9]+)\s+loop([\s\S]*?)end\s+for/.exec(
                ft.trim(),
              );
            if (fm) {
              const iterVar = fm[1]!;
              const symBound = fm[2]!;
              const delta = Number(fm[3]!);
              const bodyTxt = fm[4]!;
              for (const [arrName, arrDim] of symArrays.entries()) {
                if (arrDim === symBound && delta > 0 && !emittedArrayNames.has(arrName)) {
                  const lhsRe = new RegExp(`\\b${arrName}\\s*\\[\\s*${iterVar}\\s*\\]`);
                  if (lhsRe.test(bodyTxt)) {
                    emittedArrayNames.add(arrName);
                    diags.push(
                      makeFormalDiag(
                        ModelicaErrorCode.FORMAL_ARRAY_EQUATION_UNBALANCED,
                        className,
                        "structural",
                        classRange,
                        [arrName, `for-loop covers '1:${symBound}-${delta}' out of declared dimension '[${arrDim}]'`],
                      ),
                    );
                  }
                }
              }
            }
          }
          for (const ch of n.children ?? []) scanForEqs(ch);
        };
        scanForEqs(classCst);
      }
    }
  }

  // 3. BLT decomposition, coupled algebraic loops & tearing start attributes (M7105, M7112)
  let bltResult: ArenaBltResult | null = null;
  if (arena.eqCount > 0 && arena.varCount > 0) {
    try {
      await initBltWasm();
      const stateVars = collectStateVarIndices(arena);
      bltResult = performBltTransformationArena(arena, stateVars);
      const reportedTornVars = new Set<number>();

      for (const block of bltResult.blocks) {
        if (block.vars.length >= largeLoopThreshold) {
          const preview = block.vars
            .slice(0, 6)
            .map((v) => arena.getVarName(v))
            .join(", ");
          diags.push(
            makeFormalDiag(ModelicaErrorCode.FORMAL_LARGE_ALGEBRAIC_LOOP, className, "structural", classRange, [
              String(block.vars.length),
              block.vars.length > 6 ? `${preview}, ...` : preview,
            ]),
          );
        }
        if (block.vars.length > 1 && block.tearing?.tearingVars) {
          for (const tv of block.tearing.tearingVars) {
            if (reportedTornVars.has(tv)) continue;
            reportedTornVars.add(tv);
            if (arena.getVarAttr(tv, "start") === undefined) {
              diags.push(
                makeFormalDiag(
                  ModelicaErrorCode.FORMAL_ITERATION_VARIABLE_NO_START,
                  className,
                  "structural",
                  classRange,
                  [arena.getVarName(tv)],
                ),
              );
            }
          }
        }
      }
    } catch {
      bltResult = null;
    }
  }

  // 4. Initialization system balance & fixed=true conflict check (M7111)
  {
    let initialSimpleCount = 0;
    const initLhsVars = new Set<number>();
    for (let eq = 0; eq < arena.eqCount; eq++) {
      if (arena.isEqRemoved?.(eq)) continue;
      if (arena.getEqKind(eq) === EqKind.InitialSimple) {
        initialSimpleCount++;
        const lhs = arena.getEqLhs(eq);
        if (lhs >= 0 && arena.getExprKind(lhs) === ExprKind.Name) {
          const nameId = arena.getExprData1(lhs);
          const vIdx = arena.lookupVariable(nameId);
          if (vIdx >= 0) initLhsVars.add(vIdx);
        }
      }
    }

    if (initialSimpleCount > 0) {
      const stateVars = collectStateVarIndices(arena);
      let fixedStateCount = 0;
      const fixedConflicts: string[] = [];

      const isExplicitTrue = (exprId: number | undefined): boolean => {
        if (exprId === undefined || exprId < 0) return false;
        const k = arena.getExprKind(exprId);
        if (k === ExprKind.BoolLiteral) return arena.getExprData1(exprId) !== 0;
        if (k === ExprKind.IntLiteral) return arena.getExprData1(exprId) !== 0;
        if (k === ExprKind.RealLiteral) return arena.getExprRealValue(exprId) !== 0;
        return false;
      };

      for (const sv of stateVars) {
        if (arena.isVarRemoved(sv)) continue;
        const fixedExpr = arena.getVarAttr(sv, "fixed");
        const isFixed = isExplicitTrue(fixedExpr);
        if (isFixed) {
          fixedStateCount++;
          if (initLhsVars.has(sv)) {
            fixedConflicts.push(arena.getVarName(sv));
          }
        }
      }
      for (const lv of initLhsVars) {
        if (!stateVars.has(lv) && isExplicitTrue(arena.getVarAttr(lv, "fixed"))) {
          fixedConflicts.push(arena.getVarName(lv));
        }
      }

      if (fixedConflicts.length > 0) {
        diags.push(
          makeFormalDiag(ModelicaErrorCode.FORMAL_INITIALIZATION_UNBALANCED, className, "structural", classRange, [
            className,
            `variable(s) '${fixedConflicts.join(", ")}' have both fixed=true and initial equation assignment`,
          ]),
        );
      } else {
        let freeInitTargets = 0;
        for (let v = 0; v < arena.varCount; v++) {
          if (arena.isVarRemoved(v) || arena.isVarVirtual(v)) continue;
          const varb = arena.getVarVariability(v);
          const caus = arena.getVarCausality(v);
          if (varb > Variability.Discrete || caus === Causality.Input) continue;
          if (stateVars.has(v)) {
            if (!isExplicitTrue(arena.getVarAttr(v, "fixed"))) freeInitTargets++;
          } else if (varb === Variability.Discrete && !isExplicitTrue(arena.getVarAttr(v, "fixed"))) {
            freeInitTargets++;
          }
        }
        // Only flag when initial equations strictly exceed unfixed states + discrete states and algebraic equations aren't providing extra unknowns
        let activeSimpleCount = 0;
        let nonStateLocalVars = 0;
        for (let eq = 0; eq < arena.eqCount; eq++) {
          if (!arena.isEqRemoved?.(eq) && arena.getEqKind(eq) === EqKind.Simple) activeSimpleCount++;
        }
        for (let v = 0; v < arena.varCount; v++) {
          if (arena.isVarRemoved(v) || arena.isVarVirtual(v)) continue;
          if (arena.getVarVariability(v) <= Variability.Discrete && !stateVars.has(v)) nonStateLocalVars++;
        }
        const netInitialExcess =
          initialSimpleCount +
          activeSimpleCount -
          (freeInitTargets + nonStateLocalVars + stateVars.size - (stateVars.size - fixedStateCount));
        if (stateVars.size > 0 && initialSimpleCount > freeInitTargets && netInitialExcess > 0) {
          diags.push(
            makeFormalDiag(ModelicaErrorCode.FORMAL_INITIALIZATION_UNBALANCED, className, "structural", classRange, [
              className,
              `${initialSimpleCount} initial equation(s) exceed ${freeInitTargets} unfixed initialization variable(s)`,
            ]),
          );
        }
      }
    }
  }

  // 5. Ungrounded alias chain cycle detection (M7109)
  {
    const aliasEdges: Array<{ a: string; b: string; neg: boolean }> = [];
    const groundedVars = new Set<string>();

    const extractAliasVar = (exprId: number): { name: string; neg: boolean } | null => {
      if (exprId < 0) return null;
      const k = arena.getExprKind(exprId);
      if (k === ExprKind.Name) {
        const vIdx = arena.lookupVariable(arena.getExprData1(exprId));
        if (vIdx >= 0) return { name: arena.getVarName(vIdx), neg: false };
      } else if (k === ExprKind.Negate) {
        const inner = arena.getExprLeft(exprId);
        if (inner >= 0 && arena.getExprKind(inner) === ExprKind.Name) {
          const vIdx = arena.lookupVariable(arena.getExprData1(inner));
          if (vIdx >= 0) return { name: arena.getVarName(vIdx), neg: true };
        }
      }
      return null;
    };

    const collectArenaIdents = (exprId: number, out: Set<string>): void => {
      if (exprId < 0) return;
      const k = arena.getExprKind(exprId);
      if (k === ExprKind.Name) {
        const vIdx = arena.lookupVariable(arena.getExprData1(exprId));
        if (vIdx >= 0) out.add(arena.getVarName(vIdx));
        return;
      }
      if (k === ExprKind.Unary || k === ExprKind.Negate || k === ExprKind.Pre || k === ExprKind.Der) {
        collectArenaIdents(k === ExprKind.Der ? arena.getExprData1(exprId) : arena.getExprLeft(exprId), out);
      } else if (k === ExprKind.Binary || k === ExprKind.Subscript) {
        collectArenaIdents(arena.getExprLeft(exprId), out);
        collectArenaIdents(arena.getExprRight(exprId), out);
      } else if (k === ExprKind.IfElse) {
        collectArenaIdents(arena.getExprData1(exprId), out);
        collectArenaIdents(arena.getExprLeft(exprId), out);
        collectArenaIdents(arena.getExprRight(exprId), out);
      }
    };

    for (let v = 0; v < arena.varCount; v++) {
      if (arena.isVarVirtual(v)) continue;
      const vName = arena.getVarName(v);
      const varb = arena.getVarVariability(v);
      const caus = arena.getVarCausality(v);
      if (
        varb === Variability.Parameter ||
        varb === Variability.Constant ||
        caus === Causality.Input ||
        (arena.getVarExpression(v) ?? -1) >= 0
      ) {
        groundedVars.add(vName);
      }
    }

    for (let eq = 0; eq < arena.eqCount; eq++) {
      if (arena.isEqRemoved?.(eq) || arena.isEqInitial?.(eq)) continue;
      const kind = arena.getEqKind(eq);
      if (kind !== EqKind.Simple && kind !== EqKind.Connect) continue;
      const lhs = arena.getEqLhs(eq);
      const rhs = arena.getEqRhs(eq);
      const a = extractAliasVar(lhs);
      const b = extractAliasVar(rhs);
      if (a && b && (a.name !== b.name || a.neg !== b.neg)) {
        aliasEdges.push({ a: a.name, b: b.name, neg: a.neg !== b.neg });
      } else {
        collectArenaIdents(lhs, groundedVars);
        collectArenaIdents(rhs, groundedVars);
      }
    }

    // Supplement with direct CST equations because ModelicaFlattener eliminates positive alias cycles before returning arena
    if (classCst) {
      const stripSignIdent = (s: string): { name: string; neg: boolean } | null => {
        const t = s.trim();
        const m = /^(-)?\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/.exec(t);
        if (!m) return null;
        if (m[2] === "true" || m[2] === "false" || m[2] === "time") return null;
        return { name: m[2]!, neg: Boolean(m[1]) };
      };
      const cstEdgeSet = new Set(aliasEdges.map((e) => `${e.a}\0${e.b}\0${e.neg ? 1 : 0}`));
      const scanCstEqs = (node: CstNodeLike, inInitOrWhen: boolean): void => {
        if (!node) return;
        const nt = node.type || "";
        if (node !== classCst && (nt === "class_definition" || nt === "ClassDefinition")) return;
        if (nt === "equation_section" && (node.text || "").trimStart().startsWith("initial")) return;
        const nextFlag = inInitOrWhen || nt === "when_equation" || nt === "if_equation";
        if (nt === "simple_equation" || nt === "SimpleEquation") {
          const eqTxt = (node.text || "").trim();
          const eqIdx = eqTxt.indexOf("=");
          if (
            eqIdx > 0 &&
            eqTxt[eqIdx - 1] !== "<" &&
            eqTxt[eqIdx - 1] !== ">" &&
            eqTxt[eqIdx - 1] !== "!" &&
            eqTxt[eqIdx + 1] !== "="
          ) {
            const lhsTxt = eqTxt.slice(0, eqIdx);
            const rhsTxt = eqTxt.slice(eqIdx + 1);
            const l = stripSignIdent(lhsTxt);
            const r = stripSignIdent(rhsTxt);
            if (!nextFlag && l && r && (l.name !== r.name || l.neg !== r.neg)) {
              const fwd = `${l.name}\0${r.name}\0${l.neg !== r.neg ? 1 : 0}`;
              if (!cstEdgeSet.has(fwd)) {
                cstEdgeSet.add(fwd);
                aliasEdges.push({ a: l.name, b: r.name, neg: l.neg !== r.neg });
              }
            } else {
              for (const tok of eqTxt.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
                groundedVars.add(tok);
              }
            }
          }
          return;
        }
        for (const ch of node.children ?? []) scanCstEqs(ch, nextFlag);
      };
      scanCstEqs(classCst, false);
    }

    if (aliasEdges.length > 0) {
      const adj = new Map<string, Set<string>>();
      const selfSignNeg = new Set<string>();
      for (const e of aliasEdges) {
        if (!adj.has(e.a)) adj.set(e.a, new Set());
        if (!adj.has(e.b)) adj.set(e.b, new Set());
        adj.get(e.a)!.add(e.b);
        adj.get(e.b)!.add(e.a);
        if (e.a === e.b && e.neg) selfSignNeg.add(e.a);
      }
      const visited = new Set<string>();
      for (const start of adj.keys()) {
        if (visited.has(start)) continue;
        const compVars: string[] = [];
        const stack = [start];
        visited.add(start);
        while (stack.length > 0) {
          const cur = stack.pop()!;
          compVars.push(cur);
          for (const nxt of adj.get(cur) ?? []) {
            if (!visited.has(nxt)) {
              visited.add(nxt);
              stack.push(nxt);
            }
          }
        }
        const compSet = new Set(compVars);
        let compEdges = 0;
        for (const e of aliasEdges) {
          if (compSet.has(e.a) && compSet.has(e.b)) compEdges++;
        }
        const hasCycle =
          (compVars.length >= 2 && compEdges >= compVars.length) ||
          (compVars.length === 1 && selfSignNeg.has(compVars[0]!));
        if (hasCycle && !compVars.some((v) => groundedVars.has(v))) {
          diags.push(
            makeFormalDiag(ModelicaErrorCode.FORMAL_ALIAS_CYCLE_NO_SOURCE, className, "structural", classRange, [
              className,
              [...compVars].sort().join(", "),
            ]),
          );
        }
      }
    }
  }

  return { diagnostics: diags, bltResult };
}

function evalScalarLiteralNumber(arena: DAEBuilder, exprId: number): number | null {
  if (exprId < 0) return null;
  const k = arena.getExprKind(exprId);
  if (k === ExprKind.RealLiteral) return arena.getExprRealValue(exprId);
  if (k === ExprKind.IntLiteral) return arena.getExprData1(exprId);
  if (k === ExprKind.Negate) {
    const inner = evalScalarLiteralNumber(arena, arena.getExprLeft(exprId));
    return inner !== null ? -inner : null;
  }
  return null;
}

/**
 * Extracts linear octagon constraints (±v_i ± v_j <= c or unary bounds) from scalar
 * bindings and `assert(...)` relational equations into an `OctagonDBMF64`.
 */
function buildParameterOctagon(
  arena: DAEBuilder,
  evaluator: DaeIntervalEvaluator,
): { oct: OctagonDBMF64; varToOctIdx: Map<number, number>; octIdxToName: string[] } {
  const varToOctIdx = new Map<number, number>();
  const octIdxToName: string[] = [];

  for (let v = 0; v < arena.varCount; v++) {
    if (arena.isVarRemoved(v)) continue;
    varToOctIdx.set(v, octIdxToName.length);
    octIdxToName.push(arena.getVarName(v));
  }

  const oct = new OctagonDBMF64(Math.max(1, octIdxToName.length));

  const resolveVarOct = (exprId: number): number | null => {
    if (exprId < 0 || arena.getExprKind(exprId) !== ExprKind.Name) return null;
    const vIdx = arena.lookupVariable(arena.getExprData1(exprId));
    if (vIdx < 0) return null;
    return varToOctIdx.get(vIdx) ?? null;
  };

  // Helper: decompose `x + c` or `x - c` or `x` into `{ varIdx, offset }`
  const asShiftedVar = (exprId: number): { octVar: number; offset: number } | null => {
    const direct = resolveVarOct(exprId);
    if (direct !== null) return { octVar: direct, offset: 0 };
    if (exprId >= 0 && arena.getExprKind(exprId) === ExprKind.Binary) {
      const op = arena.getExprData1(exprId);
      const l = arena.getExprLeft(exprId);
      const r = arena.getExprRight(exprId);
      if (op === BinOp.Add || op === BinOp.Sub) {
        const lv = resolveVarOct(l);
        const rn = evalScalarLiteralNumber(arena, r);
        if (lv !== null && rn !== null) {
          return { octVar: lv, offset: op === BinOp.Add ? rn : -rn };
        }
        if (op === BinOp.Add) {
          const rv = resolveVarOct(r);
          const ln = evalScalarLiteralNumber(arena, l);
          if (rv !== null && ln !== null) return { octVar: rv, offset: ln };
        }
      }
    }
    return null;
  };

  const applyRelationToOctagon = (exprId: number, octTarget: OctagonDBMF64): void => {
    if (exprId < 0 || arena.getExprKind(exprId) !== ExprKind.Binary) return;
    const op = arena.getExprData1(exprId);
    const l = arena.getExprLeft(exprId);
    const r = arena.getExprRight(exprId);

    if (op === BinOp.And) {
      applyRelationToOctagon(l, octTarget);
      applyRelationToOctagon(r, octTarget);
      return;
    }

    const eps = op === BinOp.Lt || op === BinOp.Gt ? -1e-9 : 0;
    if (op === BinOp.Lt || op === BinOp.Lte || op === BinOp.Eq || op === BinOp.Gt || op === BinOp.Gte) {
      // Normalize to `lhs <= rhs` (or both directions for `==`)
      const pairs: Array<[number, number, number]> = [];
      if (op === BinOp.Lt || op === BinOp.Lte || op === BinOp.Eq) pairs.push([l, r, eps]);
      if (op === BinOp.Gt || op === BinOp.Gte || op === BinOp.Eq) pairs.push([r, l, eps]);

      for (const [lhsExpr, rhsExpr, slack] of pairs) {
        const svL = asShiftedVar(lhsExpr);
        const rn = evalScalarLiteralNumber(arena, rhsExpr);
        if (svL && rn !== null) {
          // svL.octVar + svL.offset <= rn + slack  =>  svL.octVar <= rn - svL.offset + slack
          const p = svL.octVar * 2;
          octTarget.setBound(p, p + 1, (rn - svL.offset + slack) * 2);
          continue;
        }
        const svR = asShiftedVar(rhsExpr);
        const ln = evalScalarLiteralNumber(arena, lhsExpr);
        if (svR && ln !== null) {
          // ln <= svR.octVar + svR.offset + slack => -svR.octVar <= svR.offset - ln + slack
          const p = svR.octVar * 2;
          octTarget.setBound(p + 1, p, (svR.offset - ln + slack) * 2);
          continue;
        }
        if (svL && svR) {
          // x + o1 <= y + o2 + slack  =>  x - y <= o2 - o1 + slack
          const bound = svR.offset - svL.offset + slack;
          const p1 = svL.octVar * 2;
          const p2 = svR.octVar * 2;
          octTarget.setBound(p1, p2, bound);
          octTarget.setBound(p2 + 1, p1 + 1, bound);
        }
      }
    }
  };

  // Seed min/max and constant binding intervals into octagon
  for (let v = 0; v < arena.varCount; v++) {
    const octVar = varToOctIdx.get(v);
    if (octVar === undefined) continue;
    const minExpr = arena.getVarAttr(v, "min");
    const maxExpr = arena.getVarAttr(v, "max");
    const lo = minExpr !== undefined ? evaluator.evaluateExpr(minExpr).interval.low : -Infinity;
    const hi = maxExpr !== undefined ? evaluator.evaluateExpr(maxExpr).interval.high : Infinity;
    if (Number.isFinite(lo) || Number.isFinite(hi)) {
      const p = octVar * 2;
      if (Number.isFinite(hi)) oct.setBound(p, p + 1, hi * 2);
      if (Number.isFinite(lo)) oct.setBound(p + 1, p, -lo * 2);
    }

    const bindExpr = arena.getVarBindingExpr(v);
    if (bindExpr !== undefined) {
      const bindIv = evaluator.evaluateExpr(bindExpr).interval;
      if (Number.isFinite(bindIv.low) && Number.isFinite(bindIv.high)) {
        const p = octVar * 2;
        oct.setBound(p, p + 1, bindIv.high * 2);
        oct.setBound(p + 1, p, -bindIv.low * 2);
      }
      // Also record affine offset `v = q + c` in octagon for relational propagation
      if (arena.getExprKind(bindExpr) === ExprKind.Binary || arena.getExprKind(bindExpr) === ExprKind.Name) {
        const shifted = asShiftedVar(bindExpr);
        if (shifted && shifted.octVar !== octVar) {
          const p1 = octVar * 2;
          const p2 = shifted.octVar * 2;
          oct.setBound(p1, p2, shifted.offset);
          oct.setBound(p2 + 1, p1 + 1, shifted.offset);
          oct.setBound(p2, p1, -shifted.offset);
          oct.setBound(p1 + 1, p2 + 1, -shifted.offset);
        }
      }
    }
  }

  // Incorporate relational assert equations (e.g. `assert(p <= q, ...)` or `assert(p >= 10, ...)`)
  for (let eq = 0; eq < arena.eqCount; eq++) {
    if (arena.isEqRemoved?.(eq)) continue;
    const k = arena.getEqKind(eq);
    if (k === EqKind.FunctionCall || k === EqKind.InitialFunctionCall) {
      const callExpr = arena.getEqLhs(eq);
      if (callExpr >= 0 && arena.getExprKind(callExpr) === ExprKind.Call) {
        const fnName = arena.interner.resolve(arena.getExprData1(callExpr));
        const argCount = arena.getExprRight(callExpr);
        if (fnName === "assert" && argCount >= 1) {
          applyRelationToOctagon(arena.getExprLeft(callExpr), oct);
        }
      }
    }
  }

  oct.close();
  return { oct, varToOctIdx, octIdxToName };
}

function checkOctagonSat(oct: OctagonDBMF64): boolean {
  const cloned = oct.clone();
  cloned.close();
  if (cloned.hasNegativeCycle()) return false;
  for (let i = 0; i < cloned.numVars; i++) {
    if (cloned.getLowerBound(i) > cloned.getUpperBound(i) + 1e-12) return false;
  }
  return true;
}

/**
 * Evaluates a boolean condition expression over interval bounds and octagon relational constraints.
 * Returns `"true"` (always valid), `"false"` (unsatisfiable), or `"unknown"`.
 */
function evaluateConditionTruth(
  arena: DAEBuilder,
  evaluator: DaeIntervalEvaluator,
  oct: OctagonDBMF64,
  varToOctIdx: Map<number, number>,
  condExprId: number,
): "true" | "false" | "unknown" {
  if (condExprId < 0) return "unknown";
  const k = arena.getExprKind(condExprId);
  if (k === ExprKind.BoolLiteral) {
    return arena.getExprData1(condExprId) !== 0 ? "true" : "false";
  }

  if (k === ExprKind.Unary && arena.getExprData1(condExprId) === 1 /* Not */) {
    const inner = evaluateConditionTruth(arena, evaluator, oct, varToOctIdx, arena.getExprLeft(condExprId));
    if (inner === "true") return "false";
    if (inner === "false") return "true";
    return "unknown";
  }

  if (k === ExprKind.Binary) {
    const op = arena.getExprData1(condExprId);
    const l = arena.getExprLeft(condExprId);
    const r = arena.getExprRight(condExprId);

    if (op === BinOp.And) {
      const lt = evaluateConditionTruth(arena, evaluator, oct, varToOctIdx, l);
      const rt = evaluateConditionTruth(arena, evaluator, oct, varToOctIdx, r);
      if (lt === "false" || rt === "false") return "false";
      if (lt === "true" && rt === "true") return "true";
      return "unknown";
    }
    if (op === BinOp.Or) {
      const lt = evaluateConditionTruth(arena, evaluator, oct, varToOctIdx, l);
      const rt = evaluateConditionTruth(arena, evaluator, oct, varToOctIdx, r);
      if (lt === "true" || rt === "true") return "true";
      if (lt === "false" && rt === "false") return "false";
      return "unknown";
    }

    const lIv = evaluator.evaluateExpr(l).interval;
    const rIv = evaluator.evaluateExpr(r).interval;

    // Interval comparison when neither side is [-Inf, +Inf]
    if (!lIv.isBottom() && !rIv.isBottom()) {
      switch (op) {
        case BinOp.Lt:
          if (lIv.high < rIv.low) return "true";
          if (lIv.low >= rIv.high) return "false";
          break;
        case BinOp.Lte:
          if (lIv.high <= rIv.low) return "true";
          if (lIv.low > rIv.high) return "false";
          break;
        case BinOp.Gt:
          if (lIv.low > rIv.high) return "true";
          if (lIv.high <= rIv.low) return "false";
          break;
        case BinOp.Gte:
          if (lIv.low >= rIv.high) return "true";
          if (lIv.high < rIv.low) return "false";
          break;
        case BinOp.Eq:
          if (lIv.low === lIv.high && rIv.low === rIv.high && lIv.low === rIv.low) return "true";
          if (lIv.high < rIv.low || rIv.high < lIv.low) return "false";
          break;
        case BinOp.Neq:
          if (lIv.high < rIv.low || rIv.high < lIv.low) return "true";
          if (lIv.low === lIv.high && rIv.low === rIv.high && lIv.low === rIv.low) return "false";
          break;
      }
    }

    // Relational octagon check for `v1 op v2` when intervals overlap
    if (
      arena.getExprKind(l) === ExprKind.Name &&
      arena.getExprKind(r) === ExprKind.Name &&
      (op === BinOp.Lt || op === BinOp.Lte || op === BinOp.Gt || op === BinOp.Gte)
    ) {
      const lv = arena.lookupVariable(arena.getExprData1(l));
      const rv = arena.lookupVariable(arena.getExprData1(r));
      const ov1 = varToOctIdx.get(lv);
      const ov2 = varToOctIdx.get(rv);
      if (ov1 !== undefined && ov2 !== undefined) {
        if (!checkOctagonSat(oct)) return "unknown";
        const diff = oct.getBound(ov1 * 2, ov2 * 2); // upper bound on (v1 - v2)
        const revDiff = oct.getBound(ov2 * 2, ov1 * 2); // upper bound on (v2 - v1)
        if (op === BinOp.Lt) {
          if (diff < -1e-12) return "true";
          if (revDiff <= 0) return "false";
        } else if (op === BinOp.Lte) {
          if (diff <= 0) return "true";
          if (revDiff < -1e-12) return "false";
        } else if (op === BinOp.Gt) {
          if (revDiff < -1e-12) return "true";
          if (diff <= 0) return "false";
        } else if (op === BinOp.Gte) {
          if (revDiff <= 0) return "true";
          if (diff < -1e-12) return "false";
        }
      }
    }
  }

  return "unknown";
}

function checkAbstractInterpAndSatFormal(
  arena: DAEBuilder,
  bltResult: ArenaBltResult | null,
  className: string,
  classCst: CstNodeLike | null | undefined,
  classRange: Range | null,
  options: FormalVerificationOptions,
): ModelicaFormalDiagnostic[] {
  const diags: ModelicaFormalDiagnostic[] = [];
  const runAbstract = options.abstractInterpretation !== false;
  const runSat = options.satisfiability !== false;
  if (!runAbstract && !runSat) return diags;

  const evaluator = new DaeIntervalEvaluator(arena, { checkAttributes: true });
  const { oct, varToOctIdx, octIdxToName } = buildParameterOctagon(arena, evaluator);

  // Feed tightened octagon bounds back into the interval evaluator
  const tightenedBounds = new Map<number, NumericalInterval>();
  if (!oct.hasNegativeCycle()) {
    for (const [vIdx, octIdx] of varToOctIdx) {
      const lo = oct.getLowerBound(octIdx);
      const hi = oct.getUpperBound(octIdx);
      if (Number.isFinite(lo) || Number.isFinite(hi)) {
        const iv = new NumericalInterval(Number.isFinite(lo) ? lo : -Infinity, Number.isFinite(hi) ? hi : Infinity);
        evaluator.setVarBound(vIdx, iv);
        tightenedBounds.set(vIdx, iv);
      }
    }
  }

  if (runAbstract) {
    // 1. Relational octagon contradiction check (M7210)
    if (oct.hasNegativeCycle()) {
      diags.push(
        makeFormalDiag(
          ModelicaErrorCode.FORMAL_PARAMETER_BOUND_CONTRADICTION,
          className,
          "abstract-interpretation",
          classRange,
          [className, "negative cycle in relational bound difference matrix"],
        ),
      );
    } else {
      for (let i = 0; i < oct.numVars; i++) {
        const lo = oct.getLowerBound(i);
        const hi = oct.getUpperBound(i);
        if (lo > hi + 1e-12) {
          const varName = octIdxToName[i] ?? `var#${i}`;
          diags.push(
            makeFormalDiag(
              ModelicaErrorCode.FORMAL_PARAMETER_BOUND_CONTRADICTION,
              className,
              "abstract-interpretation",
              classRange,
              [className, `derived lower bound ${lo} > upper bound ${hi} for '${varName}'`],
            ),
          );
          break;
        }
      }
    }

    // 2. Static binding and start-attribute interval checks against min/max (M7208, M7209)
    for (let v = 0; v < arena.varCount; v++) {
      if (arena.isVarRemoved(v)) continue;
      const minExpr = arena.getVarAttr(v, "min");
      const maxExpr = arena.getVarAttr(v, "max");
      if (minExpr === undefined && maxExpr === undefined) continue;

      const minLo = minExpr !== undefined ? evaluator.evaluateExpr(minExpr).interval.low : -Infinity;
      const maxHi = maxExpr !== undefined ? evaluator.evaluateExpr(maxExpr).interval.high : Infinity;
      const boundsStr = `[${Number.isFinite(minLo) ? minLo : "-inf"}, ${Number.isFinite(maxHi) ? maxHi : "+inf"}]`;
      const varName = arena.getVarName(v);

      const bindExpr = arena.getVarBindingExpr(v);
      if (bindExpr !== undefined) {
        const bIv = evaluator.evaluateExpr(bindExpr).interval;
        if (!bIv.isBottom() && Number.isFinite(bIv.low) && Number.isFinite(bIv.high)) {
          if (bIv.high < minLo || bIv.low > maxHi) {
            const valStr = bIv.low === bIv.high ? String(bIv.low) : `[${bIv.low}, ${bIv.high}]`;
            diags.push(
              makeFormalDiag(
                ModelicaErrorCode.FORMAL_BINDING_OUTSIDE_MIN_MAX,
                className,
                "abstract-interpretation",
                classRange,
                [varName, valStr, boundsStr],
              ),
            );
          }
        }
      }

      const startExpr = arena.getVarAttr(v, "start");
      if (startExpr !== undefined && startExpr !== bindExpr) {
        const sIv = evaluator.evaluateExpr(startExpr).interval;
        if (!sIv.isBottom() && Number.isFinite(sIv.low) && Number.isFinite(sIv.high)) {
          if (sIv.high < minLo || sIv.low > maxHi) {
            const valStr = sIv.low === sIv.high ? String(sIv.low) : `[${sIv.low}, ${sIv.high}]`;
            diags.push(
              makeFormalDiag(
                ModelicaErrorCode.FORMAL_START_OUTSIDE_MIN_MAX,
                className,
                "abstract-interpretation",
                classRange,
                [varName, valStr, boundsStr],
              ),
            );
          }
        }
      }
    }

    // 3. BLT-driven DAE interval/affine reachability + direct active-equation singularity & bound verification (M7201..M7205, M7211, M7213, M7601)
    const runReachability = options.reachability !== false;
    const flowpipeWitnessVars = new Set<string>();
    const seenIssueKeys = new Set<string>();
    type SingularityIssue = ReturnType<DaeIntervalEvaluator["evaluateAllEquations"]>["issues"][number];
    const emitSingularityIssue = (issue: SingularityIssue): void => {
      if (
        (issue.kind === "min_bound_violation" || issue.kind === "max_bound_violation") &&
        issue.varName &&
        flowpipeWitnessVars.has(issue.varName)
      ) {
        return;
      }
      const key = `${issue.kind}:${issue.varName ?? ""}:${issue.exprId}`;
      if (seenIssueKeys.has(key)) return;
      seenIssueKeys.add(key);

      const sev: DiagnosticSeverity = issue.severity === "definite" ? "error" : "warning";
      const ivStr = `[${issue.interval.low}, ${issue.interval.high}]`;
      const exprText =
        issue.exprId >= 0
          ? printArenaExprSafe(arena, issue.exprId)
          : issue.eqIdx !== undefined
            ? printArenaEqSafe(arena, issue.eqIdx)
            : className;

      if (issue.kind === "div_by_zero") {
        diags.push(
          makeFormalDiag(
            ModelicaErrorCode.FORMAL_POSSIBLE_DIVISION_BY_ZERO,
            className,
            "abstract-interpretation",
            classRange,
            [exprText, ivStr],
            sev,
          ),
        );
      } else if (issue.kind === "sqrt_negative") {
        diags.push(
          makeFormalDiag(
            ModelicaErrorCode.FORMAL_SQRT_OF_NEGATIVE,
            className,
            "abstract-interpretation",
            classRange,
            [exprText, ivStr],
            sev,
          ),
        );
      } else if (issue.kind === "log_nonpositive") {
        diags.push(
          makeFormalDiag(
            ModelicaErrorCode.FORMAL_LOG_OF_NONPOSITIVE,
            className,
            "abstract-interpretation",
            classRange,
            [exprText, ivStr],
            sev,
          ),
        );
      } else if (issue.kind === "inverse_trig_domain") {
        diags.push(
          makeFormalDiag(
            ModelicaErrorCode.FORMAL_INVERSE_TRIG_DOMAIN,
            className,
            "abstract-interpretation",
            classRange,
            [exprText, ivStr],
            sev,
          ),
        );
      } else if (issue.kind === "pow_domain_violation") {
        diags.push(
          makeFormalDiag(
            ModelicaErrorCode.FORMAL_POW_DOMAIN_VIOLATION,
            className,
            "abstract-interpretation",
            classRange,
            [exprText, ivStr],
            sev,
          ),
        );
      } else if (issue.kind === "singular_algebraic_loop") {
        const blockLabel = issue.varName ?? exprText;
        diags.push(
          makeFormalDiag(
            ModelicaErrorCode.FORMAL_NUMERICALLY_SINGULAR_LOOP,
            className,
            "structural",
            classRange,
            [blockLabel, ivStr],
            sev,
          ),
        );
      } else if (issue.kind === "min_bound_violation" || issue.kind === "max_bound_violation") {
        const vIdx = issue.varIdx ?? (issue.varName ? arena.getVarIdxByName(issue.varName) : -1);
        const minExpr = vIdx >= 0 ? arena.getVarAttr(vIdx, "min") : undefined;
        const maxExpr = vIdx >= 0 ? arena.getVarAttr(vIdx, "max") : undefined;
        const loB = minExpr !== undefined ? evaluator.evaluateExpr(minExpr).interval.low : -Infinity;
        const hiB = maxExpr !== undefined ? evaluator.evaluateExpr(maxExpr).interval.high : Infinity;
        diags.push(
          makeFormalDiag(
            ModelicaErrorCode.FORMAL_REACHABLE_BOUND_VIOLATION,
            className,
            "abstract-interpretation",
            classRange,
            [
              issue.varName ?? exprText,
              ivStr,
              `[${Number.isFinite(loB) ? loB : "-inf"}, ${Number.isFinite(hiB) ? hiB : "+inf"}]`,
            ],
            sev,
          ),
        );
      }
    };

    const solvedVarBounds = new Map<number, NumericalInterval>(tightenedBounds);
    const hasDifferentialStates = collectStateVarIndices(arena).size > 0;
    if ((bltResult && bltResult.blocks.length > 0) || hasDifferentialStates) {
      const effectiveBlt: ArenaBltResult =
        bltResult ??
        ({
          blocks: [],
          unmatchedEqs: [],
          unmatchedVars: [],
          residualEqs: [],
          structuralIndex: 0,
        } as unknown as ArenaBltResult);
      const reachEngine = new DaeBltReachabilityEngine(arena, {
        initialBounds: tightenedBounds,
        timeHorizon: options.timeHorizon ?? 1.0,
        budgetMs: options.budgetMs ?? 2000,
        evaluatorOptions: { checkAttributes: true },
        recordTrajectory: true,
      });
      const reachSummary = reachEngine.verify(effectiveBlt);
      for (const [vIdx, b] of reachSummary.variableBounds) {
        if (!b.isBottom() && Number.isFinite(b.low) && Number.isFinite(b.high)) {
          solvedVarBounds.set(vIdx, b);
        }
      }
      if (runReachability && reachSummary.continuousReachResult?.verdict.kind === "violated") {
        const horizonStr = String(options.timeHorizon ?? 1.0);
        const stateIndices = Array.from(collectStateVarIndices(arena));
        for (const v of reachSummary.continuousReachResult.violations) {
          const sv = stateIndices[v.stateIndex];
          const varLabel = sv !== undefined ? arena.getVarName(sv) : `state#${v.stateIndex}`;
          flowpipeWitnessVars.add(varLabel);
          diags.push(
            makeFormalDiag(ModelicaErrorCode.FORMAL_PHYSICAL_BOUND_FLOWPIPE, className, "reachability", classRange, [
              varLabel,
              String(v.worstCaseValue),
              `${v.operator} ${v.limitValue}`,
              Number.isFinite(v.time) ? String(v.time) : horizonStr,
            ]),
          );
        }
      }

      // M7603: Quantitative STL monitoring of __ModelScript_requirement temporal formulas over continuous tubes
      if (runReachability && classCst) {
        const horizon = options.timeHorizon ?? 1.0;
        const stlTextCandidates: string[] = [];
        const scanStlAnnotations = (n: CstNodeLike) => {
          if (!n) return;
          if (n !== classCst && n.type === "class_definition") return;
          if (n.type === "element_modification") {
            const nameNode = n.childForFieldName?.("name") ?? n.children?.find((c: CstNodeLike) => c.type === "name");
            if (nameNode?.text?.trim() === "__ModelScript_requirement") {
              const modNode =
                n.childForFieldName?.("modification") ??
                n.children?.find((c: CstNodeLike) => c.type === "modification");
              const raw = modNode?.text?.trim() ?? "";
              const eqPos = raw.indexOf("=");
              let exprTxt = eqPos >= 0 ? raw.slice(eqPos + 1).trim() : raw;
              if (exprTxt.startsWith('"') && exprTxt.endsWith('"') && exprTxt.length >= 2) {
                exprTxt = exprTxt.slice(1, -1);
              }
              if (exprTxt) stlTextCandidates.push(exprTxt);
              return;
            }
          }
          for (const ch of n.children ?? []) scanStlAnnotations(ch);
        };
        scanStlAnnotations(classCst);

        for (const stlRaw of stlTextCandidates) {
          const m =
            /^(G|Always|F|Eventually)\[\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*\]\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(<=|>=|<|>)\s*(-?[0-9]+(?:\.[0-9]+)?)\s*\)$/.exec(
              stlRaw.trim(),
            );
          if (!m) continue;
          const tempKind = m[1] === "G" || m[1] === "Always" ? "always" : "eventually";
          const tA = Number(m[2]);
          const tB = Number(m[3]);
          const sigName = m[4]!;
          const cmpOp = m[5]! as "<=" | ">=" | "<" | ">";
          const limit = Number(m[6]);
          const isUpperBound = cmpOp === "<=" || cmpOp === "<";

          let vTarget = -1;
          for (let v = 0; v < arena.varCount; v++) {
            if (!arena.isVarRemoved(v) && arena.getVarName(v) === sigName) {
              vTarget = v;
              break;
            }
          }
          if (vTarget < 0) continue;

          const trajEntry = reachSummary.trajectories?.get(sigName);
          const existingTraj = trajEntry?.taylor ?? trajEntry?.zonotope ?? trajEntry?.interval;
          let timeArr: number[] = [];
          let valArr: number[] = [];

          if (existingTraj && existingTraj.time.length >= 2) {
            timeArr = existingTraj.time;
            valArr = isUpperBound ? existingTraj.upper : existingTraj.lower;
          } else {
            let x0Iv = tightenedBounds.get(vTarget) ?? reachSummary.stateEnclosures.get(vTarget);
            if (!x0Iv || x0Iv.isBottom() || !Number.isFinite(x0Iv.low) || !Number.isFinite(x0Iv.high)) {
              for (let eq = 0; eq < arena.eqCount; eq++) {
                if (arena.isEqRemoved?.(eq) || arena.getEqKind(eq) !== EqKind.InitialSimple) continue;
                const lhs = arena.getEqLhs(eq);
                const rhs = arena.getEqRhs(eq);
                if (
                  lhs >= 0 &&
                  arena.getExprKind(lhs) === ExprKind.Name &&
                  arena.lookupVariable(arena.getExprData1(lhs)) === vTarget
                ) {
                  x0Iv = evaluator.evaluateExpr(rhs).interval;
                  break;
                }
              }
            }
            if (!x0Iv || x0Iv.isBottom() || !Number.isFinite(x0Iv.low) || !Number.isFinite(x0Iv.high)) {
              const stVal = arena.getVarStartValue(vTarget);
              if (Number.isFinite(stVal)) {
                x0Iv = new NumericalInterval(stVal, stVal);
              }
            }

            let derivIv: NumericalInterval | null = null;
            for (let eq = 0; eq < arena.eqCount; eq++) {
              if (arena.isEqRemoved?.(eq) || arena.isEqInitial?.(eq) || arena.getEqKind(eq) !== EqKind.Simple) continue;
              const lhs = arena.getEqLhs(eq);
              const rhs = arena.getEqRhs(eq);
              const isTargetDer = (e: number): boolean => {
                if (e < 0 || arena.getExprKind(e) !== ExprKind.Der) return false;
                const inner = arena.getExprData1(e);
                return (
                  inner >= 0 &&
                  arena.getExprKind(inner) === ExprKind.Name &&
                  arena.lookupVariable(arena.getExprData1(inner)) === vTarget
                );
              };
              if (isTargetDer(lhs)) {
                derivIv = evaluator.evaluateExpr(rhs).interval;
                break;
              }
              if (isTargetDer(rhs)) {
                derivIv = evaluator.evaluateExpr(lhs).interval;
                break;
              }
            }

            const xEndIv = solvedVarBounds.get(vTarget) ?? x0Iv;
            if (x0Iv && !x0Iv.isBottom() && Number.isFinite(x0Iv.low) && Number.isFinite(x0Iv.high)) {
              const x0 = isUpperBound ? x0Iv.high : x0Iv.low;
              const tMax = Math.max(horizon, tB);
              let x1Raw = x0;
              if (derivIv && !derivIv.isBottom() && Number.isFinite(derivIv.low) && Number.isFinite(derivIv.high)) {
                const dx = isUpperBound ? derivIv.high : derivIv.low;
                x1Raw = x0 + tMax * dx;
              } else if (xEndIv && !xEndIv.isBottom() && Number.isFinite(xEndIv.high) && Number.isFinite(xEndIv.low)) {
                x1Raw = isUpperBound ? xEndIv.high : xEndIv.low;
              }
              const steps = 10;
              for (let s = 0; s <= steps; s++) {
                const frac = s / steps;
                timeArr.push(frac * tMax);
                valArr.push(x0 + frac * (x1Raw - x0));
              }
            }
          }

          if (timeArr.length > 0 && timeArr.length === valArr.length) {
            const pred = StlMonitor.predicate(sigName, cmpOp, limit);
            const formula: StlFormula =
              tempKind === "always" ? StlMonitor.always([tA, tB], pred) : StlMonitor.eventually([tA, tB], pred);
            const trace: TrajectoryTrace = {
              time: Float64Array.from(timeArr),
              signals: { [sigName]: Float64Array.from(valArr) },
            };
            const stlRes = StlMonitor.evaluate(formula, trace);
            if (!stlRes.isSatisfied) {
              diags.push(
                makeFormalDiag(
                  ModelicaErrorCode.FORMAL_REQUIREMENT_STL_VIOLATED,
                  className,
                  "reachability",
                  classRange,
                  [
                    stlRaw.trim(),
                    sigName,
                    stlRes.worstRobustness.toFixed(4),
                    (stlRes.timeOfWorstViolation ?? tA).toFixed(3),
                  ],
                ),
              );
            }
          }
        }
      }

      for (const issue of reachSummary.issues) {
        emitSingularityIssue(issue);
      }
    }

    // Check explicit `nominal` attributes against known/solved variable ranges (M7211)
    for (let v = 0; v < arena.varCount; v++) {
      if (arena.isVarRemoved(v)) continue;
      const nomExpr = arena.getVarAttr(v, "nominal");
      if (nomExpr === undefined) continue;
      const nomIv = evaluator.evaluateExpr(nomExpr).interval;
      const nominalVal = nomIv.low === nomIv.high ? Math.abs(nomIv.low) : Math.abs(nomIv.high);
      if (!Number.isFinite(nominalVal) || nominalVal <= 0) continue;

      let iv = solvedVarBounds.get(v);
      if (!iv) {
        const bindExpr = arena.getVarBindingExpr(v);
        if (bindExpr !== undefined) iv = evaluator.evaluateExpr(bindExpr).interval;
      }
      if (!iv || iv.isBottom() || !Number.isFinite(iv.low) || !Number.isFinite(iv.high)) continue;
      const maxAbs = Math.max(Math.abs(iv.low), Math.abs(iv.high));
      const minAbs = iv.low <= 0 && iv.high >= 0 ? 0 : Math.min(Math.abs(iv.low), Math.abs(iv.high));
      if (minAbs > nominalVal * 1000 || (maxAbs > 0 && maxAbs < nominalVal * 1e-3)) {
        const varName = arena.getVarName(v);
        diags.push(
          makeFormalDiag(
            ModelicaErrorCode.FORMAL_NOMINAL_MAGNITUDE_MISMATCH,
            className,
            "abstract-interpretation",
            classRange,
            [varName, `[${iv.low}, ${iv.high}]`, String(nominalVal)],
          ),
        );
      }
    }

    // Check 32-bit signed Integer overflow hazard across Integer variables and RHS expressions (M7207)
    const INT32_MIN = -2147483648;
    const INT32_MAX = 2147483647;
    const overflowReported = new Set<string>();
    const checkIntInterval = (label: string, iv: NumericalInterval): void => {
      if (iv.isBottom() || iv.isTop() || (!Number.isFinite(iv.low) && !Number.isFinite(iv.high))) return;
      if (iv.low < INT32_MIN || iv.high > INT32_MAX) {
        if (overflowReported.has(label)) return;
        overflowReported.add(label);
        const definite = iv.high < INT32_MIN || iv.low > INT32_MAX || iv.low === iv.high;
        diags.push(
          makeFormalDiag(
            ModelicaErrorCode.FORMAL_INTEGER_OVERFLOW,
            className,
            "abstract-interpretation",
            classRange,
            [label, `[${iv.low}, ${iv.high}]`],
            definite ? "error" : "warning",
          ),
        );
      }
    };
    for (let v = 0; v < arena.varCount; v++) {
      if (arena.isVarRemoved(v) || arena.getVarType(v) !== VarType.Integer) continue;
      const varName = arena.getVarName(v);
      const solved = solvedVarBounds.get(v);
      if (solved) checkIntInterval(varName, solved);
      const bExpr = arena.getVarBindingExpr(v);
      if (bExpr !== undefined) checkIntInterval(varName, evaluator.evaluateExpr(bExpr).interval);
    }
    for (let eq = 0; eq < arena.eqCount; eq++) {
      if (arena.isEqRemoved?.(eq) || arena.getEqKind(eq) !== EqKind.Simple) continue;
      const lhs = arena.getEqLhs(eq);
      const rhs = arena.getEqRhs(eq);
      if (lhs >= 0 && arena.getExprKind(lhs) === ExprKind.Name) {
        const vIdx = arena.lookupVariable(arena.getExprData1(lhs));
        if (vIdx >= 0 && arena.getVarType(vIdx) === VarType.Integer && rhs >= 0) {
          checkIntInterval(printArenaExprSafe(arena, rhs), evaluator.evaluateExpr(rhs).interval);
        }
      }
    }

    // Fallback/supplemental direct sweep over all active equations so domain violations in
    // constant or unmatched blocks are never missed.
    const directEval = evaluator.evaluateAllEquations();
    for (const issue of directEval.issues) {
      emitSingularityIssue(issue);
    }

    // 4. Algorithm / function CFG abstract interpretation (M7201, M7202, M7203, M7206)
    if (classCst) {
      try {
        const algSections = findCstNodesByType(classCst, "algorithm_section");
        const variables = ModelicaAlgorithmAnalyzer.extractVariablesFromClassCst(classCst);
        for (const algSec of algSections) {
          const algOffset = algSec.startIndex ?? algSec.startOffset ?? 0;
          const statements = ModelicaCFGLowerer.extractStatementsFromCst(algSec, algOffset);
          if (statements.length === 0) continue;

          const algoRes = ModelicaAlgorithmAnalyzer.analyze(statements, variables, {
            functionName: className,
          });
          const emitAlgoIssues = (issues: typeof algoRes.definiteBugs, sev: DiagnosticSeverity) => {
            for (const iss of issues) {
              const range = nodeToRange(algSec) ?? classRange;
              const locExpr = `${className}@L${(range?.startPosition.row ?? 0) + 1}`;
              if (iss.category === "division_by_zero") {
                diags.push(
                  makeFormalDiag(
                    ModelicaErrorCode.FORMAL_POSSIBLE_DIVISION_BY_ZERO,
                    className,
                    "abstract-interpretation",
                    range,
                    [locExpr, iss.description],
                    sev,
                  ),
                );
              } else if (iss.category === "math_domain") {
                const descLower = iss.description.toLowerCase();
                const def = descLower.includes("log")
                  ? ModelicaErrorCode.FORMAL_LOG_OF_NONPOSITIVE
                  : ModelicaErrorCode.FORMAL_SQRT_OF_NEGATIVE;
                diags.push(
                  makeFormalDiag(def, className, "abstract-interpretation", range, [locExpr, iss.description], sev),
                );
              } else if (iss.category === "array_out_of_bounds") {
                diags.push(
                  makeFormalDiag(
                    ModelicaErrorCode.FORMAL_ARRAY_INDEX_OUT_OF_BOUNDS,
                    className,
                    "abstract-interpretation",
                    range,
                    [locExpr, iss.description],
                    sev,
                  ),
                );
              }
            }
          };
          emitAlgoIssues(algoRes.definiteBugs, "error");
          emitAlgoIssues(algoRes.potentialBugs, "warning");

          // M7212: Algorithm while-loop termination check
          const inspectWhileLoops = (stmts: typeof statements): void => {
            const LOOP_KEYWORDS = new Set([
              "and",
              "or",
              "not",
              "true",
              "false",
              "time",
              "initial",
              "terminal",
              "abs",
              "min",
              "max",
            ]);
            const collectBodyFacts = (
              body: typeof statements,
              inNestedLoop: boolean,
              out: { hasExit: boolean; assigns: Array<{ target: string; val: string }> },
            ): void => {
              for (const bs of body) {
                if (bs.kind === "return") {
                  out.hasExit = true;
                } else if (bs.kind === "break" && !inNestedLoop) {
                  out.hasExit = true;
                } else if (bs.kind === "assignment" && bs.targetVar) {
                  out.assigns.push({ target: bs.targetVar.trim(), val: (bs.valExpr ?? "").trim() });
                } else if (bs.kind === "if") {
                  if (bs.thenStmts) collectBodyFacts(bs.thenStmts, inNestedLoop, out);
                  if (bs.elseIfs) for (const ei of bs.elseIfs) collectBodyFacts(ei.stmts, inNestedLoop, out);
                  if (bs.elseStmts) collectBodyFacts(bs.elseStmts, inNestedLoop, out);
                } else if (bs.kind === "for" && bs.loopBody) {
                  if (bs.loopVar) out.assigns.push({ target: bs.loopVar.trim(), val: "for_index" });
                  collectBodyFacts(bs.loopBody, true, out);
                } else if (bs.kind === "while" && bs.whileBody) {
                  collectBodyFacts(bs.whileBody, true, out);
                } else if (bs.kind === "when" && bs.whenBody) {
                  collectBodyFacts(bs.whenBody, inNestedLoop, out);
                }
              }
            };

            const analyzeUpdateDir = (vName: string, valExpr: string): "inc" | "dec" | "same" | "other" => {
              const escaped = vName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              if (new RegExp(`^${escaped}$`).test(valExpr)) return "same";
              const plusMatch = new RegExp(`^${escaped}\\s*\\+\\s*([0-9]+(?:\\.[0-9]+)?)$`).exec(valExpr);
              if (plusMatch) {
                const n = Number(plusMatch[1]);
                return n > 0 ? "inc" : n < 0 ? "dec" : "same";
              }
              const minusMatch = new RegExp(`^${escaped}\\s*-\\s*([0-9]+(?:\\.[0-9]+)?)$`).exec(valExpr);
              if (minusMatch) {
                const n = Number(minusMatch[1]);
                return n > 0 ? "dec" : n < 0 ? "inc" : "same";
              }
              return "other";
            };

            for (const st of stmts) {
              if (st.kind === "while") {
                const cond = (st.condExpr ?? "").trim();
                const body = st.whileBody ?? [];
                if (cond && cond !== "false") {
                  const facts = { hasExit: false, assigns: [] as Array<{ target: string; val: string }> };
                  collectBodyFacts(body, false, facts);
                  if (!facts.hasExit) {
                    const condVars = new Set<string>();
                    for (const tok of cond.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
                      if (!LOOP_KEYWORDS.has(tok)) condVars.add(tok);
                    }
                    const condModified = facts.assigns.some((a) => condVars.has(a.target));
                    let unprovenReason = !condModified;

                    if (!unprovenReason) {
                      const cmpLt = /^([A-Za-z_][A-Za-z0-9_]*)\s*(<=|<)\s*([^=<>]+)$/.exec(cond);
                      const cmpGt = /^([A-Za-z_][A-Za-z0-9_]*)\s*(>=|>)\s*([^=<>]+)$/.exec(cond);
                      if (cmpLt) {
                        const vName = cmpLt[1]!;
                        const vAssigns = facts.assigns.filter((a) => a.target === vName);
                        if (
                          vAssigns.length > 0 &&
                          vAssigns.every((a) => {
                            const d = analyzeUpdateDir(vName, a.val);
                            return d === "dec" || d === "same";
                          })
                        ) {
                          unprovenReason = true;
                        }
                      } else if (cmpGt) {
                        const vName = cmpGt[1]!;
                        const vAssigns = facts.assigns.filter((a) => a.target === vName);
                        if (
                          vAssigns.length > 0 &&
                          vAssigns.every((a) => {
                            const d = analyzeUpdateDir(vName, a.val);
                            return d === "inc" || d === "same";
                          })
                        ) {
                          unprovenReason = true;
                        }
                      }
                    }

                    if (unprovenReason) {
                      const range = nodeToRange(algSec) ?? classRange;
                      diags.push(
                        makeFormalDiag(
                          ModelicaErrorCode.FORMAL_LOOP_TERMINATION_UNPROVEN,
                          className,
                          "abstract-interpretation",
                          range,
                          [cond],
                        ),
                      );
                    }
                  }
                }
                if (body.length > 0) inspectWhileLoops(body);
              } else if (st.kind === "if") {
                if (st.thenStmts) inspectWhileLoops(st.thenStmts);
                if (st.elseIfs) for (const ei of st.elseIfs) inspectWhileLoops(ei.stmts);
                if (st.elseStmts) inspectWhileLoops(st.elseStmts);
              } else if (st.kind === "for" && st.loopBody) {
                inspectWhileLoops(st.loopBody);
              } else if (st.kind === "when" && st.whenBody) {
                inspectWhileLoops(st.whenBody);
              }
            }
          };
          inspectWhileLoops(statements);
        }
      } catch {
        // Ignore classes without lowerable algorithm blocks
      }
    }
  }

  // 5. Assert, when & conditional branch guard satisfiability (M7301..M7305)
  if (runSat) {
    const isGuardSubsumed = (earlierExpr: number, laterExpr: number): boolean => {
      if (earlierExpr < 0 || laterExpr < 0) return false;
      if (printArenaExprSafe(arena, earlierExpr) === printArenaExprSafe(arena, laterExpr)) return true;
      if (arena.getExprKind(earlierExpr) !== ExprKind.Binary || arena.getExprKind(laterExpr) !== ExprKind.Binary) {
        return false;
      }
      const op1 = arena.getExprData1(earlierExpr);
      const op2 = arena.getExprData1(laterExpr);
      const l1 = arena.getExprLeft(earlierExpr);
      const r1 = arena.getExprRight(earlierExpr);
      const l2 = arena.getExprLeft(laterExpr);
      const r2 = arena.getExprRight(laterExpr);
      const extractVarBound = (
        l: number,
        r: number,
        op: number,
      ): { target: string; op: number; val: number } | null => {
        const rv = evalScalarLiteralNumber(arena, r);
        if (rv !== null) return { target: printArenaExprSafe(arena, l), op, val: rv };
        const lv = evalScalarLiteralNumber(arena, l);
        if (lv !== null) {
          const flipped =
            op === BinOp.Lt
              ? BinOp.Gt
              : op === BinOp.Lte
                ? BinOp.Gte
                : op === BinOp.Gt
                  ? BinOp.Lt
                  : op === BinOp.Gte
                    ? BinOp.Lte
                    : op;
          return { target: printArenaExprSafe(arena, r), op: flipped, val: lv };
        }
        return null;
      };
      const b1 = extractVarBound(l1, r1, op1);
      const b2 = extractVarBound(l2, r2, op2);
      if (!b1 || !b2 || b1.target !== b2.target) return false;
      // If earlier says x > c1 (or >= c1) and later says x > c2 (or >= c2) with c2 >= c1:
      if ((b1.op === BinOp.Gt || b1.op === BinOp.Gte) && (b2.op === BinOp.Gt || b2.op === BinOp.Gte)) {
        if (b1.val < b2.val) return true;
        if (b1.val === b2.val && (b1.op === BinOp.Gte || b2.op === BinOp.Gt)) return true;
      }
      if ((b1.op === BinOp.Lt || b1.op === BinOp.Lte) && (b2.op === BinOp.Lt || b2.op === BinOp.Lte)) {
        if (b1.val > b2.val) return true;
        if (b1.val === b2.val && (b1.op === BinOp.Lte || b2.op === BinOp.Lt)) return true;
      }
      return false;
    };

    for (let eq = 0; eq < arena.eqCount; eq++) {
      if (arena.isEqRemoved?.(eq)) continue;
      const k = arena.getEqKind(eq);
      if (k === EqKind.FunctionCall || k === EqKind.InitialFunctionCall) {
        const callExpr = arena.getEqLhs(eq);
        if (callExpr >= 0 && arena.getExprKind(callExpr) === ExprKind.Call) {
          const fnName = arena.interner.resolve(arena.getExprData1(callExpr));
          const argCount = arena.getExprRight(callExpr);
          if (fnName === "assert" && argCount >= 1) {
            const condExpr = arena.getExprLeft(callExpr);
            const condText = printArenaExprSafe(arena, condExpr);
            const msgText = argCount >= 2 ? printArenaExprSafe(arena, condExpr + 1) : "assertion";
            // Evaluate using interval evaluator ONLY (excluding assert's own octagon edge so self-contradiction isn't hidden)
            const truth = evaluateConditionTruth(
              arena,
              evaluator,
              new OctagonDBMF64(Math.max(1, varToOctIdx.size)),
              varToOctIdx,
              condExpr,
            );
            if (truth === "false") {
              diags.push(
                makeFormalDiag(ModelicaErrorCode.FORMAL_ASSERT_ALWAYS_FAILS, className, "satisfiability", classRange, [
                  condText,
                  msgText,
                ]),
              );
            } else if (truth === "true") {
              diags.push(
                makeFormalDiag(
                  ModelicaErrorCode.FORMAL_ASSERT_TRIVIALLY_TRUE,
                  className,
                  "satisfiability",
                  classRange,
                  [condText],
                ),
              );
            }
          }
        }
      } else if (k === EqKind.If) {
        const meta = arena.getIfEquationMeta?.(eq);
        if (meta) {
          const conds = [meta.conditionExprId, ...meta.elseIfClauses.map((c) => c.conditionExprId)];
          for (let ci = 0; ci < conds.length; ci++) {
            const condId = conds[ci]!;
            const truth = evaluateConditionTruth(arena, evaluator, oct, varToOctIdx, condId);
            if (truth === "false") {
              diags.push(
                makeFormalDiag(ModelicaErrorCode.FORMAL_DEAD_IF_BRANCH, className, "satisfiability", classRange, [
                  printArenaExprSafe(arena, condId),
                ]),
              );
            } else if (ci > 0) {
              for (let prev = 0; prev < ci; prev++) {
                if (isGuardSubsumed(conds[prev]!, condId)) {
                  diags.push(
                    makeFormalDiag(
                      ModelicaErrorCode.FORMAL_SHADOWED_ELSEIF_GUARD,
                      className,
                      "satisfiability",
                      classRange,
                      [printArenaExprSafe(arena, condId), printArenaExprSafe(arena, conds[prev]!)],
                    ),
                  );
                  break;
                }
              }
            }
          }
        }
      } else if (k === EqKind.When) {
        const meta = arena.getWhenEquationMeta?.(eq);
        if (meta) {
          const conds = [meta.conditionExprId, ...(meta.elseWhenClauses ?? []).map((c) => c.conditionExprId)];
          for (const condId of conds) {
            const truth = evaluateConditionTruth(arena, evaluator, oct, varToOctIdx, condId);
            if (truth === "false") {
              diags.push(
                makeFormalDiag(ModelicaErrorCode.FORMAL_WHEN_CONDITION_UNSAT, className, "satisfiability", classRange, [
                  printArenaExprSafe(arena, condId),
                ]),
              );
            }
          }
        }
      }
    }

    // Dynamic conditional expression domain hazard without noEvent(...) guard isolation (M7308)
    const cstText: string = typeof classCst?.text === "string" ? classCst.text : "";
    const isNoEventWrapped = (condExprId: number): boolean => {
      if (condExprId < 0) return false;
      if (arena.getExprKind(condExprId) === ExprKind.Call) {
        const fn = arena.interner.resolve(arena.getExprData1(condExprId));
        if (fn === "noEvent") return true;
      }
      if (cstText.length > 0) {
        const ct = printArenaExprSafe(arena, condExprId);
        if (cstText.includes(`noEvent(${ct})`) || cstText.includes(`noEvent (${ct})`)) return true;
      }
      return false;
    };
    const isDomainHazardKind = (kind: string): boolean =>
      kind === "div_by_zero" ||
      kind === "sqrt_negative" ||
      kind === "log_nonpositive" ||
      kind === "inverse_trig_domain" ||
      kind === "pow_domain_violation";
    const visitedExprs = new Set<number>();
    const scanIfElseDomain = (exprId: number): void => {
      if (exprId < 0 || visitedExprs.has(exprId)) return;
      visitedExprs.add(exprId);
      const ek = arena.getExprKind(exprId);
      if (ek === ExprKind.IfElse) {
        const cond = arena.getExprData1(exprId);
        const thenE = arena.getExprLeft(exprId);
        const elseE = arena.getExprRight(exprId);
        if (!isNoEventWrapped(cond)) {
          const condTruth = evaluateConditionTruth(arena, evaluator, oct, varToOctIdx, cond);
          if (condTruth === "unknown") {
            const thenIssues = thenE >= 0 ? evaluator.evaluateExpr(thenE).issues : [];
            const elseIssues = elseE >= 0 ? evaluator.evaluateExpr(elseE).issues : [];
            if ([...thenIssues, ...elseIssues].some((iss) => isDomainHazardKind(iss.kind))) {
              diags.push(
                makeFormalDiag(
                  ModelicaErrorCode.FORMAL_BRANCH_DOMAIN_WITHOUT_NOEVENT,
                  className,
                  "satisfiability",
                  classRange,
                  [printArenaExprSafe(arena, exprId), printArenaExprSafe(arena, cond)],
                ),
              );
            }
          }
        }
        if (thenE >= 0) scanIfElseDomain(thenE);
        if (elseE >= 0) scanIfElseDomain(elseE);
        return;
      }
      if (ek === ExprKind.Binary || ek === ExprKind.Unary || ek === ExprKind.Negate) {
        scanIfElseDomain(arena.getExprLeft(exprId));
        if (ek === ExprKind.Binary) scanIfElseDomain(arena.getExprRight(exprId));
      } else if (ek === ExprKind.Call || ek === ExprKind.ArrayCtor) {
        const argCnt = ek === ExprKind.Call ? arena.getExprRight(exprId) : arena.getExprData1(exprId);
        const firstArg = arena.getExprLeft(exprId);
        for (let i = 0; i < Math.min(argCnt, 16); i++) {
          scanIfElseDomain(firstArg + i);
        }
      }
    };
    for (let eq = 0; eq < arena.eqCount; eq++) {
      if (arena.isEqRemoved?.(eq) || arena.getEqKind(eq) !== EqKind.Simple) continue;
      scanIfElseDomain(arena.getEqLhs(eq));
      scanIfElseDomain(arena.getEqRhs(eq));
    }

    // M7501: Bounded discrete transition checking of assert(...) via IC3Engine
    for (let eq = 0; eq < arena.eqCount; eq++) {
      if (arena.isEqRemoved?.(eq)) continue;
      if (arena.getEqKind(eq) !== EqKind.FunctionCall && arena.getEqKind(eq) !== EqKind.InitialFunctionCall) continue;
      const callExpr = arena.getEqLhs(eq);
      if (callExpr < 0 || arena.getExprKind(callExpr) !== ExprKind.Call) continue;
      const fnName = arena.interner.resolve(arena.getExprData1(callExpr));
      if (fnName !== "assert" || arena.getExprRight(callExpr) < 1) continue;
      const condExpr = arena.getExprLeft(callExpr);
      if (condExpr < 0) continue;

      const condText = printArenaExprSafe(arena, condExpr);
      // Case A: Counter update inside when-equations (`count = pre(count) + step; assert(count <= max)`)
      const cmp = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(<=|>=|<|>)\s*(-?[0-9]+)\s*$/.exec(condText);
      if (cmp) {
        const varName = cmp[1]!;
        const op = cmp[2]!;
        const limit = Number(cmp[3]!);
        let vIdx = -1;
        for (let v = 0; v < arena.varCount; v++) {
          if (!arena.isVarRemoved(v) && arena.getVarName(v) === varName) {
            vIdx = v;
            break;
          }
        }
        if (vIdx >= 0 && arena.getVarType(vIdx) === VarType.Integer && classCst) {
          const whenUpdates: number[] = [];
          for (const weq of findCstNodesByType(classCst, "when_equation")) {
            const wt = String(weq.text ?? "");
            const incRe = new RegExp(
              `\\b${varName}\\s*=\\s*pre\\s*\\(\\s*${varName}\\s*\\)\\s*([+-])\\s*([0-9]+)`,
              "g",
            );
            for (const m of wt.matchAll(incRe)) {
              const step = m[1] === "-" ? -Number(m[2]!) : Number(m[2]!);
              if (step !== 0) whenUpdates.push(step);
            }
          }
          if (whenUpdates.length > 0) {
            const stRaw = arena.getVarStartValue(vIdx);
            const c0 = Number.isFinite(stRaw) ? Math.trunc(stRaw) : 0;
            const MAX_BOUND = 12;
            const loState = Math.min(c0, limit) - 2;
            const hiState = Math.max(c0, limit) + 3;
            const span = hiState - loState + 1;
            if (span >= 2 && span <= MAX_BOUND + 4) {
              const stateVars = Array.from({ length: span }, (_, i) => i + 1);
              const nextStateVars = Array.from({ length: span }, (_, i) => span + i + 1);
              const initIdx = c0 - loState;
              const initClauses: number[][] = stateVars.map((sv, idx) => [idx === initIdx ? sv : -sv]);
              const transClauses: number[][] = [[...nextStateVars]];
              for (let a = 0; a < span; a++) {
                for (let b = a + 1; b < span; b++) transClauses.push([-nextStateVars[a]!, -nextStateVars[b]!]);
              }
              for (let idx = 0; idx < span; idx++) {
                const curVal = loState + idx;
                const targets = new Set<number>([idx]);
                for (const stp of whenUpdates) {
                  const nxtVal = curVal + stp;
                  if (nxtVal >= loState && nxtVal <= hiState) targets.add(nxtVal - loState);
                }
                transClauses.push([-stateVars[idx]!, ...Array.from(targets).map((t) => nextStateVars[t]!)]);
              }
              const propClauses: number[][] = [];
              for (let idx = 0; idx < span; idx++) {
                const val = loState + idx;
                const holds =
                  (op === "<=" && val <= limit) ||
                  (op === "<" && val < limit) ||
                  (op === ">=" && val >= limit) ||
                  (op === ">" && val > limit);
                if (!holds) propClauses.push([-stateVars[idx]!]);
              }
              if (propClauses.length > 0) {
                const ts: TransitionSystem = { stateVars, nextStateVars, initClauses, transClauses, propClauses };
                const ic3Res = new IC3Engine(ts).verify(8);
                if (!ic3Res.isProvenInvariant && ic3Res.counterexampleTrace) {
                  diags.push(
                    makeFormalDiag(
                      ModelicaErrorCode.FORMAL_ASSERT_VIOLABLE_DISCRETE,
                      className,
                      "state-machine",
                      classRange,
                      [condText, String(Math.max(1, ic3Res.counterexampleTrace.length - 1))],
                    ),
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  // Shared helpers for discrete invariant (M7502), postcondition (M7504), relational checks (M7505), and barrier checks (M7602)
  const readModelScriptAnn = (attrName: string): string | null => {
    if (!classCst) return null;
    let found: string | null = null;
    const walk = (n: CstNodeLike) => {
      if (!n || found) return;
      if (n !== classCst && n.type === "class_definition") return;
      if (n.type === "element_modification") {
        const nm = (
          n.childForFieldName?.("name") ?? n.children?.find((c: CstNodeLike) => c.type === "name")
        )?.text?.trim();
        if (nm === attrName) {
          const modNode =
            n.childForFieldName?.("modification") ?? n.children?.find((c: CstNodeLike) => c.type === "modification");
          const raw = modNode?.text?.trim() ?? "";
          const eqPos = raw.indexOf("=");
          let txt = eqPos >= 0 ? raw.slice(eqPos + 1).trim() : raw;
          if (txt.startsWith('"') && txt.endsWith('"') && txt.length >= 2) txt = txt.slice(1, -1);
          if (txt) found = txt;
          return;
        }
      }
      for (const ch of n.children ?? []) walk(ch);
    };
    walk(classCst);
    return found;
  };

  // M7502: First-order inductive invariant certification on discrete/clocked when systems via InductiveProver
  if (runSat && classCst) {
    const invClauseRaw = readModelScriptAnn("__ModelScript_invariant");
    if (invClauseRaw) {
      const im = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(<=|>=|<|>)\s*(-?[0-9]+(?:\.[0-9]+)?)\s*$/.exec(invClauseRaw);
      if (im) {
        const invVar = im[1]!;
        const invOp = im[2]! as "<=" | ">=" | "<" | ">";
        const invVal = Number(im[3]!);
        let vIdx = -1;
        for (let v = 0; v < arena.varCount; v++) {
          if (!arena.isVarRemoved(v) && arena.getVarName(v) === invVar) {
            vIdx = v;
            break;
          }
        }
        const whenNodes = findCstNodesByType(classCst, "when_equation");
        if (vIdx >= 0 && whenNodes.length > 0) {
          const steps: number[] = [];
          const transConstraints: NonlinearConstraint[] = [];
          const incRe = new RegExp(
            `\\b${invVar}\\s*=\\s*pre\\s*\\(\\s*${invVar}\\s*\\)\\s*([+-])\\s*([0-9]+(?:\\.[0-9]+)?)`,
            "g",
          );
          for (const weq of whenNodes) {
            const wt = String(weq.text ?? "");
            for (const m of wt.matchAll(incRe)) {
              const s = m[1] === "-" ? -Number(m[2]!) : Number(m[2]!);
              steps.push(s);
            }
          }
          if (steps.length === 1) {
            transConstraints.push({
              expr: {
                kind: "sub",
                left: { kind: "var", name: `${invVar}_prime` },
                right: { kind: "var", name: invVar },
              },
              rel: "==",
              rhs: steps[0]!,
            });
          } else if (steps.length > 1) {
            const minStep = Math.min(...steps);
            const maxStep = Math.max(...steps);
            transConstraints.push(
              {
                expr: {
                  kind: "sub",
                  left: { kind: "var", name: `${invVar}_prime` },
                  right: { kind: "var", name: invVar },
                },
                rel: ">=",
                rhs: minStep,
              },
              {
                expr: {
                  kind: "sub",
                  left: { kind: "var", name: `${invVar}_prime` },
                  right: { kind: "var", name: invVar },
                },
                rel: "<=",
                rhs: maxStep,
              },
            );
          }
          if (transConstraints.length > 0) {
            const stRaw = arena.getVarStartValue(vIdx);
            const c0 = Number.isFinite(stRaw) ? stRaw : 0;
            const spec: InductiveSpec = {
              variables: [invVar],
              init: [{ expr: { kind: "var", name: invVar }, rel: "==", rhs: c0 }],
              transition: transConstraints,
              invariant: [{ expr: { kind: "var", name: invVar }, rel: invOp, rhs: invVal }],
              domainBounds: new Map([[invVar, new Interval(-1000, 1000)]]),
            };
            const indRes = InductiveProver.proveInvariant(spec);
            if (indRes.status === "PROVEN" || indRes.status === "STRENGTHENED") {
              diags.push(
                makeFormalDiag(
                  ModelicaErrorCode.FORMAL_CLOCKED_INVARIANT_PROVEN,
                  className,
                  "state-machine",
                  classRange,
                  [invClauseRaw, indRes.summary],
                ),
              );
            }
          }
        }
      }
    }
  }

  const parseLinearArith = (txt: string): ExprNode | null => {
    const s = txt.trim();
    if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(s)) return { kind: "const", value: Number(s) };
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return { kind: "var", name: s };
    if (s.startsWith("-") && !s.slice(1).trim().includes(" ")) {
      const inner = parseLinearArith(s.slice(1));
      if (inner) return { kind: "neg", child: inner };
    }
    const addSub = /^(.+?)\s*([+-])\s*([^+-]+)$/.exec(s);
    if (addSub) {
      const l = parseLinearArith(addSub[1]!);
      const r = parseLinearArith(addSub[3]!);
      if (l && r) return { kind: addSub[2] === "+" ? "add" : "sub", left: l, right: r };
    }
    const mulDiv = /^(.+?)\s*([*/])\s*([^*/]+)$/.exec(s);
    if (mulDiv) {
      const l = parseLinearArith(mulDiv[1]!);
      const r = parseLinearArith(mulDiv[3]!);
      if (l && r) return { kind: mulDiv[2] === "*" ? "mul" : "div", left: l, right: r };
    }
    return null;
  };

  const buildAlgorithmTransfer = (seedVars: string[]) => {
    if (!classCst) return null;
    const algSections = findCstNodesByType(classCst, "algorithm_section");
    if (algSections.length === 0) return null;
    const stmts = ModelicaCFGLowerer.extractStatementsFromCst(algSections[0]!, algSections[0]!.startIndex ?? 0);
    const varNames = new Set<string>(seedVars);
    const eqConstraints: NonlinearConstraint[] = [];
    for (const st of stmts) {
      if (st.kind === "assignment" && st.targetVar && st.valExpr) {
        const tgt = st.targetVar.trim();
        const rhsNode = parseLinearArith(st.valExpr);
        if (rhsNode) {
          varNames.add(tgt);
          const collectVars = (e: ExprNode) => {
            if (e.kind === "var") varNames.add(e.name);
            else if ("left" in e) {
              collectVars(e.left);
              collectVars(e.right);
            } else if ("child" in e) collectVars(e.child);
          };
          collectVars(rhsNode);
          eqConstraints.push({
            expr: { kind: "sub", left: { kind: "var", name: tgt }, right: rhsNode },
            rel: "==",
            rhs: 0,
          });
        }
      }
    }
    if (eqConstraints.length === 0) return null;
    const allVars = Array.from(varNames);
    const declHeader =
      typeof classCst?.text === "string" ? (classCst.text.split(/\b(?:algorithm|equation)\b/)[0] ?? "") : "";
    const inputBounds: NonlinearConstraint[] = [];
    const varRanges = new Map<string, { min: number; max: number }>();
    for (const vn of allVars) {
      let loBound = -Infinity;
      let hiBound = Infinity;
      for (let v = 0; v < arena.varCount; v++) {
        if (arena.getVarName(v) !== vn) continue;
        const b = tightenedBounds.get(v);
        if (b && !b.isBottom()) {
          if (Number.isFinite(b.low)) loBound = Math.max(loBound, b.low);
          if (Number.isFinite(b.high)) hiBound = Math.min(hiBound, b.high);
        }
        const minE = arena.getVarAttr(v, "min");
        if (minE !== undefined) {
          const mIv = evaluator.evaluateExpr(minE).interval;
          if (!mIv.isBottom() && Number.isFinite(mIv.low)) loBound = Math.max(loBound, mIv.low);
        }
        const maxE = arena.getVarAttr(v, "max");
        if (maxE !== undefined) {
          const mIv = evaluator.evaluateExpr(maxE).interval;
          if (!mIv.isBottom() && Number.isFinite(mIv.high)) hiBound = Math.min(hiBound, mIv.high);
        }
      }
      if (declHeader) {
        const escVn = vn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const modM = declHeader.match(new RegExp(`\\b${escVn}\\s*(?:\\[[^\\]]*\\]\\s*)?\\(([^)]*)\\)`));
        if (modM?.[1]) {
          const minM = modM[1].match(/(?:^|[\s,])min\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/);
          if (minM?.[1]) {
            const mv = Number(minM[1]);
            if (Number.isFinite(mv)) loBound = Math.max(loBound, mv);
          }
          const maxM = modM[1].match(/(?:^|[\s,])max\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/);
          if (maxM?.[1]) {
            const mv = Number(maxM[1]);
            if (Number.isFinite(mv)) hiBound = Math.min(hiBound, mv);
          }
        }
      }
      if (Number.isFinite(loBound)) inputBounds.push({ expr: { kind: "var", name: vn }, rel: ">=", rhs: loBound });
      if (Number.isFinite(hiBound)) inputBounds.push({ expr: { kind: "var", name: vn }, rel: "<=", rhs: hiBound });
      varRanges.set(vn, { min: loBound, max: hiBound });
    }
    return { allVars, eqConstraints, inputBounds, varRanges };
  };

  // 6. Algorithm CHC / Spacer postcondition checking (M7504) & Relational self-composition (M7505)
  if (runSat && classCst) {
    const ensuresClause = readModelScriptAnn("__ModelScript_ensures");
    if (ensuresClause) {
      const em = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(<=|>=|<|>|==)\s*(-?[0-9]+(?:\.[0-9]+)?)\s*$/.exec(ensuresClause);
      if (em) {
        const outVar = em[1]!;
        const postOp = em[2]! as "<=" | ">=" | "<" | ">" | "==";
        const postVal = Number(em[3]!);
        const sys = buildAlgorithmTransfer([outVar]);
        if (sys) {
          const { allVars, eqConstraints, inputBounds } = sys;
          const preVars = allVars.map((vn) => `${vn}__pre`);
          const chc = new ChcSystem();
          chc.addPredicate({ name: "PreState", arity: allVars.length, varNames: preVars });
          chc.addPredicate({ name: "PostState", arity: allVars.length, varNames: allVars });

          const preFactBounds: NonlinearConstraint[] = inputBounds.map((c) => ({
            expr: { kind: "var", name: `${(c.expr as { kind: "var"; name: string }).name}__pre` },
            rel: c.rel,
            rhs: c.rhs,
          }));
          chc.addFact("PreState", preVars, preFactBounds);
          chc.addRule(
            { name: "PostState", args: allVars },
            [{ name: "PreState", args: preVars }],
            [...inputBounds, ...eqConstraints],
            "EvalBody",
          );

          const negatedRels: Array<{ rel: NonlinearConstraint["rel"]; rhs: number }> =
            postOp === ">="
              ? [{ rel: "<", rhs: postVal }]
              : postOp === ">"
                ? [{ rel: "<=", rhs: postVal }]
                : postOp === "<="
                  ? [{ rel: ">", rhs: postVal }]
                  : postOp === "<"
                    ? [{ rel: ">=", rhs: postVal }]
                    : [{ rel: "!=", rhs: postVal }];
          for (const neg of negatedRels) {
            chc.addQuery(
              [{ name: "PostState", args: allVars }],
              [{ expr: { kind: "var", name: outVar }, rel: neg.rel, rhs: neg.rhs }],
              "PostViolation",
            );
          }

          const spacerRes = new SpacerEngine(chc, { maxDepth: 4 }).check();
          if (spacerRes.status === "UNSAFE") {
            diags.push(
              makeFormalDiag(
                ModelicaErrorCode.FORMAL_FUNCTION_POSTCONDITION_VIOLATION,
                className,
                "abstract-interpretation",
                classRange,
                [className, ensuresClause, spacerRes.summary],
              ),
            );
          }
        }
      }
    }

    // M7505: Relational self-composition (monotonicity, Lipschitz, observational determinism) via RelationalVerifier
    const monoAnn = readModelScriptAnn("__ModelScript_monotone");
    const detAnn = readModelScriptAnn("__ModelScript_deterministic");
    const lipAnn = readModelScriptAnn("__ModelScript_lipschitz");
    if (monoAnn) {
      const mm =
        /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*(increasing|decreasing))?\s*$/i.exec(
          monoAnn,
        );
      if (mm) {
        const inV = mm[1]!;
        const outV = mm[2]!;
        const dir = (mm[3] ?? "increasing").toLowerCase();
        const sys = buildAlgorithmTransfer([inV, outV]);
        if (sys) {
          const tagNode = (e: ExprNode, suffix: string): ExprNode => {
            if (e.kind === "var") return { kind: "var", name: `${e.name}${suffix}` };
            if ("left" in e) return { ...e, left: tagNode(e.left, suffix), right: tagNode(e.right, suffix) };
            if ("child" in e) return { ...e, child: tagNode(e.child, suffix) };
            return e;
          };
          const base = [...sys.inputBounds, ...sys.eqConstraints];
          const copy1 = base.map((c): NonlinearConstraint => ({ expr: tagNode(c.expr, "_1"), rel: c.rel, rhs: c.rhs }));
          const copy2 = base.map((c): NonlinearConstraint => ({ expr: tagNode(c.expr, "_2"), rel: c.rel, rhs: c.rhs }));
          const monoConstraints: NonlinearConstraint[] = [
            ...copy1,
            ...copy2,
            {
              expr: { kind: "sub", left: { kind: "var", name: `${inV}_1` }, right: { kind: "var", name: `${inV}_2` } },
              rel: ">=",
              rhs: 0.01,
            },
            dir === "decreasing"
              ? {
                  expr: {
                    kind: "sub",
                    left: { kind: "var", name: `${outV}_1` },
                    right: { kind: "var", name: `${outV}_2` },
                  },
                  rel: ">=",
                  rhs: 0.01,
                }
              : {
                  expr: {
                    kind: "sub",
                    left: { kind: "var", name: `${outV}_1` },
                    right: { kind: "var", name: `${outV}_2` },
                  },
                  rel: "<=",
                  rhs: -0.01,
                },
          ];
          const theoryLits = new Map<number, NonlinearConstraint>();
          const clauses: number[][] = [];
          monoConstraints.forEach((c, idx) => {
            theoryLits.set(idx + 1, c);
            clauses.push([idx + 1]);
          });
          const satRes = new DpllTSolver({ clauses, theoryLiterals: theoryLits, useNlsat: true, delta: 1e-4 }).solve();
          if (satRes.status === "DELTA_SAT") {
            diags.push(
              makeFormalDiag(
                ModelicaErrorCode.FORMAL_FUNCTION_RELATIONAL_VIOLATION,
                className,
                "abstract-interpretation",
                classRange,
                [
                  className,
                  `monotone(${monoAnn})`,
                  "Relational self-composition found counterexample pair violating monotonicity.",
                ],
              ),
            );
          }
        }
      }
    }
    if (detAnn) {
      const dm = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(detAnn);
      if (dm) {
        const sys = buildAlgorithmTransfer([dm[1]!, dm[2]!]);
        if (sys) {
          const detRes = new RelationalVerifier().verifyObservationalDeterminism(
            [dm[1]!],
            [dm[2]!],
            [...sys.inputBounds, ...sys.eqConstraints],
          );
          if (detRes.status === "VIOLATED") {
            diags.push(
              makeFormalDiag(
                ModelicaErrorCode.FORMAL_FUNCTION_RELATIONAL_VIOLATION,
                className,
                "abstract-interpretation",
                classRange,
                [className, `deterministic(${detAnn})`, detRes.summary],
              ),
            );
          }
        }
      }
    }
    if (lipAnn) {
      const lm = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*<=\s*([0-9]+(?:\.[0-9]+)?)\s*$/.exec(
        lipAnn,
      );
      if (lm) {
        const inV = lm[1]!;
        const outV = lm[2]!;
        const targetL = Number(lm[3]!);
        const sys = buildAlgorithmTransfer([inV, outV]);
        if (sys) {
          const rng = sys.varRanges.get(inV);
          const minV = rng && Number.isFinite(rng.min) ? rng.min : -10;
          const maxV = rng && Number.isFinite(rng.max) ? rng.max : 10;
          const lipRes = new RelationalVerifier().verifyLipschitz(inV, outV, sys.eqConstraints, targetL, {
            min: minV,
            max: maxV,
          });
          if (lipRes.status === "VIOLATED") {
            diags.push(
              makeFormalDiag(
                ModelicaErrorCode.FORMAL_FUNCTION_RELATIONAL_VIOLATION,
                className,
                "abstract-interpretation",
                classRange,
                [className, `lipschitz(${lipAnn})`, lipRes.summary],
              ),
            );
          }
        }
      }
    }
  }

  // 7. Heuristic SOS Lyapunov / Barrier Certificate check (M7602) when requested via __ModelScript_barrier
  if (options.reachability !== false && classCst) {
    const barrierSpecRaw = readModelScriptAnn("__ModelScript_barrier");
    if (barrierSpecRaw) {
      const bm = /r0\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*ru\s*=\s*([0-9]+(?:\.[0-9]+)?)/.exec(barrierSpecRaw);
      const initialRadius = bm ? Number(bm[1]!) : 0.5;
      const unsafeRadius = bm ? Number(bm[2]!) : 2.0;
      const stateIdxList = Array.from(collectStateVarIndices(arena));
      if (stateIdxList.length >= 1 && stateIdxList.length <= 6) {
        const derRhsMap = new Map<number, number>();
        for (let eq = 0; eq < arena.eqCount; eq++) {
          if (arena.isEqRemoved?.(eq) || arena.isEqInitial?.(eq) || arena.getEqKind(eq) !== EqKind.Simple) continue;
          const lhs = arena.getEqLhs(eq);
          const rhs = arena.getEqRhs(eq);
          if (lhs >= 0 && arena.getExprKind(lhs) === ExprKind.Der) {
            const inner = arena.getExprData1(lhs);
            const v =
              inner >= 0 && arena.getExprKind(inner) === ExprKind.Name
                ? arena.lookupVariable(arena.getExprData1(inner))
                : -1;
            if (v >= 0) derRhsMap.set(v, rhs);
          }
        }
        const evalNumericAt = (exprId: number, stateMap: Map<number, number>): number => {
          if (exprId < 0) return 0;
          const k = arena.getExprKind(exprId);
          if (k === ExprKind.RealLiteral) return arena.getExprRealValue(exprId);
          if (k === ExprKind.IntLiteral) return arena.getExprData1(exprId);
          if (k === ExprKind.Name) {
            const vIdx = arena.lookupVariable(arena.getExprData1(exprId));
            if (vIdx >= 0 && stateMap.has(vIdx)) return stateMap.get(vIdx)!;
            if (vIdx >= 0) return arena.getVarStartValue(vIdx);
            return 0;
          }
          if (k === ExprKind.Negate) return -evalNumericAt(arena.getExprLeft(exprId), stateMap);
          if (k === ExprKind.Binary) {
            const op = arena.getExprData1(exprId);
            const lv = evalNumericAt(arena.getExprLeft(exprId), stateMap);
            const rv = evalNumericAt(arena.getExprRight(exprId), stateMap);
            if (op === BinOp.Add) return lv + rv;
            if (op === BinOp.Sub) return lv - rv;
            if (op === BinOp.Mul) return lv * rv;
            if (op === BinOp.Div) return rv !== 0 ? lv / rv : 0;
            if (op === BinOp.Pow) return Math.pow(lv, rv);
          }
          return 0;
        };

        const f = (x: number[]): number[] => {
          const stateMap = new Map<number, number>();
          stateIdxList.forEach((sv, idx) => stateMap.set(sv, x[idx] ?? 0));
          return stateIdxList.map((sv) => {
            const rhsId = derRhsMap.get(sv);
            return rhsId !== undefined ? evalNumericAt(rhsId, stateMap) : 0;
          });
        };
        const barrierRes = SosBarrierSynthesizer.synthesizeQuadratic(
          { numVars: stateIdxList.length, f },
          { initialRadius, unsafeRadius },
        );
        if (!barrierRes.candidateFound) {
          diags.push(
            makeFormalDiag(
              ModelicaErrorCode.FORMAL_BARRIER_CERTIFICATE_NOT_FOUND,
              className,
              "reachability",
              classRange,
              [className, barrierRes.summary],
            ),
          );
        }
      }
    }
  }

  return diags;
}

/**
 * Normalizes `lhs - rhs` via E-graph algebraic simplification to detect tautologies (`0 = 0`),
 * contradictions (`c = 0`), and redundant equations without mutating the arena's equation table.
 */
function checkAlgebraicFormal(
  arena: DAEBuilder,
  className: string,
  classRange: Range | null,
): ModelicaFormalDiagnostic[] {
  const diags: ModelicaFormalDiagnostic[] = [];
  const seenResiduals = new Map<string, string>();

  for (let eq = 0; eq < arena.eqCount; eq++) {
    if (arena.isEqRemoved?.(eq)) continue;
    if (arena.getEqKind(eq) !== EqKind.Simple) continue;
    if (isSimpleAliasEquation(arena, eq)) continue;

    const lhs = arena.getEqLhs(eq);
    const rhs = arena.getEqRhs(eq);
    if (lhs < 0 || rhs < 0) continue;

    const eqText = printArenaEqSafe(arena, eq);
    const residual = arena.addBinaryExpr(BinOp.Sub, lhs, rhs);
    const simplified = simplifyArenaExpr(arena, residual);
    const numVal = evalScalarLiteralNumber(arena, simplified);

    if (numVal !== null) {
      if (Math.abs(numVal) === 0) {
        diags.push(
          makeFormalDiag(ModelicaErrorCode.FORMAL_EQUATION_TAUTOLOGY, className, "algebraic", classRange, [eqText]),
        );
      } else {
        diags.push(
          makeFormalDiag(ModelicaErrorCode.FORMAL_EQUATION_CONTRADICTION, className, "algebraic", classRange, [
            eqText,
            String(numVal),
          ]),
        );
      }
      continue;
    }

    const revResidual = arena.addBinaryExpr(BinOp.Sub, rhs, lhs);
    const revSimplified = simplifyArenaExpr(arena, revResidual);
    const sigA = printArenaExprSafe(arena, simplified);
    const sigB = printArenaExprSafe(arena, revSimplified);
    const canonicalSig = sigA <= sigB ? `${sigA}|${sigB}` : `${sigB}|${sigA}`;

    const prevEqText = seenResiduals.get(canonicalSig);
    if (prevEqText !== undefined) {
      diags.push(
        makeFormalDiag(ModelicaErrorCode.FORMAL_REDUNDANT_EQUATION, className, "algebraic", classRange, [
          eqText,
          prevEqText,
        ]),
      );
    } else {
      seenResiduals.set(canonicalSig, eqText);
    }
  }

  // M7704: Dimensional inference & homogeneity check using DimensionalOracle units
  {
    const parseUnitTerm = (tok: string): DimensionVector | null => {
      const t = tok.trim();
      if (!t || t === "1") return DIMENSION_DIMENSIONLESS;
      if (STANDARD_UNITS[t]) return STANDARD_UNITS[t]!;
      const powMatch = /^([A-Za-z_µ]+)\^?(-?[0-9]+)$/.exec(t);
      if (powMatch && STANDARD_UNITS[powMatch[1]!]) {
        const base = STANDARD_UNITS[powMatch[1]!]!;
        const exp = Number(powMatch[2]!);
        return [
          base[0] * exp,
          base[1] * exp,
          base[2] * exp,
          base[3] * exp,
          base[4] * exp,
          base[5] * exp,
          base[6] * exp,
        ];
      }
      return null;
    };

    const parseUnitDim = (raw: string): DimensionVector | null => {
      const clean = raw.trim().replace(/^"|"$/g, "").trim();
      if (!clean) return null;
      if (STANDARD_UNITS[clean]) return STANDARD_UNITS[clean]!;
      const slashIdx = clean.indexOf("/");
      const numPart = slashIdx >= 0 ? clean.slice(0, slashIdx) : clean;
      const denPart = slashIdx >= 0 ? clean.slice(slashIdx + 1) : "";
      const acc: DimensionVector = [0, 0, 0, 0, 0, 0, 0];
      let matched = false;
      for (const part of numPart.split(/[.*·\s]+/).filter(Boolean)) {
        const d = parseUnitTerm(part);
        if (!d) return null;
        matched = true;
        for (let i = 0; i < 7; i++) acc[i] = (acc[i] ?? 0) + d[i]!;
      }
      if (denPart) {
        const denClean = denPart.replace(/^\((.*)\)$/, "$1");
        for (const part of denClean.split(/[.*·\s]+/).filter(Boolean)) {
          const d = parseUnitTerm(part);
          if (!d) return null;
          matched = true;
          for (let i = 0; i < 7; i++) acc[i] = (acc[i] ?? 0) - d[i]!;
        }
      }
      return matched ? acc : null;
    };

    const varDims = new Map<number, DimensionVector>();
    for (let v = 0; v < arena.varCount; v++) {
      if (arena.isVarRemoved(v)) continue;
      const uExpr = arena.getVarAttr(v, "unit");
      if (uExpr === undefined) continue;
      const d = parseUnitDim(printArenaExprSafe(arena, uExpr));
      if (d) varDims.set(v, d);
    }

    const addVec = (a: DimensionVector, b: DimensionVector, sign: 1 | -1): DimensionVector => [
      a[0] + sign * b[0],
      a[1] + sign * b[1],
      a[2] + sign * b[2],
      a[3] + sign * b[3],
      a[4] + sign * b[4],
      a[5] + sign * b[5],
      a[6] + sign * b[6],
    ];

    const emittedMismatches = new Set<string>();
    const evalDim = (exprId: number, reportMismatches: boolean): DimensionVector | null => {
      if (exprId < 0) return null;
      const k = arena.getExprKind(exprId);
      if (k === ExprKind.Name) {
        const vIdx = arena.lookupVariable(arena.getExprData1(exprId));
        return vIdx >= 0 ? (varDims.get(vIdx) ?? null) : null;
      }
      if (k === ExprKind.Negate) return evalDim(arena.getExprLeft(exprId), reportMismatches);
      if (k === ExprKind.Der) {
        const inner = evalDim(arena.getExprData1(exprId), reportMismatches);
        return inner ? addVec(inner, DIMENSION_TIME, -1) : null;
      }
      if (k === ExprKind.Binary) {
        const op = arena.getExprData1(exprId);
        const l = arena.getExprLeft(exprId);
        const r = arena.getExprRight(exprId);
        const dl = evalDim(l, reportMismatches);
        const dr = evalDim(r, reportMismatches);
        if (op === BinOp.Add || op === BinOp.Sub) {
          if (dl && dr && !areDimensionsEqual(dl, dr)) {
            if (reportMismatches) {
              const txt = printArenaExprSafe(arena, exprId);
              if (!emittedMismatches.has(txt)) {
                emittedMismatches.add(txt);
                diags.push(
                  makeFormalDiag(
                    ModelicaErrorCode.FORMAL_DIMENSION_MISMATCH_INFERRED,
                    className,
                    "algebraic",
                    classRange,
                    [txt, formatDimension(dl), formatDimension(dr)],
                  ),
                );
              }
            }
            return null;
          }
          return dl ?? dr;
        }
        if (op === BinOp.Mul) {
          if (dl && dr) return addVec(dl, dr, 1);
          if (dl && evalScalarLiteralNumber(arena, r) !== null) return dl;
          if (dr && evalScalarLiteralNumber(arena, l) !== null) return dr;
          return null;
        }
        if (op === BinOp.Div) {
          if (dl && dr) return addVec(dl, dr, -1);
          if (dl && evalScalarLiteralNumber(arena, r) !== null) return dl;
          if (dr && evalScalarLiteralNumber(arena, l) !== null) return addVec(DIMENSION_DIMENSIONLESS, dr, -1);
          return null;
        }
        if (op === BinOp.Pow) {
          const expNum = evalScalarLiteralNumber(arena, r);
          if (dl && expNum !== null && Number.isInteger(expNum)) {
            return [
              dl[0] * expNum,
              dl[1] * expNum,
              dl[2] * expNum,
              dl[3] * expNum,
              dl[4] * expNum,
              dl[5] * expNum,
              dl[6] * expNum,
            ];
          }
        }
      }
      return null;
    };

    if (varDims.size > 0) {
      // Fixed-point propagation: infer unannotated LHS variable dimensions from RHS equations
      for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        for (let eq = 0; eq < arena.eqCount; eq++) {
          if (arena.isEqRemoved?.(eq) || arena.getEqKind(eq) !== EqKind.Simple) continue;
          const lhs = arena.getEqLhs(eq);
          const rhs = arena.getEqRhs(eq);
          if (lhs >= 0 && arena.getExprKind(lhs) === ExprKind.Name) {
            const vIdx = arena.lookupVariable(arena.getExprData1(lhs));
            if (vIdx >= 0 && !varDims.has(vIdx)) {
              const dr = evalDim(rhs, false);
              if (dr) {
                varDims.set(vIdx, dr);
                changed = true;
              }
            }
          }
        }
        if (!changed) break;
      }

      for (let eq = 0; eq < arena.eqCount; eq++) {
        if (arena.isEqRemoved?.(eq) || arena.getEqKind(eq) !== EqKind.Simple) continue;
        const lhs = arena.getEqLhs(eq);
        const rhs = arena.getEqRhs(eq);
        const dl = evalDim(lhs, true);
        const dr = evalDim(rhs, true);
        if (dl && dr && !areDimensionsEqual(dl, dr)) {
          const eqText = printArenaEqSafe(arena, eq);
          if (!emittedMismatches.has(eqText)) {
            emittedMismatches.add(eqText);
            diags.push(
              makeFormalDiag(ModelicaErrorCode.FORMAL_DIMENSION_MISMATCH_INFERRED, className, "algebraic", classRange, [
                eqText,
                formatDimension(dl),
                formatDimension(dr),
              ]),
            );
          }
        }
      }
    }
  }

  return diags;
}

function checkHybridFormal(
  arena: DAEBuilder,
  className: string,
  classRange: Range | null,
  classCst: CstNodeLike | null = null,
): ModelicaFormalDiagnostic[] {
  const diags: ModelicaFormalDiagnostic[] = [];
  let hasWhen = false;
  for (let eq = 0; eq < arena.eqCount; eq++) {
    if (!arena.isEqRemoved?.(eq) && arena.getEqKind(eq) === EqKind.When) {
      hasWhen = true;
      break;
    }
  }

  if (hasWhen) {
    const stateSet = new Set(collectStateVarIndices(arena));
    const verifier = new HybridModeConsistencyVerifier(arena, stateSet.size > 0 ? { stateVars: stateSet } : {});
    const res = verifier.verify();
    for (const issue of res.issues) {
      const sev: DiagnosticSeverity = issue.severity === "definite" ? "error" : "warning";
      if (issue.kind === "zeno_chattering_detected") {
        diags.push(
          makeFormalDiag(
            ModelicaErrorCode.FORMAL_ZENO_CHATTERING,
            className,
            "hybrid",
            classRange,
            [issue.message],
            sev,
          ),
        );
      } else if (issue.kind === "nondeterministic_mode_switch") {
        diags.push(
          makeFormalDiag(
            ModelicaErrorCode.FORMAL_NONDETERMINISTIC_MODE_SWITCH,
            className,
            "hybrid",
            classRange,
            [issue.message],
            sev,
          ),
        );
      } else if (issue.kind === "state_jump_discontinuity") {
        const varLabel = issue.varName ?? `var#${issue.varIdx ?? "?"}`;
        diags.push(
          makeFormalDiag(
            ModelicaErrorCode.FORMAL_REINIT_DISCONTINUITY,
            className,
            "hybrid",
            classRange,
            [varLabel, issue.message],
            sev,
          ),
        );
      }
    }
  }

  // M7404: Sliding-mode chattering via IntervalNewtonRootFinder on switching surfaces where vector fields attract from both sides
  const evaluator = new DaeIntervalEvaluator(arena, { checkAttributes: true });
  const emittedGuards = new Set<string>();
  const checkSlidingBranches = (
    stateName: string,
    guardExpr: string,
    cmpVar: string,
    op: string,
    threshold: number,
    aboveIv: NumericalInterval,
    belowIv: NumericalInterval,
  ) => {
    if (cmpVar !== stateName) return;
    if (aboveIv.isBottom() || belowIv.isBottom()) return;
    // Sliding attractor: on x > th, der(x) < 0; on x < th, der(x) > 0
    if (aboveIv.high < -1e-6 && belowIv.low > 1e-6) {
      const rootIv = IntervalNewtonRootFinder.refineRoot(
        (iv) => ({ value: new Interval(iv.lo - threshold, iv.hi - threshold), deriv: new Interval(1, 1) }),
        new Interval(threshold - 1.0, threshold + 1.0),
        6,
        1e-4,
      );
      if (!emittedGuards.has(guardExpr)) {
        emittedGuards.add(guardExpr);
        const winStr = `[${rootIv.lo.toFixed(4)}, ${rootIv.hi.toFixed(4)}]`;
        diags.push(
          makeFormalDiag(ModelicaErrorCode.FORMAL_SLIDING_MODE_CHATTERING, className, "hybrid", classRange, [
            `${guardExpr} (${op} ${threshold})`,
            winStr,
          ]),
        );
      }
    }
  };

  for (let eq = 0; eq < arena.eqCount; eq++) {
    if (arena.isEqRemoved?.(eq) || arena.isEqInitial?.(eq) || arena.getEqKind(eq) !== EqKind.Simple) continue;
    const lhs = arena.getEqLhs(eq);
    const rhs = arena.getEqRhs(eq);
    if (lhs < 0 || rhs < 0 || arena.getExprKind(lhs) !== ExprKind.Der) continue;
    const derArg = arena.getExprData1(lhs);
    if (derArg < 0 || arena.getExprKind(derArg) !== ExprKind.Name) continue;
    const stateIdx = arena.lookupVariable(arena.getExprData1(derArg));
    if (stateIdx < 0) continue;
    const stateName = arena.getVarName(stateIdx);
    if (arena.getExprKind(rhs) !== ExprKind.IfElse) continue;

    const condId = arena.getExprData1(rhs);
    const trueExpr = arena.getExprLeft(rhs);
    const falseExpr = arena.getExprRight(rhs);
    const guardText = printArenaExprSafe(arena, condId);
    const gm = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(>=|>|<=|<)\s*(-?[0-9]+(?:\.[0-9]+)?)\s*$/.exec(guardText);
    if (!gm) continue;
    const op = gm[2]!;
    const th = Number(gm[3]!);
    const trueIv = evaluator.evaluateExpr(trueExpr).interval;
    const falseIv = evaluator.evaluateExpr(falseExpr).interval;
    const isGreater = op === ">" || op === ">=";
    checkSlidingBranches(
      stateName,
      guardText,
      gm[1]!,
      op,
      th,
      isGreater ? trueIv : falseIv,
      isGreater ? falseIv : trueIv,
    );
  }

  // Fallback CST scan in case conditional branch constant folding rewrote ExprKind.IfElse before arena arrival
  if (emittedGuards.size === 0 && classCst) {
    for (const se of findCstNodesByType(classCst, "simple_equation")) {
      const txt = String(se.text ?? "");
      const m =
        /^\s*der\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*=\s*if\s+([A-Za-z_][A-Za-z0-9_]*)\s*(>=|>|<=|<)\s*(-?[0-9]+(?:\.[0-9]+)?)\s+then\s+(-?[0-9]+(?:\.[0-9]+)?)\s+else\s+(-?[0-9]+(?:\.[0-9]+)?)/.exec(
          txt,
        );
      if (!m) continue;
      const op = m[3]!;
      const th = Number(m[4]!);
      const tVal = Number(m[5]!);
      const fVal = Number(m[6]!);
      const isGreater = op === ">" || op === ">=";
      checkSlidingBranches(
        m[1]!,
        `${m[2]} ${op} ${m[4]}`,
        m[2]!,
        op,
        th,
        new NumericalInterval(isGreater ? tVal : fVal, isGreater ? tVal : fVal),
        new NumericalInterval(isGreater ? fVal : tVal, isGreater ? fVal : tVal),
      );
    }
  }

  return diags;
}

function checkStateMachineFormal(
  arena: DAEBuilder,
  className: string,
  classRange: Range | null,
): ModelicaFormalDiagnostic[] {
  const sms = arena.getStateMachines?.() ?? [];
  if (sms.length === 0) return [];

  const diags: ModelicaFormalDiagnostic[] = [];
  const evaluator = new DaeIntervalEvaluator(arena, { checkAttributes: true });
  const { oct, varToOctIdx } = buildParameterOctagon(arena, evaluator);
  if (!oct.hasNegativeCycle()) {
    for (const [vIdx, octIdx] of varToOctIdx) {
      const lo = oct.getLowerBound(octIdx);
      const hi = oct.getUpperBound(octIdx);
      if (Number.isFinite(lo) || Number.isFinite(hi)) {
        evaluator.setVarBound(
          vIdx,
          new NumericalInterval(Number.isFinite(lo) ? lo : -Infinity, Number.isFinite(hi) ? hi : Infinity),
        );
      }
    }
  }

  for (const sm of sms) {
    const stateSet = new Set<string>(sm.states.map((s) => s.name));
    if (sm.initialState) stateSet.add(sm.initialState);
    for (const tr of sm.transitions) {
      stateSet.add(tr.fromState);
      stateSet.add(tr.toState);
    }
    const stateNames = Array.from(stateSet);
    const stateToIdx = new Map<string, number>();
    stateNames.forEach((s, idx) => stateToIdx.set(s, idx));

    const truthByTransition = sm.transitions.map((tr) =>
      evaluateConditionTruth(arena, evaluator, oct, varToOctIdx, tr.conditionExprId),
    );

    // 1. Pairwise same-priority outgoing guard overlap (M7306)
    const byFromPrio = new Map<string, Array<{ idx: number; tr: (typeof sm.transitions)[number] }>>();
    sm.transitions.forEach((tr, idx) => {
      const key = `${tr.fromState}\0${tr.priority}`;
      let list = byFromPrio.get(key);
      if (!list) {
        list = [];
        byFromPrio.set(key, list);
      }
      list.push({ idx, tr });
    });
    for (const group of byFromPrio.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const g1 = group[i]!;
          const g2 = group[j]!;
          if (truthByTransition[g1.idx] === "false" || truthByTransition[g2.idx] === "false") continue;
          const conjExpr =
            g1.tr.conditionExprId >= 0 && g2.tr.conditionExprId >= 0
              ? arena.addBinaryExpr(BinOp.And, g1.tr.conditionExprId, g2.tr.conditionExprId)
              : -1;
          const conjTruth =
            conjExpr >= 0 ? evaluateConditionTruth(arena, evaluator, oct, varToOctIdx, conjExpr) : "unknown";
          if (conjTruth !== "false") {
            diags.push(
              makeFormalDiag(
                ModelicaErrorCode.FORMAL_STATE_MACHINE_GUARD_OVERLAP,
                className,
                "state-machine",
                classRange,
                [g1.tr.fromState, g1.tr.toState, g2.tr.toState, String(g1.tr.priority)],
              ),
            );
          }
        }
      }
    }

    // 2. Build IC3 TransitionSystem over one-hot state encoding (M7503) & deadlock check (M7307)
    const n = stateNames.length;
    const initIdx = sm.initialState ? (stateToIdx.get(sm.initialState) ?? 0) : 0;
    const adj: Set<number>[] = Array.from({ length: n }, (_, u) => new Set<number>([u]));
    const outgoingCount = new Array<number>(n).fill(0);
    const activeOutgoingCount = new Array<number>(n).fill(0);

    sm.transitions.forEach((tr, idx) => {
      const u = stateToIdx.get(tr.fromState);
      const v = stateToIdx.get(tr.toState);
      if (u === undefined || v === undefined) return;
      outgoingCount[u] = outgoingCount[u]! + 1;
      if (truthByTransition[idx] !== "false") {
        activeOutgoingCount[u] = activeOutgoingCount[u]! + 1;
        adj[u]!.add(v);
      }
    });

    const unreachableSet = new Set<number>();
    if (n >= 2) {
      const stateVars = Array.from({ length: n }, (_, i) => i + 1);
      const nextStateVars = Array.from({ length: n }, (_, i) => n + i + 1);
      const initClauses: number[][] = [];
      for (let i = 0; i < n; i++) {
        initClauses.push([i === initIdx ? stateVars[i]! : -stateVars[i]!]);
      }
      const transClauses: number[][] = [];
      transClauses.push([...nextStateVars]);
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          transClauses.push([-nextStateVars[a]!, -nextStateVars[b]!]);
        }
      }
      for (let u = 0; u < n; u++) {
        const targets = Array.from(adj[u]!);
        transClauses.push([-stateVars[u]!, ...targets.map((v) => nextStateVars[v]!)]);
      }

      for (let target = 0; target < n; target++) {
        if (target === initIdx) continue;
        const ts: TransitionSystem = {
          stateVars,
          nextStateVars,
          initClauses,
          transClauses,
          propClauses: [[-stateVars[target]!]],
        };
        const ic3 = new IC3Engine(ts);
        const proof = ic3.verify(Math.max(6, n + 2));
        if (proof.isProvenInvariant) {
          unreachableSet.add(target);
          diags.push(
            makeFormalDiag(
              ModelicaErrorCode.FORMAL_UNREACHABLE_STATE_MACHINE_STATE,
              className,
              "state-machine",
              classRange,
              [stateNames[target]!, stateNames[initIdx]!],
            ),
          );
        }
      }
    }

    // 3. Non-terminal state deadlock when all outgoing transition guards are unsat (M7307)
    for (let u = 0; u < n; u++) {
      if (unreachableSet.has(u)) continue;
      if ((outgoingCount[u] ?? 0) > 0 && (activeOutgoingCount[u] ?? 0) === 0) {
        diags.push(
          makeFormalDiag(ModelicaErrorCode.FORMAL_STATE_MACHINE_DEADLOCK, className, "state-machine", classRange, [
            stateNames[u]!,
          ]),
        );
      }
    }
  }

  return diags;
}

/**
 * Executes the on-demand `7xxx` formal verification suite directly on a flattened `DAEBuilder` arena.
 */
export async function verifyArenaFormal(
  arena: DAEBuilder,
  className: string,
  classCst: CstNodeLike | null = null,
  classRange: Range | null = null,
  options: FormalVerificationOptions = {},
): Promise<ModelicaFormalDiagnostic[]> {
  const diags: ModelicaFormalDiagnostic[] = [];
  const threshold = options.largeLoopThreshold ?? 4;

  let bltResult: ArenaBltResult | null = null;
  if (options.structural !== false) {
    const structRes = await checkStructuralFormal(arena, className, classRange, threshold, classCst);
    diags.push(...structRes.diagnostics);
    bltResult = structRes.bltResult;
  } else if (options.abstractInterpretation !== false && arena.eqCount > 0 && arena.varCount > 0) {
    try {
      await initBltWasm();
      bltResult = performBltTransformationArena(arena, collectStateVarIndices(arena));
    } catch {
      bltResult = null;
    }
  }

  if (options.abstractInterpretation !== false || options.satisfiability !== false || options.reachability !== false) {
    diags.push(...checkAbstractInterpAndSatFormal(arena, bltResult, className, classCst, classRange, options));
  }

  if (options.hybrid !== false) {
    diags.push(...checkHybridFormal(arena, className, classRange, classCst));
  }

  if (options.stateMachine !== false) {
    diags.push(...checkStateMachineFormal(arena, className, classRange));
  }

  if (options.algebraic !== false) {
    diags.push(...checkAlgebraicFormal(arena, className, classRange));
  }

  return diags;
}

/**
 * Executes the full on-demand `7xxx` formal verification suite across all matching Modelica
 * classes loaded in `context`.
 */
export async function verifyModelicaFormal(
  context: Context,
  options: FormalVerificationOptions = {},
): Promise<FormalVerificationResult> {
  const startMs = performance.now();
  const diagnostics: ModelicaFormalDiagnostic[] = [];
  const classesVerified: string[] = [];

  const targetFilter = options.classNames ? new Set(options.classNames) : null;
  const candidateEntries: Array<{ name: string; entry: any }> = [];
  const seenNames = new Set<string>();

  const db = context.queryEngine.toQueryDB();
  const resolveFqn = (sym: any): string => {
    const parts = [sym.name];
    let pId = sym.parentId;
    while (pId != null) {
      const parent = context.queryEngine.index.symbols.get(pId);
      if (!parent) break;
      parts.push(parent.name);
      pId = parent.parentId;
    }
    return parts.reverse().join(".");
  };

  for (const sym of context.queryEngine.index.symbols.values()) {
    if (sym.kind !== "Class" && sym.kind !== "Function") continue;
    if ((sym.metadata as Record<string, unknown> | undefined)?.["isPredefined"]) continue;
    if (sym.parentId !== null) {
      const parent = context.queryEngine.index.symbols.get(sym.parentId);
      if (parent && parent.kind !== "Package") continue;
    }
    const prefix = ((sym.metadata as Record<string, unknown> | undefined)?.["classPrefixes"] as string) ?? "";
    if (!targetFilter && prefix.includes("partial")) continue;
    const fqn = resolveFqn(sym);
    if (targetFilter && !targetFilter.has(sym.name) && !targetFilter.has(fqn)) continue;
    if (seenNames.has(fqn)) continue;
    seenNames.add(fqn);
    candidateEntries.push({ name: fqn, entry: sym });
  }

  interface ExtractedSysmlReq {
    reqName: string;
    subjectName?: string | undefined;
    targetVar: string;
    op: "<=" | ">=" | "<" | ">";
    limit: number;
    resourceId?: string | undefined;
  }
  const sysmlReqs: ExtractedSysmlReq[] = [];
  const polyglotSources: PolyglotModelSource[] = [];
  let collectPolyglotDrift = false;
  for (const sym of context.queryEngine.index.symbols.values()) {
    if (sym.language && sym.language !== "modelica") {
      collectPolyglotDrift = true;
      const meta = sym.metadata as Record<string, unknown> | undefined;
      if ((sym.language === "sysml2" || sym.language === "sysml") && meta) {
        const subjectName = typeof meta["subjectName"] === "string" ? meta["subjectName"] : undefined;
        if (
          typeof meta["targetAttribute"] === "string" &&
          (meta["operator"] === "<=" ||
            meta["operator"] === ">=" ||
            meta["operator"] === "<" ||
            meta["operator"] === ">") &&
          typeof meta["limitValue"] === "number" &&
          Number.isFinite(meta["limitValue"])
        ) {
          sysmlReqs.push({
            reqName: sym.name,
            subjectName,
            targetVar: meta["targetAttribute"],
            op: meta["operator"],
            limit: meta["limitValue"],
            resourceId: sym.resourceId,
          });
        } else if (typeof meta["constraint"] === "string") {
          const cm = /^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(<=|>=|<|>)\s*(-?[0-9]+(?:\.[0-9]+)?)\s*$/.exec(
            meta["constraint"],
          );
          if (cm) {
            sysmlReqs.push({
              reqName: sym.name,
              subjectName,
              targetVar: cm[1]!,
              op: cm[2]! as "<=" | ">=" | "<" | ">",
              limit: Number(cm[3]!),
              resourceId: sym.resourceId,
            });
          }
        }
      }
    }
  }

  for (const { name, entry } of candidateEntries) {
    const classCst = db.cstNode(entry.id) as CstNodeLike | null;
    const classRange = nodeToRange(classCst);
    const arena = context.flattenArena(name, entry.id, entry.resourceId, {
      omcCompatibility: false,
    });
    if (!arena) continue;

    classesVerified.push(name);
    const classDiags = await verifyArenaFormal(arena, name, classCst, classRange, options);
    diagnostics.push(...classDiags);

    if (sysmlReqs.length > 0 && options.satisfiability !== false) {
      const evalSysml = new DaeIntervalEvaluator(arena);
      for (const req of sysmlReqs) {
        if (req.subjectName && req.subjectName !== entry.name && req.subjectName !== name) continue;
        let targetIdx = -1;
        for (let v = 0; v < arena.varCount; v++) {
          if (!arena.isVarRemoved(v) && arena.getVarName(v) === req.targetVar) {
            targetIdx = v;
            break;
          }
        }
        if (targetIdx < 0) continue;

        let lo = -Infinity;
        let hi = Infinity;
        const bindExpr = arena.getVarBindingExpr(targetIdx) ?? arena.getVarExpression(targetIdx);
        if (bindExpr !== undefined && bindExpr >= 0) {
          const bIv = evalSysml.evaluateExpr(bindExpr).interval;
          if (!bIv.isBottom()) {
            lo = Math.max(lo, bIv.low);
            hi = Math.min(hi, bIv.high);
          }
        }
        const minExpr = arena.getVarAttr(targetIdx, "min");
        if (minExpr !== undefined) {
          const mIv = evalSysml.evaluateExpr(minExpr).interval;
          if (!mIv.isBottom() && Number.isFinite(mIv.low)) lo = Math.max(lo, mIv.low);
        }
        const maxExpr = arena.getVarAttr(targetIdx, "max");
        if (maxExpr !== undefined) {
          const mIv = evalSysml.evaluateExpr(maxExpr).interval;
          if (!mIv.isBottom() && Number.isFinite(mIv.high)) hi = Math.min(hi, mIv.high);
        }

        if (lo > -Infinity || hi < Infinity) {
          const unsat =
            (req.op === "<=" && lo > req.limit) ||
            (req.op === "<" && lo >= req.limit) ||
            (req.op === ">=" && hi < req.limit) ||
            (req.op === ">" && hi <= req.limit);
          if (unsat) {
            diagnostics.push(
              makeFormalDiag(
                ModelicaErrorCode.FORMAL_SYSML_REQUIREMENT_UNSATISFIABLE,
                name,
                "satisfiability",
                classRange,
                [
                  req.reqName,
                  `'${req.targetVar}' range [${lo}, ${hi}] violates constraint '${req.targetVar} ${req.op} ${req.limit}'`,
                ],
              ),
            );
          }
        }
      }
    }

    if (collectPolyglotDrift) {
      for (let v = 0; v < arena.varCount; v++) {
        if (arena.isVarRemoved(v) || arena.isVarVirtual(v)) continue;
        const varb = arena.getVarVariability(v);
        if (varb !== Variability.Parameter && varb !== Variability.Constant) continue;
        const fullName = arena.getVarName(v);
        const dotIdx = fullName.lastIndexOf(".");
        const comp = dotIdx > 0 ? fullName.slice(0, dotIdx) : entry.name;
        const param = dotIdx > 0 ? fullName.slice(dotIdx + 1) : fullName;
        const rawExpr = arena.getVarBindingExpr(v) ?? arena.getVarExpression(v);
        const bindExpr = rawExpr !== undefined && rawExpr >= 0 ? rawExpr : undefined;
        let numVal: number | null = bindExpr !== undefined ? evalScalarLiteralNumber(arena, bindExpr) : null;
        if (numVal === null) {
          const st = arena.getVarStartValue(v);
          if (Number.isFinite(st) && st !== 0) numVal = st;
        }
        if (numVal === null || !Number.isFinite(numVal)) continue;
        const unitExpr = arena.getVarAttr(v, "unit");
        const unitStr = unitExpr !== undefined ? printArenaExprSafe(arena, unitExpr).replace(/^"|"$/g, "") : undefined;
        polyglotSources.push({
          lang: "modelica",
          uri: entry.resourceId ?? name,
          component: comp,
          param,
          value: numVal,
          unit: unitStr || undefined,
        });
      }
    }
  }

  if (collectPolyglotDrift) {
    for (const sym of context.queryEngine.index.symbols.values()) {
      if (!sym.language || sym.language === "modelica") continue;
      const meta = sym.metadata as Record<string, unknown> | undefined;
      if (!meta) continue;
      const parentName = sym.parentId !== null ? context.queryEngine.index.symbols.get(sym.parentId)?.name : undefined;
      const compName = (typeof meta["component"] === "string" ? meta["component"] : parentName) ?? sym.name;
      const rawUnit = typeof meta["unit"] === "string" ? meta["unit"] : undefined;

      if (typeof meta["value"] === "number" && Number.isFinite(meta["value"])) {
        polyglotSources.push({
          lang: sym.language,
          uri: sym.resourceId ?? sym.name,
          component: compName,
          param: sym.name,
          value: meta["value"],
          unit: rawUnit,
          startOffset: sym.startOffset,
          endOffset: sym.endOffset,
        });
      }
      if (meta["params"] && typeof meta["params"] === "object") {
        for (const [k, rawV] of Object.entries(meta["params"] as Record<string, unknown>)) {
          if (typeof rawV === "number" && Number.isFinite(rawV)) {
            polyglotSources.push({
              lang: sym.language,
              uri: sym.resourceId ?? sym.name,
              component: sym.name,
              param: k,
              value: rawV,
              unit: rawUnit,
              startOffset: sym.startOffset,
              endOffset: sym.endOffset,
            });
          }
        }
      }
    }

    if (polyglotSources.length >= 2) {
      const driftViolations = PolyglotDriftChecker.checkDrift(polyglotSources, { tolerance: 1e-3 });
      for (const dv of driftViolations) {
        if (dv.sourceA.lang === dv.sourceB.lang) continue;
        if (dv.sourceA.lang !== "modelica" && dv.sourceB.lang !== "modelica") continue;
        const mSrc = dv.sourceA.lang === "modelica" ? dv.sourceA : dv.sourceB;
        diagnostics.push(
          makeFormalDiag(ModelicaErrorCode.FORMAL_POLYGLOT_PARAMETER_DRIFT, mSrc.component, "reachability", null, [
            dv.canonicalParam,
            dv.componentName,
            dv.message,
          ]),
        );
      }
    }
  }

  const summary = {
    errors: 0,
    warnings: 0,
    info: 0,
    structural: 0,
    abstractInterpretation: 0,
    satisfiability: 0,
    hybrid: 0,
    reachability: 0,
    stateMachine: 0,
    algebraic: 0,
  };
  for (const d of diagnostics) {
    if (d.severity === "error") summary.errors++;
    else if (d.severity === "warning") summary.warnings++;
    else summary.info++;

    if (d.category === "structural") summary.structural++;
    else if (d.category === "abstract-interpretation") summary.abstractInterpretation++;
    else if (d.category === "satisfiability") summary.satisfiability++;
    else if (d.category === "hybrid") summary.hybrid++;
    else if (d.category === "reachability") summary.reachability++;
    else if (d.category === "state-machine") summary.stateMachine++;
    else if (d.category === "algebraic") summary.algebraic++;
  }

  return {
    diagnostics,
    classesVerified,
    durationMs: performance.now() - startMs,
    summary,
  };
}
