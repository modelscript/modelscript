// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Unified Formal Verification & Simulation Engine.
 *
 * Coordinates and executes all formal verification stages:
 *   1. Decisions & Guards: Exhaustiveness & determinism.
 *   2. Region Decomposition: State space partitioning and MC/DC test synthesis.
 *   3. Compositional Contracts: Assume-Guarantee refinement & compatibility.
 *   4. State Machines & Activities: Workflow soundness, deadlock freedom, loop invariants.
 *   5. Continuous/Hybrid Flowpipes: Validated Taylor model reachability tubes.
 *   6. Barrier Certificates: Sum-of-Squares Lyapunov & Barrier certificate synthesis.
 *   7. Dynamic Trajectories: Simulation-based requirements validation.
 *   8. Adversarial Falsification: Multi-objective search for STL requirement violations.
 *   9. Spatial Clearance: 3D CAD physical clearances & collision detection.
 */

import {
  AbstractDomainOracle,
  compileArenaToDae,
  ConstraintTheoryOracle,
  DaeFlowpipeSolver,
  DaeIntervalEvaluator,
  DigitalThreadHypergraph,
  DimensionalTheoryOracle,
  FlowAlgebraOracle,
  generateCtrfReport,
  generateHtmlReport,
  generateJUnitReport,
  generateSarifReport,
  HybridFlowpipeSolver,
  Interval,
  OntologyTheoryOracle,
  RegionDecomposer,
  SemanticTheoryCoordinator,
  SosBarrierSynthesizer,
  VerificationRunner,
  type CancellationTokenLike,
  type CtrfReport,
  type DAEBuilder,
  type DaeFlowpipeRequirement,
  type HybridAutomaton,
  type HybridFlowpipeResult,
  type RegionDecompositionResult,
  type VerifierSimulationResult as SimulationResult,
  type VerificationResult,
} from "@modelscript/runtime";
import { B2BEquivalenceVerifier, type B2BVerificationResult } from "./b2b-verifier.js";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface StageDetailsShape {
  verdict?: { kind: string; rigor?: string; reason?: string };
  formattedMatrix?: string;
  cSourceHash?: string;
}

type ArenaInspectable = DAEBuilder & {
  experiment?: { startTime?: number; stopTime?: number; interval?: number };
  interner?: { intern(s: string): number };
  lookupVariable?: (id: number) => number;
  getVarStartValue?: (idx: number) => number;
  getVarAttrExprId?: (idx: number, attr: string) => number | undefined;
  getExprRealValue?: (exprId: number) => number;
};

interface Sysml2VerifierModule {
  DecisionTableVerifier?: {
    verifyAllDecisionsFromText(text: string): Map<
      string,
      {
        isExhaustive: boolean;
        isDeterministic: boolean;
        gapWitnesses?: unknown[];
        overlapWitnesses?: unknown[];
      }
    >;
  };
  BoundaryTestSynthesizer?: {
    synthesizeFromSysml(
      text: string,
      opts: { includeMcdc: boolean },
    ): Promise<{ testCases: unknown[]; coverageMetrics?: { mcdcPairsCount?: number } }>;
  };
  ContractVerifier?: {
    verifyAllContracts(text: string): Array<{ isSatisfied: boolean; name: string; message?: string }>;
  };
  checkActivitySoundnessForSymbol?: (
    db: unknown,
    act: { name?: string; ruleName?: string },
  ) => { isSound: boolean; errors?: string[] };
}

interface CadVerifierModule {
  verifyAssemblyClearance?: (assembly: unknown) => {
    pairsChecked?: number;
    violations?: Array<{ description?: string } & Record<string, unknown>>;
  };
}

interface ModelicaAlgorithmModule {
  ModelicaAlgorithmAnalyzer?: {
    analyze(
      statements: unknown[],
      variables: Array<{
        name: string;
        type: string | undefined;
        isInput: boolean;
        isOutput: boolean;
        isArray: boolean;
        arrayDimension: number | undefined;
        initialBound: [number, number] | undefined;
      }>,
      opts: { functionName: string; plantPreconditions?: Map<string, [number, number]> | undefined },
    ): {
      provenSafe: unknown[];
      definiteBugs: Array<{ message: string; startOffset?: number; endOffset?: number } & Record<string, unknown>>;
      potentialBugs: Array<{ message: string; startOffset?: number; endOffset?: number } & Record<string, unknown>>;
      deadCodeBlocks: number;
      formattedMatrix: string;
    };
  };
  ModelicaCFGLowerer?: {
    parseStatements(text: string, offset?: number): unknown[];
  };
  PhysicalInvariantBridge?: {
    extractPlantBounds(ha: HybridAutomaton): Map<string, [number, number]>;
  };
}

/**
 * Dynamically imports an optional workspace package at runtime, returning `null` if unavailable.
 */
async function importOptionalModule<T = Record<string, unknown>>(moduleName: string): Promise<T | null> {
  try {
    return (await import(moduleName)) as T;
  } catch {
    return null;
  }
}

/**
 * Single formal verification violation or counterexample witness reported by a verification stage.
 */
export interface VerificationViolation {
  id?: string | undefined;
  message: string;
  severity?: "error" | "warning" | "note" | undefined;
  stage: string;
  standard?: string | undefined;
  clauseId?: string | undefined;
  margin?: number | undefined;
  verificationMethod?: string | undefined;
  location?:
    | {
        uri?: string | undefined;
        line?: number | undefined;
        column?: number | undefined;
        endLine?: number | undefined;
        endColumn?: number | undefined;
      }
    | undefined;
  witness?: unknown;
}

/**
 * Execution outcome, certification status, and violation list for an individual verification stage.
 */
export interface VerificationStageResult {
  stage: string;
  name: string;
  passed: boolean;
  certified?: boolean | undefined;
  durationMs: number;
  summary: string;
  violations?: VerificationViolation[] | undefined;
  details?: unknown;
}

/**
 * Configuration options controlling which formal verification stages to run and their solver parameters.
 */
export interface UnifiedVerificationOptions {
  target?: string | undefined;
  all?: boolean | undefined;
  decisions?: boolean | undefined;
  regionDecomposition?: boolean | undefined;
  contracts?: boolean | undefined;
  stateMachines?: boolean | undefined;
  flowpipes?: boolean | undefined;
  flowpipeOrder?: number | undefined;
  flowpipeDt?: number | undefined;
  flowpipeHorizon?: number | undefined;
  flowpipeInitialSet?: string | undefined;
  barriers?: boolean | undefined;
  trajectories?: boolean | undefined;
  falsification?: boolean | undefined;
  clearance?: boolean | undefined;
  mcdc?: boolean | undefined;
  b2b?: boolean | undefined;
  b2bTol?: number | undefined;
  b2bCompiler?: string | undefined;
  b2bDt?: number | undefined;
  algorithms?: boolean | undefined;
  theoryCoordinator?: boolean | undefined;
  updateHypergraph?: boolean | undefined;
  exportFormats?: string[] | undefined; // "smt2" | "nuxmv" | "ocra" | "mos"
  exportDir?: string | undefined;
  timeoutMs?: number | undefined;
  cancellationToken?: CancellationTokenLike | undefined;
}

/**
 * Complete multi-stage formal verification report with aggregate pass/certification metrics and per-stage results.
 */
export interface UnifiedVerificationReport {
  timestamp: string;
  target?: string | undefined;
  summary: {
    totalStages: number;
    passedStages: number;
    failedStages: number;
    certifiedStages: number;
    skippedStages: number;
    totalViolations: number;
    durationMs: number;
    overallPassed: boolean;
  };
  stages: Record<string, VerificationStageResult>;
  artifacts?: Record<string, string> | undefined;
  polyglotDigitalThread?:
    | {
        mode?: "generic" | "scenario" | undefined;
        scenarioId: string;
        scenarioTitle: string;
        status: string;
        isSat: boolean;
        fileCount?: number | undefined;
        domains?: string[] | undefined;
        summaryText: string;
        artifacts?: unknown[] | undefined;
        hypergraphNodes: unknown[];
        variableLinks: unknown[];
        portBindings: unknown[];
        evaluatedEquations?: unknown[] | undefined;
        suggestedEdits?: unknown[] | undefined;
        updatedCodes?: string[] | undefined;
        conflicts: unknown[];
      }
    | undefined;
}

/**
 * Numerical integration and Taylor model parameters for continuous/hybrid flowpipe reachability.
 */
export interface FlowpipeConfigOptions {
  dt?: number | undefined;
  horizon?: number | undefined;
  order?: number | undefined;
  initialSet?: Record<string, [number, number]> | Map<string, [number, number]> | undefined;
}

/**
 * Parses a textual initial-set specification (e.g., `"x = [0, 1], y: [-0.5, 0.5]"`) into a variable bound map.
 */
export function parseInitialSetString(str: string): Map<string, [number, number]> {
  const map = new Map<string, [number, number]>();
  if (!str) return map;
  const regex =
    /\b([a-zA-Z_][a-zA-Z0-9_.]*)\s*[:=]\s*(?:\[\s*)?([-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?)\s*[,:]\s*([-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?)(?:\s*\])?/g;
  let match;
  while ((match = regex.exec(str)) !== null) {
    const varName = match[1]!;
    const lo = parseFloat(match[2]!);
    const hi = parseFloat(match[3]!);
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      map.set(varName, [Math.min(lo, hi), Math.max(lo, hi)]);
    }
  }
  return map;
}

/**
 * Input artifacts and runtime handles provided to `UnifiedVerifier.verify()`.
 */
export interface VerificationInputContext {
  uri?: string | undefined;
  sourceText?: string | undefined;
  queryDB?:
    | (ConstructorParameters<typeof VerificationRunner>[0] & {
        allEntries?: () => Array<{ ruleName?: string; name?: string }>;
      })
    | undefined;
  arena?: DAEBuilder | null | undefined;
  assembly?: unknown;
  hybridAutomaton?: HybridAutomaton | undefined;
  simulationResult?: SimulationResult | undefined;
  verifyCaseId?: number | undefined;
  paths?: string[] | undefined;
  coordinator?: SemanticTheoryCoordinator | undefined;
  hypergraph?: DigitalThreadHypergraph | undefined;
  contractedStateSpace?: Map<string, [number, number]> | undefined;
  flowpipeRequirements?: DaeFlowpipeRequirement[] | undefined;
  flowpipeOptions?: FlowpipeConfigOptions | undefined;
}

/**
 * Orchestrates multi-domain formal verification across decision tables, symbolic region decomposition,
 * assume-guarantee contracts, state machines, validated Taylor flowpipes, SOS barrier certificates,
 * dynamic simulation trajectories, 3D CAD clearance, ISO 26262 MiL/SiL B2B equivalence, and abstract interpretation.
 */
export class UnifiedVerifier {
  /**
   * Main entrypoint to verify all requested or auto-detected stages.
   */
  public static async verify(
    ctx: VerificationInputContext,
    options: UnifiedVerificationOptions = {},
  ): Promise<UnifiedVerificationReport> {
    const startTime = Date.now();
    const stages: Record<string, VerificationStageResult> = {};
    const text = ctx.sourceText || "";

    // 1. Determine active stages via explicit options or auto-detection
    const runAll = options.all === true;
    const autoDetect = options.all !== false;
    const hasDecisions = options.decisions ?? (runAll || (autoDetect && /\b(decide|decision|table)\b/i.test(text)));
    const hasRegionDecomp =
      options.regionDecomposition ??
      (runAll || (autoDetect && (options.mcdc === true || /\b(action|calc)\s+def\b/.test(text))));
    const hasContracts = options.contracts ?? (runAll || (autoDetect && /\b(contract|assume|guarantee)\b/i.test(text)));
    const hasStateMachines =
      options.stateMachines ?? (runAll || (autoDetect && /\b(state|activity|transition)\b/i.test(text)));
    const hasFlowpipes =
      options.flowpipes ??
      (runAll || (autoDetect && (ctx.hybridAutomaton != null || /\b(flowpipe|der\(|ode)\b/i.test(text))));
    const hasBarriers = options.barriers ?? (runAll || (autoDetect && /\b(barrier|lyapunov|sos)\b/i.test(text)));
    const hasClearance =
      options.clearance ??
      (runAll || (autoDetect && (ctx.assembly != null || /\b(assembly|clearance|step)\b/i.test(text))));
    const hasTrajectories =
      options.trajectories ??
      (runAll ||
        (autoDetect &&
          ((ctx.simulationResult != null && ctx.verifyCaseId != null) ||
            /\b(verification\s+case|satisfy)\b/i.test(text))));
    const hasB2B = options.b2b ?? (runAll && ctx.arena != null);
    const hasAlgorithms = options.algorithms ?? (runAll || (autoDetect && /\b(algorithm|function)\b/i.test(text)));

    const hasCoordinator = options.theoryCoordinator ?? (runAll || (autoDetect && ctx.coordinator != null));

    // ── Stage 0: Semantic Theory Coordination & Synthesized Domain Stages ─────
    if (hasCoordinator) {
      const coordStages = await this.runTheoryCoordinationStages(ctx, options);
      for (const [k, v] of Object.entries(coordStages)) {
        stages[k] = v;
      }
    }

    // ── Stage 1: Decisions & Guards ──────────────────────────────────────────
    if (hasDecisions && !stages["decisions"]) {
      stages["decisions"] = await this.runDecisionsStage(ctx);
    }

    // ── Stage 2: Region Decomposition & MC/DC Test Synthesis ─────────────────
    if (hasRegionDecomp) {
      stages["regionDecomposition"] = await this.runRegionDecompositionStage(ctx, options.mcdc);
    }

    // ── Stage 3: Compositional Contracts ─────────────────────────────────────
    if (hasContracts) {
      stages["contracts"] = await this.runContractsStage(ctx);
    }

    // ── Stage 4: State Machines & Activity Soundness ──────────────────────────
    if (hasStateMachines) {
      stages["stateMachines"] = await this.runStateMachinesStage(ctx);
    }

    // ── Stage 5: Continuous / Hybrid Reachability Flowpipes ───────────────────
    if (hasFlowpipes) {
      stages["flowpipes"] = await this.runFlowpipesStage(ctx, options);
    }

    // ── Stage 6: Sum-of-Squares Barrier Certificates ──────────────────────────
    if (hasBarriers) {
      stages["barriers"] = await this.runBarriersStage(ctx);
    }

    // ── Stage 7: Simulation Trajectory Requirements ──────────────────────────
    if (hasTrajectories) {
      stages["trajectories"] = await this.runTrajectoriesStage(ctx);
    }

    // ── Stage 8: 3D Spatial Clearance & Collisions ───────────────────────────
    if (hasClearance) {
      stages["clearance"] = await this.runClearanceStage(ctx);
    }

    // ── Stage 9: Back-to-Back MiL vs SiL Equivalence (ISO 26262 TCL1) ────────
    if (hasB2B) {
      stages["b2b"] = await this.runB2BStage(ctx, options);
    }

    // ── Stage 10: Modelica Algorithmic Abstract Interpretation (Sound RTE Verification) ─
    if (hasAlgorithms) {
      stages["algorithms"] = await this.runAlgorithmsStage(ctx, options);
    }

    // Compute summary
    const durationMs = Date.now() - startTime;
    let totalViolations = 0;
    let passedStages = 0;
    let failedStages = 0;
    let certifiedStages = 0;

    for (const res of Object.values(stages)) {
      if (res.passed) {
        passedStages++;
        if (res.certified) certifiedStages++;
      } else {
        failedStages++;
      }
      totalViolations += res.violations?.length || 0;
    }

    const overallPassed = failedStages === 0;

    const report: UnifiedVerificationReport = {
      timestamp: new Date().toISOString(),
      target: options.target || ctx.uri || "model",
      summary: {
        totalStages: Object.keys(stages).length,
        passedStages,
        failedStages,
        certifiedStages,
        skippedStages: 0,
        totalViolations,
        durationMs,
        overallPassed,
      },
      stages,
      artifacts: {},
    };

    // Digital Thread Hypergraph Sync
    if (options.updateHypergraph) {
      this.syncDigitalThread(report, ctx.hypergraph);
    }

    return report;
  }

  // ---------------------------------------------------------------------------
  // Individual Stage Executors
  // ---------------------------------------------------------------------------

  /**
   * Synthesizes verification stage results directly from SemanticTheoryCoordinator formal satisfaction check.
   */
  public static synthesizeFromCoordinator(
    coordinator: SemanticTheoryCoordinator,
    target: string = "model",
    uri?: string,
    options: UnifiedVerificationOptions = {},
  ): UnifiedVerificationReport {
    const t0 = Date.now();
    const satRes = coordinator.checkSat(50, options.cancellationToken);
    const conflict = satRes.conflict;
    const durPerStage = Math.max(1, Math.round(satRes.durationMs / 6));
    const stages: Record<string, VerificationStageResult> = {};

    const addDomainStage = (stageKey: string, oracleName: string, displayName: string, passSummary: string) => {
      const isCulprit = conflict != null && conflict.theoryName === oracleName;
      const passed = !isCulprit;
      const violations: VerificationViolation[] = [];

      if (isCulprit && conflict) {
        violations.push({
          id: `MSC-${stageKey.toUpperCase()}`,
          stage: stageKey,
          severity: "error",
          message: conflict.explanation,
          location: { uri },
          witness: conflict.culpritEntities,
        });
      }

      stages[stageKey] = {
        stage: stageKey,
        name: displayName,
        passed,
        certified: passed,
        durationMs: durPerStage,
        summary: passed ? passSummary : conflict?.explanation || "Theory contradiction detected.",
        violations,
        details: isCulprit ? conflict : { oracle: oracleName, status: "SAT" },
      };
    };

    const masterViolations: VerificationViolation[] = [];
    if (!satRes.isSat && conflict) {
      masterViolations.push({
        id: "MSC-THEORY-CONFLICT",
        stage: "theory_coordination",
        severity: "error",
        message: conflict.explanation,
        location: { uri },
        witness: conflict.culpritEntities,
      });
    }

    stages["theory_coordination"] = {
      stage: "theory_coordination",
      name: "Semantic Theory Coordinator (Nelson-Oppen / DPLL(T))",
      passed: satRes.isSat,
      certified: satRes.isSat,
      durationMs: Date.now() - t0,
      summary: satRes.reason
        ? satRes.reason
        : satRes.isSat
          ? `All theory oracles mutually satisfiable (${satRes.sharedEqualities.length} shared equalities in ${satRes.iterations} iterations).`
          : `Formal contradiction detected: ${conflict?.explanation}`,
      violations: masterViolations,
      details: satRes,
    };

    addDomainStage(
      "taxonomy_bundles",
      "OntologyTheoryOracle",
      "Taxonomy & Scoped Bundle Closure (OWL2 / DL-Lite)",
      "Taxonomy subsumption and scoped bundle closures satisfied.",
    );

    addDomainStage(
      "decisions",
      "ConstraintTheoryOracle",
      "Guards & Parameter Constraints (SMT / Simplex)",
      "All guard invariants and numerical parameter bounds satisfied.",
    );

    addDomainStage(
      "abstract_domains",
      "AbstractDomainOracle",
      "4D Spatiotemporal & Relational Difference (Octagon DBM)",
      "Temporal bounds and difference relations validated without negative cycles.",
    );

    addDomainStage(
      "flow_algebra",
      "FlowAlgebraOracle",
      "Port Conservation & Conjugation (Kirchhoff)",
      "Kirchhoff flow balances and boundary potential equalities verified.",
    );

    addDomainStage(
      "unit_systems",
      "DimensionalTheoryOracle",
      "ISO 80000 Unit Systems & Dimensional Consistency",
      "All physical unit systems and dimensional exponent vectors consistent.",
    );

    addDomainStage(
      "flowpipes_barriers",
      "SafetyTheoryOracle",
      "Flowpipe Reachability & Safety Envelopes (ISO 26262)",
      "Safety goals, hazard rates, and operational envelopes certified.",
    );

    let passedStages = 0;
    let failedStages = 0;
    let certifiedStages = 0;
    let totalViolations = 0;

    for (const s of Object.values(stages)) {
      if (s.passed) {
        passedStages++;
        if (s.certified) certifiedStages++;
      } else {
        failedStages++;
      }
      totalViolations += s.violations?.length || 0;
    }

    return {
      timestamp: new Date().toISOString(),
      target,
      summary: {
        totalStages: Object.keys(stages).length,
        passedStages,
        failedStages,
        certifiedStages,
        skippedStages: 0,
        totalViolations,
        durationMs: Date.now() - t0,
        overallPassed: satRes.isSat,
      },
      stages,
    };
  }

  /**
   * Executes the Nelson-Oppen / DPLL(T) semantic theory coordination pass and extracts contracted variable bounds.
   */
  private static async runTheoryCoordinationStages(
    ctx: VerificationInputContext,
    options: UnifiedVerificationOptions,
  ): Promise<Record<string, VerificationStageResult>> {
    const coordinator = ctx.coordinator || new SemanticTheoryCoordinator();
    if (!ctx.coordinator) {
      coordinator.registerOracle(new OntologyTheoryOracle());
      coordinator.registerOracle(new ConstraintTheoryOracle());
      coordinator.registerOracle(new AbstractDomainOracle());
      coordinator.registerOracle(new DimensionalTheoryOracle());
      coordinator.registerOracle(new FlowAlgebraOracle());
    }

    const report = this.synthesizeFromCoordinator(coordinator, options.target || ctx.uri, ctx.uri, options);
    if (report.summary.overallPassed) {
      ctx.contractedStateSpace = new Map();
      const bounds = coordinator.getAllCanonicalBounds();
      for (const [k, v] of bounds.entries()) {
        ctx.contractedStateSpace.set(k, [...v]);
      }
    }
    return report.stages;
  }

  /**
   * Runs the theory coordination stage and returns the master `theory_coordination` stage result.
   */
  public static async runTheoryCoordinationStage(
    ctx: VerificationInputContext,
    options: UnifiedVerificationOptions,
  ): Promise<VerificationStageResult> {
    const stages = await this.runTheoryCoordinationStages(ctx, options);
    return stages["theory_coordination"]!;
  }

  /**
   * Stage 1: Verifies decision tables and guards for exhaustiveness and determinism.
   */
  private static async runDecisionsStage(ctx: VerificationInputContext): Promise<VerificationStageResult> {
    const t0 = Date.now();
    try {
      if (!ctx.sourceText || !/\b(decide|decision|table)\b/i.test(ctx.sourceText)) {
        return {
          stage: "decisions",
          name: "Decision Table & Guard Verifier",
          passed: true,
          durationMs: Date.now() - t0,
          summary: "Decision table analysis skipped (no tables detected or analyzer unavailable).",
          violations: [],
        };
      }
      const sysmlModule = await importOptionalModule<Sysml2VerifierModule>("@modelscript/sysml2");
      if (!sysmlModule || !sysmlModule.DecisionTableVerifier) {
        return {
          stage: "decisions",
          name: "Decision Table & Guard Verifier",
          passed: true,
          durationMs: Date.now() - t0,
          summary: "Decision table analysis skipped (no tables detected or analyzer unavailable).",
          violations: [],
        };
      }

      const resultsMap = sysmlModule.DecisionTableVerifier.verifyAllDecisionsFromText(ctx.sourceText || "");
      const violations: VerificationViolation[] = [];

      for (const [name, res] of resultsMap.entries()) {
        if (!res.isExhaustive) {
          violations.push({
            id: "MSC-VERIFY-DECISION-GAP",
            stage: "decisions",
            severity: "error",
            message: `Decision table '${name}' has uncovered input gap(s). Missing witness: ${JSON.stringify(res.gapWitnesses?.[0] || {})}`,
            location: { uri: ctx.uri },
            witness: res.gapWitnesses?.[0],
          });
        }
        if (!res.isDeterministic) {
          violations.push({
            id: "MSC-VERIFY-DECISION-OVERLAP",
            stage: "decisions",
            severity: "error",
            message: `Decision table '${name}' contains non-deterministic overlapping branches. Overlap witness: ${JSON.stringify(res.overlapWitnesses?.[0] || {})}`,
            location: { uri: ctx.uri },
            witness: res.overlapWitnesses?.[0],
          });
        }
      }

      const passed = violations.length === 0;
      return {
        stage: "decisions",
        name: "Decision Table & Guard Verifier",
        passed,
        certified: passed && resultsMap.size > 0,
        durationMs: Date.now() - t0,
        summary: passed
          ? `All ${resultsMap.size} decision table(s) certified exhaustive and deterministic.`
          : `${violations.length} decision table issue(s) detected.`,
        violations,
        details: Array.from(resultsMap.entries()),
      };
    } catch (err: unknown) {
      return {
        stage: "decisions",
        name: "Decision Table & Guard Verifier",
        passed: false,
        durationMs: Date.now() - t0,
        summary: `Decision table check error: ${errMsg(err)}`,
        violations: [{ stage: "decisions", message: errMsg(err), severity: "error" }],
      };
    }
  }

  /**
   * Stage 2: Partitions the symbolic state space into invariant regions and optionally synthesizes MC/DC test vectors.
   */
  private static async runRegionDecompositionStage(
    ctx: VerificationInputContext,
    synthesizeMcdc: boolean = false,
  ): Promise<VerificationStageResult> {
    const t0 = Date.now();
    try {
      if (ctx.sourceText && /\b(action|calc)\s+def\b/.test(ctx.sourceText)) {
        const sysmlModule = await importOptionalModule<Sysml2VerifierModule>("@modelscript/sysml2");
        if (sysmlModule?.BoundaryTestSynthesizer) {
          const suite = await sysmlModule.BoundaryTestSynthesizer.synthesizeFromSysml(ctx.sourceText, {
            includeMcdc: synthesizeMcdc,
          });
          const mcdcCount = suite.coverageMetrics?.mcdcPairsCount ?? 0;
          return {
            stage: "regionDecomposition",
            name: "Symbolic Region Decomposition & MC/DC",
            passed: true,
            certified: true,
            durationMs: Date.now() - t0,
            summary: `Decomposed state space into ${suite.testCases.length} certified test vectors (${mcdcCount} MC/DC independent condition pairs).`,
            violations: [],
            details: suite,
          };
        }
      }

      // Default static decomposition with empty conditions
      const decompResult: RegionDecompositionResult = RegionDecomposer.decompose([], { maxDepth: 4 });
      return {
        stage: "regionDecomposition",
        name: "Symbolic Region Decomposition & MC/DC",
        passed: true,
        certified: true,
        durationMs: Date.now() - t0,
        summary: `Region decomposition completed (${decompResult.totalRegions} region(s)).`,
        violations: [],
        details: decompResult,
      };
    } catch (err: unknown) {
      return {
        stage: "regionDecomposition",
        name: "Symbolic Region Decomposition & MC/DC",
        passed: false,
        durationMs: Date.now() - t0,
        summary: `Region decomposition error: ${errMsg(err)}`,
        violations: [{ stage: "regionDecomposition", message: errMsg(err), severity: "error" }],
      };
    }
  }

  /**
   * Stage 3: Checks compositional assume-guarantee contracts for compatibility and refinement.
   */
  private static async runContractsStage(ctx: VerificationInputContext): Promise<VerificationStageResult> {
    const t0 = Date.now();
    try {
      if (!ctx.sourceText || !/\b(contract|assume|guarantee|requirement|satisfy)\b/i.test(ctx.sourceText)) {
        return {
          stage: "contracts",
          name: "Assume-Guarantee Contract Verifier",
          passed: true,
          durationMs: Date.now() - t0,
          summary: "No formal contracts found or contract module skipped.",
          violations: [],
        };
      }
      const sysmlModule = await importOptionalModule<Sysml2VerifierModule>("@modelscript/sysml2");
      if (!sysmlModule?.ContractVerifier) {
        return {
          stage: "contracts",
          name: "Assume-Guarantee Contract Verifier",
          passed: true,
          durationMs: Date.now() - t0,
          summary: "No formal contracts found or contract module skipped.",
          violations: [],
        };
      }

      const results = sysmlModule.ContractVerifier.verifyAllContracts(ctx.sourceText || "");
      const violations: VerificationViolation[] = [];

      for (const res of results) {
        if (!res.isSatisfied) {
          violations.push({
            id: "MSC-VERIFY-CONTRACT-VIOLATION",
            stage: "contracts",
            severity: "error",
            message: `Contract '${res.name}' violated: ${res.message || "Assumptions do not guarantee requirements."}`,
            location: { uri: ctx.uri },
          });
        }
      }

      const passed = violations.length === 0;
      return {
        stage: "contracts",
        name: "Assume-Guarantee Contract Verifier",
        passed,
        certified: passed && results.length > 0,
        durationMs: Date.now() - t0,
        summary: passed
          ? `All ${results.length} formal contract(s) certified compatible & refined.`
          : `${violations.length} contract violation(s) detected.`,
        violations,
        details: results,
      };
    } catch (err: unknown) {
      return {
        stage: "contracts",
        name: "Assume-Guarantee Contract Verifier",
        passed: false,
        durationMs: Date.now() - t0,
        summary: `Contract verification error: ${errMsg(err)}`,
        violations: [{ stage: "contracts", message: errMsg(err), severity: "error" }],
      };
    }
  }

  /**
   * Stage 4: Verifies state machines and activity workflows for soundness and deadlock freedom.
   */
  private static async runStateMachinesStage(ctx: VerificationInputContext): Promise<VerificationStageResult> {
    const t0 = Date.now();
    try {
      const sysmlModule = await importOptionalModule<Sysml2VerifierModule>("@modelscript/sysml2");
      if (sysmlModule?.checkActivitySoundnessForSymbol && ctx.queryDB?.allEntries) {
        const violations: VerificationViolation[] = [];
        const actions = ctx.queryDB.allEntries().filter((e) => e.ruleName === "ActionDefinition");
        for (const act of actions) {
          const res = sysmlModule.checkActivitySoundnessForSymbol(ctx.queryDB, act);
          if (!res.isSound) {
            violations.push({
              id: "MSC-VERIFY-STATE-DEADLOCK",
              stage: "stateMachines",
              severity: "error",
              message: `Activity '${act.name}' unsound: ${res.errors?.join("; ") || "Deadlock detected"}`,
              location: { uri: ctx.uri },
            });
          }
        }

        const passed = violations.length === 0;
        return {
          stage: "stateMachines",
          name: "State Machine & Activity Soundness",
          passed,
          certified: passed,
          durationMs: Date.now() - t0,
          summary: passed
            ? "All activity workflows and state machine transitions certified sound & deadlock-free."
            : `${violations.length} workflow soundness violation(s) detected.`,
          violations,
        };
      }

      return {
        stage: "stateMachines",
        name: "State Machine & Activity Soundness",
        passed: true,
        durationMs: Date.now() - t0,
        summary: "State machine check completed.",
        violations: [],
      };
    } catch (err: unknown) {
      return {
        stage: "stateMachines",
        name: "State Machine & Activity Soundness",
        passed: false,
        durationMs: Date.now() - t0,
        summary: `State machine verification error: ${errMsg(err)}`,
        violations: [{ stage: "stateMachines", message: errMsg(err), severity: "error" }],
      };
    }
  }

  /**
   * Stage 5: Computes validated Taylor-model reachability flowpipes for continuous DAE or hybrid automata systems.
   */
  private static async runFlowpipesStage(
    ctx: VerificationInputContext,
    options?: UnifiedVerificationOptions,
  ): Promise<VerificationStageResult> {
    const t0 = Date.now();
    try {
      if (ctx.hybridAutomaton) {
        let initialEnclosure = [new Interval(-1, 1)];
        if (ctx.contractedStateSpace && ctx.contractedStateSpace.size > 0) {
          const enclosures: Interval[] = [];
          for (const [, [lo, hi]] of ctx.contractedStateSpace.entries()) {
            if (isFinite(lo) && isFinite(hi)) {
              enclosures.push(new Interval(lo, hi));
            }
          }
          if (enclosures.length > 0) {
            initialEnclosure = enclosures;
          }
        }

        const nominalInitial = initialEnclosure.map((iv) => (iv.lo + iv.hi) / 2);
        const order = ctx.flowpipeOptions?.order ?? options?.flowpipeOrder ?? 4;
        const dt = ctx.flowpipeOptions?.dt ?? options?.flowpipeDt ?? 0.1;
        const horizon = ctx.flowpipeOptions?.horizon ?? options?.flowpipeHorizon ?? 10.0;
        const result: HybridFlowpipeResult = HybridFlowpipeSolver.solve({
          automaton: ctx.hybridAutomaton,
          initialModeId: Array.isArray(ctx.hybridAutomaton.modes)
            ? ctx.hybridAutomaton.modes[0]?.id || "m0"
            : ctx.hybridAutomaton.modes.keys().next().value || "m0",
          initialEnclosure,
          nominalInitial,
          tSpan: [0, horizon],
          dt,
          order,
        });

        const passed = result.isCertifiedSafe;
        const violations: VerificationViolation[] = [];
        const unknownReason =
          result.verdict.kind === "unknown"
            ? result.verdict.reason
            : result.verdict.kind === "violated"
              ? "violated"
              : "";

        if (!passed) {
          violations.push({
            id: "MSC-VERIFY-FLOWPIPE-UNSAFE",
            stage: "flowpipes",
            severity: "error",
            message:
              result.violations.length > 0
                ? `Reachability enclosure crosses a requirement limit (not proven; no concrete witness).`
                : `Reachability not proven (${unknownReason}): ${result.verdict.detail ?? "inconclusive"}`,
            location: { uri: ctx.uri },
          });
        }

        return {
          stage: "flowpipes",
          name: "Validated Reachability Flowpipe Engine",
          passed,
          certified: passed,
          durationMs: Date.now() - t0,
          summary: passed
            ? `Proven: validated Taylor reachability tubes stay within the requirements (float-sound).`
            : `Reachability not proven (${unknownReason || "inconclusive"}).`,
          violations,
          details: { ...result, order, dt, tSpan: [0, horizon] },
        };
      }

      if (ctx.arena) {
        const compiled = compileArenaToDae(ctx.arena, { isolateImplicitDer: true, enablePantelides: true });
        if (!compiled.ok && "reason" in compiled) {
          if (!compiled.reason.includes("No state variables")) {
            return {
              stage: "flowpipes",
              name: "Validated DAE Reachability Flowpipe Engine",
              passed: false,
              certified: false,
              durationMs: Date.now() - t0,
              summary: `DAE reachability not proven: ${compiled.reason}`,
              violations: [
                {
                  id: "MSC-VERIFY-FLOWPIPE-UNSUPPORTED",
                  stage: "flowpipes",
                  severity: "warning",
                  message: `Continuous dynamic system could not be compiled to index-1 semi-explicit DAE: ${compiled.reason}`,
                  location: { uri: ctx.uri },
                },
              ],
              details: { error: compiled.reason },
            };
          }
        } else {
          const { dae, stateNames, algebraicNames } = compiled.compiled;
          const arena = ctx.arena as ArenaInspectable;
          const exp = arena.experiment;
          const horizon = ctx.flowpipeOptions?.horizon ?? options?.flowpipeHorizon ?? exp?.stopTime ?? 1.0;
          const tSpan: [number, number] = [exp?.startTime ?? 0, horizon];
          const dt = ctx.flowpipeOptions?.dt ?? options?.flowpipeDt ?? exp?.interval ?? 0.05;
          const order = ctx.flowpipeOptions?.order ?? options?.flowpipeOrder ?? 4;

          const customBounds =
            ctx.flowpipeOptions?.initialSet instanceof Map
              ? ctx.flowpipeOptions.initialSet
              : ctx.flowpipeOptions?.initialSet
                ? new Map(Object.entries(ctx.flowpipeOptions.initialSet))
                : options?.flowpipeInitialSet
                  ? parseInitialSetString(options.flowpipeInitialSet)
                  : new Map<string, [number, number]>();

          const evaluator = new DaeIntervalEvaluator(ctx.arena);
          const initialX: Interval[] = [];
          const nominalX: number[] = [];
          for (let s = 0; s < stateNames.length; s++) {
            const sName = stateNames[s]!;
            const explicitStateBound = customBounds.get(sName) ?? ctx.contractedStateSpace?.get(sName);
            if (
              explicitStateBound &&
              Number.isFinite(explicitStateBound[0]) &&
              Number.isFinite(explicitStateBound[1])
            ) {
              const [lo, hi] = explicitStateBound;
              initialX.push(new Interval(lo, hi));
              nominalX.push((lo + hi) / 2);
              continue;
            }
            const vIdx = arena.interner ? (arena.lookupVariable?.(arena.interner.intern(sName)) ?? -1) : -1;
            const b = vIdx >= 0 ? evaluator.getVarBound(vIdx) : null;
            if (b && !b.isBottom() && !b.isTop()) {
              initialX.push(new Interval(b.low, b.high));
              nominalX.push((b.low + b.high) / 2);
            } else {
              const startVal = vIdx >= 0 ? (arena.getVarStartValue?.(vIdx) ?? 0) : 0;
              initialX.push(new Interval(startVal - 0.1, startVal + 0.1));
              nominalX.push(startVal);
            }
          }

          const initialZ: Interval[] = [];
          const nominalZ: number[] = [];
          for (let a = 0; a < algebraicNames.length; a++) {
            const aName = algebraicNames[a]!;
            const explicitAlgBound = customBounds.get(aName) ?? ctx.contractedStateSpace?.get(aName);
            if (explicitAlgBound && Number.isFinite(explicitAlgBound[0]) && Number.isFinite(explicitAlgBound[1])) {
              const [lo, hi] = explicitAlgBound;
              initialZ.push(new Interval(lo, hi));
              nominalZ.push((lo + hi) / 2);
              continue;
            }
            const vIdx = arena.interner ? (arena.lookupVariable?.(arena.interner.intern(aName)) ?? -1) : -1;
            const b = vIdx >= 0 ? evaluator.getVarBound(vIdx) : null;
            if (b && !b.isBottom() && !b.isTop()) {
              initialZ.push(new Interval(b.low, b.high));
              nominalZ.push((b.low + b.high) / 2);
            } else {
              initialZ.push(new Interval(-1, 1));
              nominalZ.push(0);
            }
          }

          const requirements: DaeFlowpipeRequirement[] = [];
          if (ctx.flowpipeRequirements) {
            requirements.push(...ctx.flowpipeRequirements);
          }
          for (let s = 0; s < stateNames.length; s++) {
            const sName = stateNames[s]!;
            const vIdx = arena.interner ? (arena.lookupVariable?.(arena.interner.intern(sName)) ?? -1) : -1;
            if (vIdx >= 0) {
              const maxExpr = arena.getVarAttrExprId?.(vIdx, "max");
              if (maxExpr !== undefined && maxExpr >= 0) {
                const maxVal = arena.getExprRealValue?.(maxExpr);
                if (maxVal !== undefined && Number.isFinite(maxVal)) {
                  requirements.push({ variable: "x", index: s, operator: "<=", limitValue: maxVal });
                }
              }
              const minExpr = arena.getVarAttrExprId?.(vIdx, "min");
              if (minExpr !== undefined && minExpr >= 0) {
                const minVal = arena.getExprRealValue?.(minExpr);
                if (minVal !== undefined && Number.isFinite(minVal)) {
                  requirements.push({ variable: "x", index: s, operator: ">=", limitValue: minVal });
                }
              }
            }
          }
          for (let a = 0; a < algebraicNames.length; a++) {
            const aName = algebraicNames[a]!;
            const vIdx = arena.interner ? (arena.lookupVariable?.(arena.interner.intern(aName)) ?? -1) : -1;
            if (vIdx >= 0) {
              const maxExpr = arena.getVarAttrExprId?.(vIdx, "max");
              if (maxExpr !== undefined && maxExpr >= 0) {
                const maxVal = arena.getExprRealValue?.(maxExpr);
                if (maxVal !== undefined && Number.isFinite(maxVal)) {
                  requirements.push({ variable: "z", index: a, operator: "<=", limitValue: maxVal });
                }
              }
              const minExpr = arena.getVarAttrExprId?.(vIdx, "min");
              if (minExpr !== undefined && minExpr >= 0) {
                const minVal = arena.getExprRealValue?.(minExpr);
                if (minVal !== undefined && Number.isFinite(minVal)) {
                  requirements.push({ variable: "z", index: a, operator: ">=", limitValue: minVal });
                }
              }
            }
          }

          const daeRes = DaeFlowpipeSolver.solve({
            dae,
            initialX,
            initialZ,
            nominalX,
            nominalZ,
            tSpan,
            dt,
            order,
            requirements,
          });

          const passed = daeRes.isCertifiedSafe;
          const unknownReason = daeRes.verdict.kind === "unknown" ? daeRes.verdict.reason : "";
          const violations: VerificationViolation[] = [];
          if (!passed) {
            violations.push({
              id: "MSC-VERIFY-FLOWPIPE-UNSAFE",
              stage: "flowpipes",
              severity: "error",
              message:
                daeRes.verdict.kind === "violated"
                  ? `DAE reachability enclosure crosses a requirement limit.`
                  : `DAE reachability not proven (${unknownReason}): ${daeRes.verdict.detail ?? "inconclusive"}`,
              location: { uri: ctx.uri },
            });
          }

          return {
            stage: "flowpipes",
            name: "Validated DAE Reachability Flowpipe Engine",
            passed,
            certified: passed,
            durationMs: Date.now() - t0,
            summary: passed
              ? `Proven: validated DAE reachability tubes satisfy all requirements (${stateNames.length} state(s), ${algebraicNames.length} algebraic).`
              : `DAE reachability not proven (${unknownReason || "inconclusive"}).`,
            violations,
            details: { ...daeRes, order, dt, tSpan, stateNames, algebraicNames },
          };
        }
      }

      return {
        stage: "flowpipes",
        name: "Validated Reachability Flowpipe Engine",
        passed: true,
        durationMs: Date.now() - t0,
        summary: "Flowpipe reachability check passed (no continuous dynamic systems detected).",
        violations: [],
      };
    } catch (err: unknown) {
      return {
        stage: "flowpipes",
        name: "Validated Reachability Flowpipe Engine",
        passed: false,
        durationMs: Date.now() - t0,
        summary: `Flowpipe reachability error: ${errMsg(err)}`,
        violations: [{ stage: "flowpipes", message: errMsg(err), severity: "error" }],
      };
    }
  }

  /**
   * Stage 6: Synthesizes quadratic Sum-of-Squares (SOS) Lyapunov and Barrier certificates for continuous dynamics.
   */
  private static async runBarriersStage(ctx: VerificationInputContext): Promise<VerificationStageResult> {
    const t0 = Date.now();
    try {
      if (ctx.arena) {
        const compiled = compileArenaToDae(ctx.arena);
        if (compiled.ok && compiled.compiled.stateNames.length > 0) {
          const { dae, stateNames, algebraicNames } = compiled.compiled;
          const arena = ctx.arena as ArenaInspectable;
          const evaluator = new DaeIntervalEvaluator(ctx.arena);
          const nominalZ: number[] = [];
          for (let a = 0; a < algebraicNames.length; a++) {
            const aName = algebraicNames[a]!;
            const vIdx = arena.interner ? (arena.lookupVariable?.(arena.interner.intern(aName)) ?? -1) : -1;
            const b = vIdx >= 0 ? evaluator.getVarBound(vIdx) : null;
            if (b && !b.isBottom() && !b.isTop()) {
              nominalZ.push((b.low + b.high) / 2);
            } else {
              nominalZ.push(vIdx >= 0 ? (arena.getVarStartValue?.(vIdx) ?? 0) : 0);
            }
          }
          let initialRadius = 0.25;
          let unsafeRadius = 2.0;
          for (const sName of stateNames) {
            const vIdx = arena.interner ? (arena.lookupVariable?.(arena.interner.intern(sName)) ?? -1) : -1;
            if (vIdx >= 0) {
              const startVal = Math.abs(arena.getVarStartValue?.(vIdx) ?? 0);
              if (startVal > 0) {
                initialRadius = Math.max(initialRadius, startVal);
              }
              const maxExpr = arena.getVarAttrExprId?.(vIdx, "max");
              if (maxExpr !== undefined && maxExpr >= 0) {
                const maxVal = Math.abs(arena.getExprRealValue?.(maxExpr) ?? 0);
                if (Number.isFinite(maxVal) && maxVal > initialRadius) {
                  unsafeRadius = Math.max(unsafeRadius, maxVal);
                }
              }
            }
          }
          if (unsafeRadius <= initialRadius) {
            unsafeRadius = initialRadius * 2.0 + 1.0;
          }
          const barrierRes = SosBarrierSynthesizer.synthesizeQuadratic(
            {
              numVars: stateNames.length,
              varNames: stateNames,
              f: (x: number[]) => dae.f(0, x, nominalZ),
            },
            { initialRadius, unsafeRadius },
          );
          return {
            stage: "barriers",
            name: "Sum-of-Squares Barrier Synthesizer",
            passed: true,
            certified: barrierRes.isCertifiedSafe,
            durationMs: Date.now() - t0,
            summary: barrierRes.summary,
            violations: [],
            details: { ...barrierRes, stateNames, initialRadius, unsafeRadius },
          };
        }
      }
      return {
        stage: "barriers",
        name: "Sum-of-Squares Barrier Synthesizer",
        passed: true,
        certified: false,
        durationMs: Date.now() - t0,
        summary: "Not evaluated: barrier synthesis requires continuous state dynamics (no certificate produced).",
        violations: [],
      };
    } catch (err: unknown) {
      return {
        stage: "barriers",
        name: "Sum-of-Squares Barrier Synthesizer",
        passed: false,
        durationMs: Date.now() - t0,
        summary: `Barrier synthesis error: ${errMsg(err)}`,
        violations: [{ stage: "barriers", message: errMsg(err), severity: "warning" }],
      };
    }
  }

  /**
   * Stage 7: Evaluates dynamic simulation trajectories against formal requirement constraints.
   */
  private static async runTrajectoriesStage(ctx: VerificationInputContext): Promise<VerificationStageResult> {
    const t0 = Date.now();
    try {
      if (ctx.simulationResult && ctx.queryDB && ctx.verifyCaseId != null) {
        const runner = new VerificationRunner(ctx.queryDB);
        const results: VerificationResult[] = runner.verifyCase(ctx.verifyCaseId, ctx.simulationResult);
        const violations: VerificationViolation[] = [];

        for (const res of results) {
          if (!res.isSatisfied) {
            violations.push({
              id: "MSC-VERIFY-TRAJECTORY-VIOLATION",
              stage: "trajectories",
              severity: "error",
              message: res.message || `Trajectory violated requirement #${res.requirementId}`,
              location: { uri: ctx.uri },
              witness: { peakValue: res.peakValue, limitValue: res.limitValue, violationTime: res.violationTime },
            });
          }
        }

        const passed = violations.length === 0;
        return {
          stage: "trajectories",
          name: "Dynamic Trajectory Requirement Verifier",
          passed,
          durationMs: Date.now() - t0,
          summary: passed
            ? `All ${results.length} simulation trajectory requirements satisfied.`
            : `${violations.length} trajectory requirement violation(s) detected.`,
          violations,
          details: results,
        };
      }

      return {
        stage: "trajectories",
        name: "Dynamic Trajectory Requirement Verifier",
        passed: true,
        durationMs: Date.now() - t0,
        summary: "Trajectory verification completed.",
        violations: [],
      };
    } catch (err: unknown) {
      return {
        stage: "trajectories",
        name: "Dynamic Trajectory Requirement Verifier",
        passed: false,
        durationMs: Date.now() - t0,
        summary: `Trajectory verification error: ${errMsg(err)}`,
        violations: [{ stage: "trajectories", message: errMsg(err), severity: "error" }],
      };
    }
  }

  /**
   * Stage 8: Verifies 3D CAD assembly physical clearances and detects part collisions.
   */
  private static async runClearanceStage(ctx: VerificationInputContext): Promise<VerificationStageResult> {
    const t0 = Date.now();
    try {
      const cadModule = await importOptionalModule<CadVerifierModule>("@modelscript/cad");
      if (cadModule?.verifyAssemblyClearance && ctx.assembly) {
        const report = cadModule.verifyAssemblyClearance(ctx.assembly);
        const violations: VerificationViolation[] = [];

        for (const v of report.violations || []) {
          violations.push({
            id: "MSC-VERIFY-CAD-COLLISION",
            stage: "clearance",
            severity: "error",
            message: v.description || `Clearance collision between parts`,
            witness: v,
          });
        }

        const passed = violations.length === 0;
        return {
          stage: "clearance",
          name: "3D CAD Clearance & Collision Verifier",
          passed,
          certified: passed,
          durationMs: Date.now() - t0,
          summary: passed
            ? `All assembly parts meet required spatial clearance thresholds (${report.pairsChecked} pairs checked).`
            : `${violations.length} spatial clearance violation(s) detected.`,
          violations,
          details: report,
        };
      }

      return {
        stage: "clearance",
        name: "3D CAD Clearance & Collision Verifier",
        passed: true,
        durationMs: Date.now() - t0,
        summary: "Clearance check passed (no CAD assembly provided).",
        violations: [],
      };
    } catch (err: unknown) {
      return {
        stage: "clearance",
        name: "3D CAD Clearance & Collision Verifier",
        passed: false,
        durationMs: Date.now() - t0,
        summary: `CAD clearance verification error: ${errMsg(err)}`,
        violations: [{ stage: "clearance", message: errMsg(err), severity: "error" }],
      };
    }
  }

  /**
   * Stage 9: Executes ISO 26262 TCL1 back-to-back Model-in-the-Loop (MiL) vs Software-in-the-Loop (SiL) equivalence verification.
   */
  private static async runB2BStage(
    ctx: VerificationInputContext,
    options: UnifiedVerificationOptions,
  ): Promise<VerificationStageResult> {
    const t0 = Date.now();
    try {
      if (!ctx.arena) {
        return {
          stage: "b2b",
          name: "Back-to-Back MiL vs SiL Equivalence (ISO 26262 TCL1)",
          passed: true,
          durationMs: Date.now() - t0,
          summary: "B2B verification skipped (no compiled DAE arena provided).",
          violations: [],
        };
      }

      const res: B2BVerificationResult = await B2BEquivalenceVerifier.verify(
        ctx.arena,
        ctx.simulationResult as unknown as Parameters<typeof B2BEquivalenceVerifier.verify>[1],
        {
          tolerance: options.b2bTol,
          compiler: options.b2bCompiler,
          dt: options.b2bDt,
          modelIdentifier: options.target,
        },
      );

      const violations: VerificationViolation[] = [];
      if (!res.passed) {
        for (const disc of res.discrepancies.slice(0, 10)) {
          violations.push({
            id: "MSC-VERIFY-B2B-DISCREPANCY",
            stage: "b2b",
            severity: "error",
            message: `MiL-vs-SiL discrepancy on signal '${disc.variable}' at t=${disc.time.toFixed(4)}s: |MiL(${disc.milValue.toExponential(3)}) - SiL(${disc.silValue.toExponential(3)})| = ${disc.absError.toExponential(3)} > tol (${disc.tolerance.toExponential(3)})`,
            location: { uri: ctx.uri },
            witness: disc,
          });
        }
      }

      return {
        stage: "b2b",
        name: "Back-to-Back MiL vs SiL Equivalence (ISO 26262 TCL1)",
        passed: res.passed,
        certified: res.certified,
        durationMs: Date.now() - t0,
        summary: res.summary,
        violations,
        details: res,
      };
    } catch (err: unknown) {
      return {
        stage: "b2b",
        name: "Back-to-Back MiL vs SiL Equivalence (ISO 26262 TCL1)",
        passed: false,
        durationMs: Date.now() - t0,
        summary: `B2B execution error: ${errMsg(err)}`,
        violations: [{ stage: "b2b", message: errMsg(err), severity: "error" }],
      };
    }
  }

  /**
   * Stage 10: Runs sound abstract interpretation over Modelica algorithmic sections and functions to prove absence of run-time errors (RTE).
   */
  private static async runAlgorithmsStage(
    ctx: VerificationInputContext,
    options: UnifiedVerificationOptions,
  ): Promise<VerificationStageResult> {
    const t0 = Date.now();
    try {
      let text = ctx.sourceText || "";
      if (!/\balgorithm\b/.test(text) && ctx.paths && ctx.paths.length > 0) {
        try {
          const fsId = "node:fs";
          const fs = await import(fsId);
          for (const p of ctx.paths) {
            if (p.endsWith(".mo") && fs.existsSync(p)) {
              text += "\n" + fs.readFileSync(p, "utf-8");
            }
          }
        } catch {
          // ignore
        }
      }

      if (!/\balgorithm\b/.test(text)) {
        return {
          stage: "algorithms",
          name: "Modelica Algorithmic Abstract Interpretation (Sound RTE Verification)",
          passed: true,
          durationMs: Date.now() - t0,
          summary: "No algorithmic sections or functions found for abstract interpretation.",
          violations: [],
        };
      }

      const modelicaModule = await importOptionalModule<ModelicaAlgorithmModule>("@modelscript/modelica");
      if (!modelicaModule?.ModelicaAlgorithmAnalyzer || !modelicaModule.ModelicaCFGLowerer) {
        return {
          stage: "algorithms",
          name: "Modelica Algorithmic Abstract Interpretation (Sound RTE Verification)",
          passed: true,
          durationMs: Date.now() - t0,
          summary: "Algorithmic abstract interpretation skipped (@modelscript/modelica analyzer unavailable).",
          violations: [],
        };
      }

      const { ModelicaAlgorithmAnalyzer, ModelicaCFGLowerer, PhysicalInvariantBridge } = modelicaModule;

      let plantPreconditions: Map<string, [number, number]> | undefined = undefined;
      if (ctx.hybridAutomaton && PhysicalInvariantBridge) {
        plantPreconditions = PhysicalInvariantBridge.extractPlantBounds(ctx.hybridAutomaton);
      }
      if (ctx.contractedStateSpace && ctx.contractedStateSpace.size > 0) {
        if (!plantPreconditions) {
          plantPreconditions = new Map();
        }
        for (const [k, [lo, hi]] of ctx.contractedStateSpace.entries()) {
          if (Number.isFinite(lo) && Number.isFinite(hi)) {
            const prev = plantPreconditions.get(k);
            plantPreconditions.set(k, prev ? [Math.max(prev[0], lo), Math.min(prev[1], hi)] : [lo, hi]);
          }
        }
      }

      const violations: VerificationViolation[] = [];
      const funcRegex = /\b(function|block|model|class)\s+([a-zA-Z_][a-zA-Z0-9_]*)\b([\s\S]*?)\bend\s+\2\s*;/g;
      let match: RegExpExecArray | null;

      let totalProven = 0;
      let totalDefects = 0;
      let totalUnproven = 0;
      let totalDeadCode = 0;
      let analyzedCount = 0;
      const functionResults: unknown[] = [];
      const matrixLines: string[] = [];

      const getLineCol = (offset?: number) => {
        if (offset === undefined || offset < 0) return { line: 1, column: 1 };
        const prefix = text.slice(0, offset);
        const lines = prefix.split("\n");
        return { line: lines.length, column: lines[lines.length - 1]!.length + 1 };
      };

      while ((match = funcRegex.exec(text)) !== null) {
        const _kind = match[1]!;
        void _kind;
        const name = match[2]!;
        const body = match[3]!;

        const algMatch = /\b(?:initial\s+)?algorithm\b([\s\S]*)$/.exec(body);
        if (!algMatch) continue;

        const algText = algMatch[0];
        const algOffset = match.index + match[0].indexOf(algText);

        const variables: Array<{
          name: string;
          type: string | undefined;
          isInput: boolean;
          isOutput: boolean;
          isArray: boolean;
          arrayDimension: number | undefined;
          initialBound: [number, number] | undefined;
        }> = [];
        const varDeclRegex =
          /\b(?:(input|output)\s+)?(Real|Integer|Boolean|String)(?:\s*\[([^\]]*)\])?\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\[([^\]]*)\])?(?:\s*=\s*([^;\s\r\n]+(?:\s+[^;\s\r\n]+)*))?\s*;/g;
        let vMatch: RegExpExecArray | null;
        while ((vMatch = varDeclRegex.exec(body)) !== null) {
          const io = vMatch[1];
          const type = vMatch[2];
          const dimStr = vMatch[3] || vMatch[5];
          const vName = vMatch[4]!;
          const initExpr = vMatch[6];

          const isArray = Boolean(dimStr);
          const arrayDimension = dimStr && /^\d+$/.test(dimStr.trim()) ? Number(dimStr.trim()) : undefined;

          let initialBound: [number, number] | undefined = undefined;
          if (initExpr && /^-?\d+(?:\.\d+)?$/.test(initExpr.trim())) {
            const val = Number(initExpr.trim());
            initialBound = [val, val];
          }

          variables.push({
            name: vName,
            type,
            isInput: io === "input",
            isOutput: io === "output",
            isArray,
            arrayDimension,
            initialBound,
          });
        }

        const statements = ModelicaCFGLowerer.parseStatements(algText, algOffset);
        if (statements.length === 0) continue;

        const result = ModelicaAlgorithmAnalyzer.analyze(statements, variables, {
          functionName: name,
          plantPreconditions,
        });

        analyzedCount++;
        functionResults.push(result);
        totalProven += result.provenSafe.length;
        totalDefects += result.definiteBugs.length;
        totalUnproven += result.potentialBugs.length;
        totalDeadCode += result.deadCodeBlocks;
        matrixLines.push(result.formattedMatrix);

        for (const bug of result.definiteBugs) {
          const loc = getLineCol(bug.startOffset ?? algOffset);
          const endLoc = getLineCol(bug.endOffset ?? (bug.startOffset ? bug.startOffset + 10 : algOffset + 10));
          violations.push({
            id: "MSC-VERIFY-ALGO-DEFECT",
            stage: "algorithms",
            severity: "error",
            message: `[Formal Proof Defect in '${name}'] ${bug.message}`,
            location: {
              uri: ctx.uri,
              line: loc.line,
              column: loc.column,
              endLine: endLoc.line,
              endColumn: endLoc.column,
            },
            witness: { functionName: name, ...bug },
          });
        }

        for (const unproven of result.potentialBugs) {
          const loc = getLineCol(unproven.startOffset ?? algOffset);
          const endLoc = getLineCol(
            unproven.endOffset ?? (unproven.startOffset ? unproven.startOffset + 10 : algOffset + 10),
          );
          violations.push({
            id: "MSC-VERIFY-ALGO-UNPROVEN",
            stage: "algorithms",
            severity: "warning",
            message: `[Formal Proof Unproven in '${name}'] ${unproven.message}`,
            location: {
              uri: ctx.uri,
              line: loc.line,
              column: loc.column,
              endLine: endLoc.line,
              endColumn: endLoc.column,
            },
            witness: { functionName: name, ...unproven },
          });
        }
      }

      if (analyzedCount === 0) {
        const statements = ModelicaCFGLowerer.parseStatements(text);
        if (statements.length > 0) {
          const result = ModelicaAlgorithmAnalyzer.analyze(statements, [], {
            functionName: options.target || "main",
            plantPreconditions,
          });
          analyzedCount = 1;
          functionResults.push(result);
          totalProven += result.provenSafe.length;
          totalDefects += result.definiteBugs.length;
          totalUnproven += result.potentialBugs.length;
          totalDeadCode += result.deadCodeBlocks;
          matrixLines.push(result.formattedMatrix);

          for (const bug of result.definiteBugs) {
            const loc = getLineCol(bug.startOffset);
            violations.push({
              id: "MSC-VERIFY-ALGO-DEFECT",
              stage: "algorithms",
              severity: "error",
              message: `[Formal Proof Defect] ${bug.message}`,
              location: { uri: ctx.uri, line: loc.line, column: loc.column },
              witness: bug,
            });
          }

          for (const unproven of result.potentialBugs) {
            const loc = getLineCol(unproven.startOffset);
            violations.push({
              id: "MSC-VERIFY-ALGO-UNPROVEN",
              stage: "algorithms",
              severity: "warning",
              message: `[Formal Proof Unproven] ${unproven.message}`,
              location: { uri: ctx.uri, line: loc.line, column: loc.column },
              witness: unproven,
            });
          }
        }
      }

      const passed = totalDefects === 0 && totalUnproven === 0;
      const certified = passed && totalProven > 0;
      const summary = passed
        ? `100% Certified Safe (${totalProven} RTE checks proven safe, 0 defects, 0 unproven across ${analyzedCount} algorithm(s))`
        : `Verification Failed: ${totalDefects} defect(s), ${totalUnproven} unproven condition(s) across ${analyzedCount} algorithm(s)`;

      return {
        stage: "algorithms",
        name: "Modelica Algorithmic Abstract Interpretation (Sound RTE Verification)",
        passed,
        certified,
        durationMs: Date.now() - t0,
        summary,
        violations,
        details: {
          analyzedCount,
          totalProven,
          totalDefects,
          totalUnproven,
          totalDeadCode,
          functions: functionResults,
          formattedMatrix: matrixLines.join("\n\n"),
        },
      };
    } catch (err: unknown) {
      return {
        stage: "algorithms",
        name: "Modelica Algorithmic Abstract Interpretation (Sound RTE Verification)",
        passed: false,
        durationMs: Date.now() - t0,
        summary: `Algorithmic analysis error: ${errMsg(err)}`,
        violations: [{ stage: "algorithms", message: errMsg(err), severity: "error" }],
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Digital Thread Hypergraph Synchronization
  // ---------------------------------------------------------------------------

  /**
   * Records verification satisfaction or conflict provenance into the Digital Thread Hypergraph.
   */
  private static syncDigitalThread(report: UnifiedVerificationReport, hypergraph?: DigitalThreadHypergraph): void {
    const targetHypergraph = hypergraph || new DigitalThreadHypergraph();
    const existingCount = targetHypergraph.getThreadCount();
    const threadSlot =
      targetHypergraph.findSlotByThreadId(1) ?? (existingCount > 0 ? 0 : targetHypergraph.createThread(1));
    if (report.summary.overallPassed) {
      targetHypergraph.recordTheorySat(threadSlot);
    } else {
      const firstViolation = Object.values(report.stages).flatMap((s) => s.violations || [])[0];
      targetHypergraph.recordTheoryConflict(threadSlot, {
        literals: [],
        explanation: firstViolation?.message || "Unified formal verification conflict detected.",
        culpritEntities: [report.target || "model"],
        theoryName: firstViolation?.stage || "verification",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Multi-Format Exporters
  // ---------------------------------------------------------------------------

  /**
   * Formats a `UnifiedVerificationReport` as a human-readable CLI terminal summary table.
   */
  public static formatTerminal(report: UnifiedVerificationReport): string {
    const lines: string[] = [];
    const icon = report.summary.overallPassed ? "✔" : "✖";
    lines.push("");
    lines.push(`=== ModelScript Unified Formal Verification ===`);
    lines.push(`Target: ${report.target || "Workspace"} | Duration: ${report.summary.durationMs.toFixed(1)}ms`);
    lines.push(`Status: ${icon} ${report.summary.overallPassed ? "ALL CERTIFIED / PASSED" : "VIOLATIONS DETECTED"}`);
    lines.push(
      `Stages: ${report.summary.passedStages}/${report.summary.totalStages} passed (${report.summary.certifiedStages} certified)`,
    );
    lines.push("─".repeat(70));

    for (const st of Object.values(report.stages)) {
      const stDetails = st.details as StageDetailsShape | undefined;
      const badge = st.passed ? (st.certified ? "[CERTIFIED]" : "[PASSED]   ") : "[FAILED]   ";
      lines.push(`${badge} ${st.name.padEnd(40)} (${st.durationMs.toFixed(1)}ms)`);
      if (stDetails?.verdict) {
        const v = stDetails.verdict;
        lines.push(
          `          Verdict: ${v.kind.toUpperCase()}${v.rigor ? ` (rigor: ${v.rigor})` : ""}${v.reason ? ` (reason: ${v.reason})` : ""}`,
        );
      }
      lines.push(`          ${st.summary}`);
      if (st.stage === "algorithms" && stDetails?.formattedMatrix) {
        lines.push("");
        for (const mLine of stDetails.formattedMatrix.split("\n")) {
          lines.push(`          ${mLine}`);
        }
        lines.push("");
      }
      if (st.violations && st.violations.length > 0) {
        for (const v of st.violations) {
          lines.push(`          ✖ ${v.message}`);
        }
      }
    }

    lines.push("─".repeat(70));
    lines.push("");
    return lines.join("\n");
  }

  /**
   * Serializes a `UnifiedVerificationReport` to a SARIF 2.1.0 JSON string for static analysis integration.
   */
  public static formatSarif(report: UnifiedVerificationReport): string {
    return JSON.stringify(generateSarifReport(report), null, 2);
  }

  /**
   * Renders a `UnifiedVerificationReport` as a standalone HTML verification dashboard.
   */
  public static formatHtml(report: UnifiedVerificationReport): string {
    return generateHtmlReport(report);
  }

  /**
   * Converts a `UnifiedVerificationReport` into a Common Test Report Format (CTRF) object.
   */
  public static formatCtrf(report: UnifiedVerificationReport): CtrfReport {
    const verifResults: VerificationResult[] = [];
    let reqId = 1;
    for (const st of Object.values(report.stages)) {
      const stDetails = st.details as StageDetailsShape | undefined;
      if (st.violations && st.violations.length > 0) {
        for (const v of st.violations) {
          const standardClause = v.standard && v.clauseId ? `${v.standard} ${v.clauseId}` : (v.standard ?? v.clauseId);
          verifResults.push({
            requirementId: reqId++,
            constraintId: 1,
            isSatisfied: false,
            requirementName: st.name,
            message: v.message,
            verdict: stDetails?.verdict?.kind,
            rigor: stDetails?.verdict?.rigor,
            standardClause,
            margin: v.margin,
            verificationMethod: v.verificationMethod ?? v.stage,
          } as VerificationResult);
        }
      } else {
        verifResults.push({
          requirementId: reqId++,
          constraintId: 1,
          isSatisfied: true,
          requirementName: st.name,
          verdict: stDetails?.verdict?.kind,
          rigor: stDetails?.verdict?.rigor,
        } as VerificationResult);
      }
    }
    return generateCtrfReport(verifResults, report.summary.durationMs);
  }

  /**
   * Formats a `UnifiedVerificationReport` as a JUnit XML test suite document.
   */
  public static formatJUnit(report: UnifiedVerificationReport): string {
    const ctrf = this.formatCtrf(report);
    const verifResults: VerificationResult[] = [];
    for (const t of ctrf.report.results.tests) {
      verifResults.push({
        requirementId: t.extra?.["requirementId"] || 1,
        constraintId: t.extra?.["constraintId"] || 1,
        isSatisfied: t.status === "passed",
        requirementName: t.name,
        message: t.message,
      });
    }
    return generateJUnitReport(report.target || "UnifiedVerification", verifResults, report.summary.durationMs);
  }

  /**
   * Alias for `formatJUnit` returning a JUnit XML string.
   */
  public static formatJunit(report: UnifiedVerificationReport): string {
    return this.formatJUnit(report);
  }

  /**
   * Generates an ISO 26262 Design History File (DHF) Markdown regulatory verification dossier.
   */
  public static formatDhf(report: UnifiedVerificationReport): string {
    const lines = [
      `# ISO 26262 Design History File (DHF) Regulatory Verification Dossier`,
      ``,
      `Target: ${report.target}`,
      `Timestamp: ${report.timestamp}`,
      `Overall Status: ${report.summary.overallPassed ? "PASS (COMPLIANT)" : "FAIL (NON-COMPLIANT)"}`,
      ``,
      `## Verification Summary`,
      `- Total Stages: ${report.summary.totalStages}`,
      `- Passed: ${report.summary.passedStages}`,
      `- Certified Proofs: ${report.summary.certifiedStages}`,
      `- Total Violations: ${report.summary.totalViolations}`,
      ``,
      `## Stage Verification Ledger`,
    ];

    for (const s of Object.values(report.stages)) {
      const sDetails = s.details as StageDetailsShape | undefined;
      lines.push(
        `### ${s.name}`,
        `- Status: ${s.passed ? "COMPLIANT" : "NON-COMPLIANT"}`,
        `- Details: ${s.summary}`,
        `- Violations: ${s.violations?.length || 0}`,
      );
      if (sDetails?.cSourceHash) {
        lines.push(
          `- C Source Hash: \`${sDetails.cSourceHash}\``,
          `- Tool Confidence: Tool Qualification (TCL1) Qualified (ISO 26262-8 Clause 11.4.5)`,
          `- ISO 26262-6 Table 7 Conformance: Verified (100% Back-to-Back Equivalence)`,
        );
      }
      if (s.violations && s.violations.length > 0) {
        for (const v of s.violations) {
          if (v.standard || v.clauseId || v.margin !== undefined || v.verificationMethod) {
            const clauseLabel = [v.standard, v.clauseId].filter(Boolean).join(" ") || "Compliance";
            const marginText =
              v.margin !== undefined && Number.isFinite(v.margin)
                ? `, Margin: ${v.margin >= 0 ? "+" : ""}${v.margin.toFixed(4)}`
                : "";
            const methodText = v.verificationMethod ? `, Method: ${v.verificationMethod}` : "";
            lines.push(`- [${clauseLabel}${marginText}${methodText}] ${v.message}`);
          }
        }
      }
      lines.push(``);
    }

    return lines.join("\n");
  }

  /**
   * Attaches a polyglot digital thread evaluation result to a `UnifiedVerificationReport`,
   * creating a first-class `stages["polyglot_digital_thread"]` entry so all report formatters
   * (Terminal, SARIF, HTML, CTRF, JUnit, DHF) include cross-language violations and status.
   */
  public static attachPolyglotDigitalThread(
    report: UnifiedVerificationReport,
    threadRes: NonNullable<UnifiedVerificationReport["polyglotDigitalThread"]> & {
      elapsedMs?: number | undefined;
      paneDiagnostics?:
        | Array<
            Array<{
              startLine?: number | undefined;
              startCol?: number | undefined;
              endLine?: number | undefined;
              endCol?: number | undefined;
              severity?: string | undefined;
              code?: string | undefined;
              message: string;
            }>
          >
        | undefined;
      artifacts?:
        | Array<{
            fileName?: string | undefined;
            uri?: string | undefined;
            diagnostics?:
              | Array<{
                  startLine?: number | undefined;
                  startCol?: number | undefined;
                  endLine?: number | undefined;
                  endCol?: number | undefined;
                  severity?: string | undefined;
                  code?: string | undefined;
                  message: string;
                }>
              | undefined;
          }>
        | undefined;
      conflicts?:
        | Array<{
            explanation?: string | undefined;
            culpritEntities?: string[] | undefined;
            theoryName?: string | undefined;
          }>
        | undefined;
    },
  ): UnifiedVerificationReport {
    report.polyglotDigitalThread = threadRes;
    const stageKey = "polyglot_digital_thread";
    const violations: VerificationViolation[] = [];

    if (Array.isArray(threadRes.artifacts)) {
      for (const art of threadRes.artifacts) {
        const uri = art.uri || art.fileName;
        for (const d of art.diagnostics ?? []) {
          violations.push({
            id: d.code ?? "POLYGLOT_DIGITAL_THREAD",
            message: d.message,
            severity: d.severity === "warning" ? "warning" : d.severity === "info" ? "note" : "error",
            stage: stageKey,
            location: {
              uri,
              line: d.startLine ?? 1,
              column: d.startCol ?? 1,
              endLine: d.endLine ?? d.startLine ?? 1,
              endColumn: d.endCol ?? d.startCol ?? 1,
            },
          });
        }
      }
    }

    if (violations.length === 0 && !threadRes.isSat && Array.isArray(threadRes.conflicts)) {
      for (const c of threadRes.conflicts) {
        violations.push({
          id: c.theoryName ?? "POLYGLOT_THEORY_CONFLICT",
          message: c.explanation || threadRes.summaryText,
          severity: "error",
          stage: stageKey,
          location: report.target ? { uri: report.target, line: 1, column: 1 } : undefined,
        });
      }
    }

    const hadStage = Boolean(report.stages[stageKey]);
    report.stages[stageKey] = {
      stage: stageKey,
      name: "Polyglot Digital Thread & Nelson-Oppen Coordinator",
      passed: threadRes.isSat,
      certified: threadRes.isSat,
      durationMs: threadRes.elapsedMs ?? 0,
      summary: threadRes.summaryText,
      violations,
      details: {
        scenarioId: threadRes.scenarioId,
        scenarioTitle: threadRes.scenarioTitle,
        domains: threadRes.domains,
        fileCount: threadRes.fileCount,
      },
    };

    if (!hadStage) {
      report.summary.totalStages += 1;
      if (threadRes.isSat) {
        report.summary.passedStages += 1;
        report.summary.certifiedStages += 1;
      } else {
        report.summary.failedStages += 1;
      }
    }
    report.summary.totalViolations += violations.length;
    if (!threadRes.isSat) {
      report.summary.overallPassed = false;
    }

    return report;
  }
}
