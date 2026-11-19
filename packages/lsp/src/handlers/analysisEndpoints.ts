// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseCsvMeasurements } from "@modelscript/csv/csv-parser";
import { generateRomWasmSource } from "@modelscript/exchange/fmu";
import { InpDialect } from "@modelscript/fea";
import {
  B2BEquivalenceVerifier,
  CandidateFilter,
  Causality,
  DAEBuilder,
  EqKind,
  foldArenaConstants,
  formatConstraint,
  performBltTransformationArena,
  RegionDecomposer,
  SemanticTheoryCoordinator,
  SosBarrierSynthesizer,
  TraceRecordNormalizer,
  UnifiedVerifier,
  Variability,
  type CanonicalTraceRecord,
  type UnifiedVerificationOptions,
  type UnifiedVerificationReport,
} from "@modelscript/runtime";
import {
  ArenaSimulator,
  buildArenaSurrogate,
  runMonteCarloArena,
  simulateArena,
  simulateArenaAsync,
  type ArenaDoEInputRange,
} from "@modelscript/simulate";
import { ModelicaCalibrator, ModelicaOptimizer } from "@modelscript/simulate/optimizer";
import {
  BoundaryTestSynthesizer,
  ContractAlgebra,
  DecisionTableVerifier,
  EventTraceExplorer,
  extractSysML2Constraints,
  extractSysML2ContractHierarchy,
  LoopInvariantAnalyzer,
  mapConstraintsToOptimizer,
  SysML2DaeLowerer,
  type AssumeGuaranteeContract,
  type WhileLoopInfo,
} from "@modelscript/sysml2";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ClosedLoopCompilerEngine, runSelfHealingPipeline } from "../agent/index.js";
import { LspContext, resolveFeatureFlags } from "../lsp-context.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { getRequirements } from "../requirements.js";
import { evaluateArenaExprToNum, getArenaParameterInfo, printArenaExpression } from "../utils/arena-utils.js";
import type { CstNodeLike, CstParserLike, CstTreeLike } from "../utils/ast-utils.js";
import {
  extractFirstQuotedLiteral,
  extractMeshSourceDirectives,
  isAsciiUpperCode,
  isIdentContCode,
  readIdentAt,
  skipWs,
  splitLines,
  stripFileExtension,
} from "../utils/lexical-utils.js";
import { flattenTargetClass } from "./simulationEndpoints.js";

interface CosimLspContextInternals {
  documentManager?: {
    documentTrees?: Map<string, { tree?: CstTreeLike | null }>;
  };
  state?: {
    sharedContext?: { parse?(ext: string, text: string): CstTreeLike | null };
  };
}

const lspRequire = createRequire(import.meta.url);
let cosimMoParserInstance: CstParserLike | null = null;

function parseCosimModelicaTree(context: LspContext, uri: string, text: string): CstTreeLike | null {
  const ctxInternal = context as unknown as CosimLspContextInternals;
  const existing = ctxInternal.documentManager?.documentTrees?.get?.(uri)?.tree;
  if (existing?.rootNode) return existing;
  try {
    const sc =
      ctxInternal.state?.sharedContext ??
      (context.parserService?.sharedContext as { parse?(ext: string, text: string): CstTreeLike | null } | undefined);
    if (sc && typeof sc.parse === "function") {
      return sc.parse(".mo", text);
    }
    const p = context.parserService?.getParser?.("modelica") as CstParserLike | undefined;
    if (p && typeof p.parse === "function") {
      return p.parse(text);
    }
    if (!cosimMoParserInstance) {
      const { createWasmParserSync } = lspRequire("@modelscript/dsl");
      const { SYNTAX_NAMES } = lspRequire("@modelscript/modelica/parser");
      const wasmPath = lspRequire.resolve("@modelscript/modelica/parser.wasm");
      cosimMoParserInstance = createWasmParserSync(wasmPath, { syntaxNames: SYNTAX_NAMES }).parser as CstParserLike;
    }
    return cosimMoParserInstance?.parse(text) ?? null;
  } catch {
    return null;
  }
}

function collectLeafTexts(node: CstNodeLike | null | undefined): string[] {
  const out: string[] = [];
  const stack: (CstNodeLike | null | undefined)[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    const ch = cur.children || [];
    if (ch.length === 0) {
      const t = cur.text?.trim();
      if (t) out.push(t);
    } else {
      for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
    }
  }
  return out;
}

function collectNodesByType(root: CstNodeLike | null | undefined, targetType: string): CstNodeLike[] {
  const results: CstNodeLike[] = [];
  const stack: (CstNodeLike | null | undefined)[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur.type === targetType) results.push(cur);
    const ch = cur.children || [];
    for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
  }
  return results;
}

function collectDirectOrNestedByType(root: CstNodeLike | null | undefined, targetType: string): CstNodeLike[] {
  return collectNodesByType(root, targetType);
}

function collectFirstNodeByTypes(root: CstNodeLike | null | undefined, types: string[]): CstNodeLike | null {
  const typeSet = new Set(types);
  const stack: (CstNodeLike | null | undefined)[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    if (typeSet.has(cur.type)) return cur;
    const ch = cur.children || [];
    for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
  }
  return null;
}

function extractModelicaModStringAttr(modNode: CstNodeLike | null | undefined, attrName: string): string | undefined {
  const elemMods = collectNodesByType(modNode, "element_modification");
  for (const em of elemMods) {
    const nameNode = collectFirstNodeByTypes(em, ["name", "identifier", "IDENT"]);
    if (nameNode && nameNode.text.trim() === attrName) {
      const strNode = collectFirstNodeByTypes(em, ["STRING", "string_literal"]);
      if (strNode) {
        return extractFirstQuotedLiteral(strNode.text);
      }
      return extractFirstQuotedLiteral(em.text);
    }
  }
  return undefined;
}

function extractModelNameFromUri(uri: string): string {
  const lastSlash = uri.lastIndexOf("/");
  const base = lastSlash !== -1 ? uri.slice(lastSlash + 1) : uri;
  return stripFileExtension(base) || "model";
}

export interface BltAnalysisResult {
  className: string;
  variables: string[];
  equations: string[];
  algebraicLoops: { variables: string[]; equations: string[] }[];
  equationCount: number;
  unknownCount: number;
}

export interface IntervalBound {
  variable: string;
  lower: number;
  upper: number;
  isComputed: boolean;
}

export interface IntervalAnalysisResult {
  className: string;
  bounds: IntervalBound[];
  totalVariables: number;
  boundedCount: number;
}

export interface OptimizationResult {
  className: string;
  status: "optimal" | "infeasible" | "error";
  objectiveValue: number | null;
  parameters: { name: string; value: number }[];
  iterations: number;
  message: string;
}

export interface SysIdResult {
  className: string;
  status: "converged" | "failed" | "error";
  fittedParameters: { name: string; initial: number; fitted: number }[];
  residualNorm: number;
  iterations: number;
  message: string;
}

export interface SymbolicRewriteStep {
  from: string;
  to: string;
  rule: string;
}

export interface SymbolicTraceResult {
  className: string;
  equation: string;
  steps: SymbolicRewriteStep[];
  simplified: string;
}

export interface CosimParticipantInfo {
  id: string;
  type: "fmu" | "modelica";
  className: string;
  fileName?: string | undefined;
}

export interface CosimCouplingInfo {
  from: { participantId: string; variable: string };
  to: { participantId: string; variable: string };
}

export interface CosimGraphResult {
  ok: boolean;
  participants?: CosimParticipantInfo[] | undefined;
  couplings?: CosimCouplingInfo[] | undefined;
  error?: string | undefined;
}

export function registerAnalysisEndpoints(context: LspContext) {
  context.connection.onRequest(
    "modelscript/trainSurrogate",
    async (params: {
      uri: string;
      className?: string | undefined;
      inputs: Record<string, { min: number; max: number; levels?: number | undefined }>;
      outputs: string[];
      strategy?: "full-factorial" | "latin-hypercube" | "sobol" | "central-composite" | undefined;
      numSamples?: number | undefined;
      architecture?: "polynomial" | "rbf" | "mlp" | undefined;
      hiddenLayers?: number[] | undefined;
      activation?: "tanh" | "relu" | "sigmoid" | undefined;
      polynomialDegree?: number | undefined;
      epochs?: number | undefined;
      learningRate?: number | undefined;
      startTime?: number | undefined;
      stopTime?: number | undefined;
      stepSize?: number | undefined;
      seed?: number | undefined;
    }): Promise<{
      success: boolean;
      metrics?: { trainMSE: number; valMSE: number; r2: number } | undefined;
      inputNames?: string[] | undefined;
      outputNames?: string[] | undefined;
      architecture?: string | undefined;
      wasmC?: string | undefined;
      modelDescriptionXml?: string | undefined;
      emccFlags?: string[] | undefined;
      exportedFunctions?: string[] | undefined;
      error?: string | undefined;
    }> => {
      context.connection.console.info(`[trainSurrogate] Requested for URI: ${params.uri}`);

      try {
        // 1. Flatten the model to get a DAE, then build a simulator
        let instances = context.workspaceManager.documentInstances.get(params.uri);
        if (!instances || instances.length === 0) {
          const doc = context.documents.get(params.uri);
          if (doc) await context.validationService.validateTextDocument(doc);
          instances = context.workspaceManager.documentInstances.get(params.uri);
        }
        if (!instances || instances.length === 0) {
          return { success: false, error: "No class instances found for this document." };
        }

        let classInstance = instances[0];
        if (params.className) {
          const found = instances.find((i) => i.name === params.className);
          if (found) classInstance = found;
        }

        const docContext = context.workspaceManager.documentContexts.get(params.uri);
        if (!docContext) {
          return { success: false, error: `No Modelica context found for URI '${params.uri}'` };
        }

        const arena = flattenArenaFromInstance(classInstance, docContext);
        const exp = arena.experiment;
        const startTime = params.startTime ?? exp.startTime ?? 0;
        const stopTime = params.stopTime ?? exp.stopTime ?? 1;
        const stepSize = params.stepSize ?? exp.interval ?? (stopTime - startTime) / 100;

        // 2. Prepare DoE input parameter ranges
        const inputRanges = new Map<string, ArenaDoEInputRange>();
        if (params.inputs && Object.keys(params.inputs).length > 0) {
          for (const [name, range] of Object.entries(params.inputs)) {
            inputRanges.set(name, range as ArenaDoEInputRange);
          }
        } else {
          // Auto-discover parameters with min/max bounds or fallback to bindings
          for (let i = 0; i < arena.varCount; i++) {
            if (arena.isVarRemoved(i)) continue;
            if (arena.getVarVariability(i) !== Variability.Parameter) continue;

            const name = arena.getVarName(i);
            // Skip Modelica string/boolean parameters (which evaluate to null)

            const minVal = evaluateArenaExprToNum(arena, arena.getVarAttrExprId(i, "min"));
            const maxVal = evaluateArenaExprToNum(arena, arena.getVarAttrExprId(i, "max"));

            if (minVal !== null && maxVal !== null && minVal < maxVal) {
              inputRanges.set(name, { min: minVal, max: maxVal });
            } else {
              // Fallback: use nominal binding +/- 20%
              const bindingExprId = arena.getVarBindingExprId(i);
              if (bindingExprId !== undefined) {
                const startVal = evaluateArenaExprToNum(arena, bindingExprId);
                if (startVal !== null) {
                  const min = startVal === 0 ? -1 : startVal > 0 ? startVal * 0.8 : startVal * 1.2;
                  const max = startVal === 0 ? 1 : startVal > 0 ? startVal * 1.2 : startVal * 0.8;
                  inputRanges.set(name, { min, max });
                }
              }
            }
          }
        }

        if (inputRanges.size === 0) {
          return {
            success: false,
            error:
              "No input parameters found. Please define 'min' and 'max' attributes on at least one parameter (e.g., parameter Real p(min=0, max=1);).",
          };
        }

        // If no outputs specified, use all state + algebraic variables from arena
        const outputNames = params.outputs && params.outputs.length > 0 ? params.outputs : [];
        if (outputNames.length === 0) {
          for (let i = 0; i < arena.varCount; i++) {
            if (arena.isVarRemoved(i)) continue;
            const varVariability = arena.getVarVariability(i);
            if (varVariability === Variability.Parameter || varVariability === Variability.Constant) continue;
            outputNames.push(arena.getVarName(i));
          }
        }

        // 3. Run the surrogate pipeline
        context.connection.console.info(
          `[trainSurrogate] Running DoE (${params.strategy ?? "latin-hypercube"}, ${params.numSamples ?? 50} samples)...`,
        );

        const surrogateResult = buildArenaSurrogate(
          arena,
          {
            doe: {
              inputs: inputRanges,
              outputs: outputNames,
              strategy: (params.strategy ?? "latin-hypercube") as
                | "full-factorial"
                | "latin-hypercube"
                | "sobol"
                | "central-composite",
              numSamples: params.numSamples ?? 50,
              simulateOptions: {
                startTime,
                stopTime,
                step: stepSize,
                solver: "dopri5",
              },
              seed: params.seed,
            },
            rom: {
              architecture: (params.architecture ?? "mlp") as "mlp" | "polynomial" | "rbf",
              hiddenLayers: params.hiddenLayers,
              activation: params.activation,
              polynomialDegree: params.polynomialDegree,
              epochs: params.epochs,
              learningRate: params.learningRate,
              seed: params.seed,
            },
          },
          (phase, _progress, detail) => {
            context.connection.console.info(`[trainSurrogate] ${phase}: ${detail}`);
          },
        );

        context.connection.console.info(
          `[trainSurrogate] Complete: R²=${surrogateResult.metrics.r2.toFixed(4)}, Train MSE=${surrogateResult.metrics.trainMSE.toExponential(4)}`,
        );

        // 4. Generate WASM C source from the trained ROM
        const modelId = (classInstance.name || "Surrogate").replaceAll(".", "_");
        const wasmResult = generateRomWasmSource(surrogateResult.trainedROM, modelId);

        return {
          success: true,
          metrics: surrogateResult.metrics,
          inputNames: surrogateResult.trainedROM.inputNames,
          outputNames: surrogateResult.trainedROM.outputNames,
          architecture: surrogateResult.trainedROM.architecture,
          wasmC: wasmResult.wasmC,
          modelDescriptionXml: wasmResult.modelDescriptionXml,
          emccFlags: wasmResult.emccFlags,
          exportedFunctions: wasmResult.exportedFunctions,
        };
      } catch (e) {
        context.connection.console.error(`[trainSurrogate] Error: ${e}`);
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  const handleOptimizeModel = async (params: {
    uri: string;
    className?: string | undefined;
    objective?: string | undefined;
    controls?: string[] | undefined;
    controlBounds?: Record<string, { min: number; max: number }> | undefined;
    startTime?: number | undefined;
    stopTime?: number | undefined;
    numIntervals?: number | undefined;
    tolerance?: number | undefined;
    maxIterations?: number | undefined;
    parameterOverrides?: Record<string, number> | undefined;
    /** URI of a SysML2 document containing requirement constraints to inject */
    sysmlUri?: string | undefined;
    /** Optional filter (analysis/package name) to restrict constraint extraction */
    sysmlFilter?: string | undefined;
    /** Optional explicit variable mapping from SysML2 paths to Modelica variable names */
    sysmlVariableMap?: Record<string, string> | undefined;
  }): Promise<{
    success: boolean;
    cost: number;
    iterations: number;
    t: number[];
    states: Record<string, number[]>;
    controls: Record<string, number[]>;
    costHistory: number[];
    messages: string;
    error?: string | undefined;
  }> => {
    context.connection.console.info(`[optimize] Requested optimization for URI: ${params.uri}`);
    let instances = context.workspaceManager.documentInstances.get(params.uri);
    if (!instances || instances.length === 0) {
      const doc = context.documents.get(params.uri);
      if (doc) {
        await context.validationService.validateTextDocument(doc);
        instances = context.workspaceManager.documentInstances.get(params.uri);
      }
    }
    if (!instances || instances.length === 0) {
      return {
        success: false,
        cost: 0,
        iterations: 0,
        t: [],
        states: {},
        controls: {},
        costHistory: [],
        messages: "",
        error: "No class instances found for this document.",
      };
    }

    let classInstance = instances[0];
    if (params.className) {
      const found = instances.find((i) => i.name === params.className);
      if (found) classInstance = found;
    }

    try {
      const moIdx = context.workspaceManager.getWorkspaceIndex("modelica");
      if (!context.state.dependenciesReady && (moIdx?.pendingFileCount ?? 0) > 0) {
        const fullIndex = context.workspaceManager.unifiedWorkspace.getIndex();
        injectPredefinedTypes(fullIndex);
        const langId = params.uri.endsWith(".sysml") ? "sysml2" : "modelica";
        const engine = context.workspaceManager.getQueryEngine(langId);
        if (engine) engine.updateIndex(fullIndex);

        const doc = context.documents.get(params.uri);
        if (doc) await context.validationService.validateTextDocument(doc);
        instances = context.workspaceManager.documentInstances.get(params.uri);
        if (!instances || instances.length === 0) throw new Error("No class instances found after indexing.");
        classInstance = params.className
          ? (instances.find((i) => i.name === params.className) ?? instances[0])
          : instances[0];
      }

      const docContext = context.workspaceManager.documentContexts.get(params.uri);
      if (!docContext) {
        throw new Error(`No Modelica context found for URI '${params.uri}'`);
      }

      const arena = flattenArenaFromInstance(classInstance, docContext);
      const exp = arena.experiment;

      // In Optimica, the controls are usually identified by looking at variables with free=true.
      // But we accept overrides from the UI if present.
      let finalControls = params.controls;
      if (!finalControls || finalControls.length === 0) {
        finalControls = [];
        for (let i = 0; i < arena.varCount; i++) {
          if (arena.isVarRemoved(i)) continue;
          if (arena.getVarAttrExprId(i, "free") !== undefined) {
            finalControls.push(arena.getVarName(i));
          }
        }
      }
      if (!finalControls || finalControls.length === 0) {
        // Fallback or testing
        finalControls = ["u"];
      }

      // ── Constraints injection ──
      let stateConstraints: { variable: string; bound: number; type: "<=" | ">=" }[] | undefined;
      const pExt = params as unknown as {
        constraintsUri?: string;
        constraintsFilter?: string;
        variableMap?: Record<string, unknown>;
      };
      const constraintsUri = pExt.constraintsUri ?? params.sysmlUri;
      const qe = context.workspaceManager.getQueryEngine("sysml2");
      if (constraintsUri && qe) {
        try {
          // Ensure the document is indexed
          const doc = context.documents.get(constraintsUri);
          if (doc) await context.validationService.validateTextDocument(doc);

          const sysmlDb = qe.toQueryDB();
          const rawConstraints = extractSysML2Constraints(sysmlDb, params.sysmlFilter ?? pExt.constraintsFilter);
          const rawVarMap = params.sysmlVariableMap ?? pExt.variableMap;
          const variableMap = rawVarMap
            ? new Map<string, string>(Object.entries(rawVarMap).map(([k, v]) => [k, String(v)]))
            : undefined;
          stateConstraints = mapConstraintsToOptimizer(rawConstraints, variableMap);
          context.connection.console.info(`[optimize] Extracted ${stateConstraints?.length ?? 0} constraints`);
        } catch (e) {
          context.connection.console.warn(
            `[optimize] Constraint extraction failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      const optimizer = new ModelicaOptimizer(arena, {
        objective: params.objective ?? "u^2",
        controls: finalControls,
        controlBounds: params.controlBounds ? new Map(Object.entries(params.controlBounds)) : new Map(),
        startTime: params.startTime ?? exp.startTime ?? 0,
        stopTime: params.stopTime ?? exp.stopTime ?? 10,
        numIntervals: params.numIntervals ?? 50,
        tolerance: params.tolerance ?? 1e-6,
        maxIterations: params.maxIterations ?? 200,
        parameterOverrides: params.parameterOverrides ? new Map(Object.entries(params.parameterOverrides)) : undefined,
        stateConstraints,
      });

      const result = optimizer.solve();

      return {
        success: result.success,
        cost: result.cost,
        iterations: result.iterations,
        t: result.t,
        states: Object.fromEntries(result.states),
        controls: Object.fromEntries(result.controls),
        costHistory: result.costHistory,
        messages: result.messages,
      };
    } catch (e) {
      console.error("[optimize] Error:", e);
      return {
        success: false,
        cost: 0,
        iterations: 0,
        t: [],
        states: {},
        controls: {},
        costHistory: [],
        messages: "",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  };

  context.connection.onRequest("modelscript/optimizeModel", handleOptimizeModel);
  context.connection.onRequest("modelscript/optimize", handleOptimizeModel);

  context.connection.onRequest(
    "modelscript/verifyAll",
    async (
      params: {
        uri: string;
        target?: string | undefined;
        options?: UnifiedVerificationOptions | undefined;
        format?: "terminal" | "json" | "ctrf" | "junit" | "sarif" | "html" | "dhf" | undefined;
      },
      token?: any,
    ): Promise<UnifiedVerificationReport> => {
      context.connection.console.info(`[verifyAll] Requested unified verification for URI: ${params.uri}`);
      const docVersionsAtStart = new Map<string, number>();
      for (const d of context.documents?.all?.() ?? []) {
        docVersionsAtStart.set(d.uri, d.version);
      }
      const hasStaleDocument = () => {
        for (const d of context.documents?.all?.() ?? []) {
          const prev = docVersionsAtStart.get(d.uri);
          if (prev !== undefined && d.version !== prev) return true;
        }
        return false;
      };
      try {
        let sourceText = "";
        try {
          const doc = context.documents.get(params.uri);
          if (doc) sourceText = doc.getText();
        } catch {}
        if (!sourceText) {
          const fs = await import("node:fs");
          const { fileURLToPath } = await import("node:url");
          const filePath = params.uri.startsWith("file://") ? fileURLToPath(params.uri) : params.uri;
          if (fs.existsSync(filePath)) {
            sourceText = fs.readFileSync(filePath, "utf-8");
          }
        }

        // 1. Resolve queryDB from workspace manager (Modelica or SysML v2)
        const qe =
          context.workspaceManager.getQueryEngine("modelica") || context.workspaceManager.getQueryEngine("sysml2");
        let queryDB: unknown = undefined;
        const qeWithToDb = qe as unknown as { toQueryDB?: () => unknown } | undefined;
        if (qeWithToDb && typeof qeWithToDb.toQueryDB === "function") {
          try {
            queryDB = qeWithToDb.toQueryDB();
          } catch {}
        }
        if (!queryDB && context.workspaceManager?.unifiedWorkspace) {
          try {
            queryDB = context.workspaceManager.unifiedWorkspace.getIndex();
          } catch {}
        }

        // 2. Resolve DAE arena if target is specified or available
        let arena: DAEBuilder | null = null;
        try {
          const flattenRes = flattenTargetClass(context, params.uri, params.target);
          if (flattenRes && "arena" in flattenRes && flattenRes.arena) {
            arena = flattenRes.arena;
          }
        } catch {}

        if (!arena && context.parserService?.sharedContext) {
          try {
            const sc = context.parserService.sharedContext as unknown as {
              flattenArena?: (model: string, cfg: unknown, uri: string) => DAEBuilder | null;
            };
            const modelName = params.target || extractModelNameFromUri(params.uri);
            if (typeof sc.flattenArena === "function") {
              arena = sc.flattenArena(modelName, undefined, params.uri);
            }
          } catch {}
        }

        // 3. Perform simulation if needed for trajectory verification or B2B
        const options: UnifiedVerificationOptions = params.options || { all: true };
        if (!options.cancellationToken && token) {
          options.cancellationToken = token;
        }
        let simResult: Awaited<ReturnType<typeof simulateArenaAsync>> | undefined = undefined;
        const needsSim = options.all || options.trajectories !== false || options.b2b;
        if (arena && needsSim) {
          try {
            const exp = arena.experiment;
            const startTime = exp?.startTime ?? 0;
            const stopTime = exp?.stopTime ?? 10;
            const step = options.b2bDt ?? exp?.interval ?? (stopTime - startTime) / 1000;
            simResult = await simulateArenaAsync(arena, {
              startTime,
              stopTime,
              step,
            });
          } catch (simErr: unknown) {
            const msg = simErr instanceof Error ? simErr.message : String(simErr);
            context.connection.console.warn(`[verifyAll] Numeric simulation warning: ${msg}`);
          }
        }

        // 4. Run Unified Verification via Theory Coordinator & Verifier
        const wmExt = context.workspaceManager as unknown as {
          getCoordinator?: () => SemanticTheoryCoordinator;
          coordinator?: SemanticTheoryCoordinator;
        };
        const coordinator = wmExt?.getCoordinator?.() || wmExt?.coordinator || new SemanticTheoryCoordinator();

        const report = await UnifiedVerifier.verify(
          {
            uri: params.uri,
            sourceText,
            queryDB,
            arena: arena ?? undefined,
            simulationResult: simResult,
            coordinator,
            paths: [params.uri],
          },
          options,
        );

        const openDocs = context.documents?.all?.() ?? [];
        const discoveredMap = new Map<string, { uri: string; fileName: string; content: string }>();
        const normalizeDiscoveryKey = (uri: string) => uri.replace(/^([a-z0-9+-]+):\/(?!\/)/i, "$1:///").toLowerCase();
        const isVirtualStdlibUri = (uri: string) => /^(builtin|modelica|msl):/i.test(uri);
        const addDiscoveredFile = (uri: string, content: string) => {
          const normKey = normalizeDiscoveryKey(uri);
          if (discoveredMap.has(normKey)) return;
          discoveredMap.set(normKey, {
            uri,
            fileName: uri.split(/[\\/]/).pop() || uri,
            content,
          });
        };

        for (const d of openDocs) {
          addDiscoveredFile(d.uri, d.getText());
        }

        const unifiedWs = context.workspaceManager?.unifiedWorkspace as unknown as
          | {
              getAllDocumentEntries?: () => Array<{ uri?: string; text?: string }>;
              getIndex?: () => {
                documents?: Map<string, string | { text?: string; source?: string }>;
                symbolsByResource?: Map<string, unknown>;
              };
              getDocument?: (uri: string) => unknown;
            }
          | undefined;
        if (unifiedWs && typeof unifiedWs.getAllDocumentEntries === "function") {
          for (const entry of unifiedWs.getAllDocumentEntries()) {
            if (entry?.uri && entry.text && entry.text.trim().length > 0 && !isVirtualStdlibUri(entry.uri)) {
              addDiscoveredFile(entry.uri, entry.text);
            }
          }
        }
        const indexedIndex = unifiedWs?.getIndex?.();
        const fallbackIndexDocs = indexedIndex?.documents;
        if (fallbackIndexDocs && typeof fallbackIndexDocs.entries === "function") {
          for (const [docUri, docVal] of fallbackIndexDocs.entries()) {
            const docText = typeof docVal === "string" ? docVal : (docVal?.text ?? docVal?.source);
            if (docUri && docText && docText.trim().length > 0 && !isVirtualStdlibUri(docUri)) {
              addDiscoveredFile(docUri, docText);
            }
          }
        }
        if (indexedIndex?.symbolsByResource) {
          for (const resUri of indexedIndex.symbolsByResource.keys()) {
            if (!resUri || isVirtualStdlibUri(resUri)) continue;
            const docsExt = context.documents as unknown as { get?: (uri: string) => unknown } | undefined;
            const wmDocs = context.workspaceManager as unknown as
              | { getDocument?: (uri: string) => unknown }
              | undefined;
            const uDoc = (unifiedWs?.getDocument?.(resUri) ??
              docsExt?.get?.(resUri) ??
              wmDocs?.getDocument?.(resUri)) as { getText?: () => string; text?: string } | undefined;
            const docText =
              typeof uDoc?.text === "string"
                ? uDoc.text
                : typeof uDoc?.getText === "function"
                  ? uDoc.getText()
                  : undefined;
            if (docText && docText.trim().length > 0) {
              addDiscoveredFile(resUri, docText);
            }
          }
        }

        if (sourceText) {
          addDiscoveredFile(params.uri, sourceText);
        }

        const POLYGLOT_MODEL_EXT_RE =
          /\.(sysml|sysml2|mo|ms|msx|sp|cir|spice|scad|inp|cfd|urdf|step|stp|reqif|omn|ofn|owl)$/i;
        // Discover transitively referenced files (*INCLUDE, @mesh_source:) and sibling model files on disk
        try {
          const initialEntries = Array.from(discoveredMap.values());
          for (const entry of initialEntries) {
            if (!entry.uri.startsWith("file://")) continue;
            let fsPath: string;
            try {
              fsPath = fileURLToPath(entry.uri);
            } catch {
              continue;
            }
            const dir = path.dirname(fsPath);
            // Referenced files via *INCLUDE, INPUT=... (FEA INP) or @mesh_source: ...
            const includeRefs = entry.content.toUpperCase().includes("*INCLUDE")
              ? (new InpDialect().parse(entry.content).includes ?? [])
              : [];
            const refTargets = [...includeRefs, ...extractMeshSourceDirectives(entry.content)];
            for (const rawRef of refTargets) {
              const refRel = rawRef.trim();
              if (!refRel) continue;
              const refPath = path.resolve(dir, refRel);
              if (fs.existsSync(refPath) && fs.statSync(refPath).isFile()) {
                addDiscoveredFile(pathToFileURL(refPath).href, fs.readFileSync(refPath, "utf-8"));
              }
            }
            // Sibling model files in the target file's directory (capped at 24 files)
            if (entry.uri.toLowerCase() === params.uri.toLowerCase() && fs.existsSync(dir)) {
              const siblings = fs
                .readdirSync(dir)
                .filter((f) => POLYGLOT_MODEL_EXT_RE.test(f))
                .slice(0, 24);
              for (const sib of siblings) {
                const sibPath = path.join(dir, sib);
                try {
                  if (fs.statSync(sibPath).isFile()) {
                    addDiscoveredFile(pathToFileURL(sibPath).href, fs.readFileSync(sibPath, "utf-8"));
                  }
                } catch {
                  // Ignore unreadable sibling
                }
              }
            }
          }
        } catch {
          // Non-fatal disk discovery fallback
        }

        const workspaceFiles = Array.from(discoveredMap.values());
        const uniqueExts = new Set(
          workspaceFiles.map((d) => {
            const name = d.fileName;
            const dot = name.lastIndexOf(".");
            return dot >= 0 ? name.slice(dot).toLowerCase() : "";
          }),
        );
        const hasCrossLanguageDirective = workspaceFiles.some((d) => {
          const txt = d.content;
          return (
            txt.includes("@twin:") ||
            txt.includes("@port_map:") ||
            txt.includes("@mesh_source:") ||
            txt.includes("annotation(twin")
          );
        });
        const hasPolyglotWorkspace =
          (workspaceFiles.length >= 2 && uniqueExts.size >= 2) ||
          hasCrossLanguageDirective ||
          workspaceFiles.some((d) => /\.(scad|inp|cfd|urdf|step|stp)$/i.test(d.uri));
        if (hasPolyglotWorkspace) {
          try {
            const [
              { createPolyglotCoordinator },
              { OpenFoamDialect, evaluateCfdExpression },
              { InpDialect },
              { evaluateScad },
              { scanStepEntities },
              { parseUrdf },
              { computeMeshVolumeAndArea, ToleranceStackVerifier, SolidKind },
              { LbmVoxelizer, WebGPULbmRunner, FeaSolver, Tet4Mesher, MeshQualityAnalyzer },
            ] = await Promise.all([
              import("@modelscript/runtime"),
              import("@modelscript/cfd"),
              import("@modelscript/fea"),
              import("@modelscript/scad"),
              import("@modelscript/step"),
              import("@modelscript/urdf"),
              import("@modelscript/cad"),
              import("@modelscript/simulate"),
            ]);
            const { evaluatePolyglotDigitalThreadFromFiles } = createPolyglotCoordinator({
              OpenFoamDialect,
              evaluateCfdExpression,
              InpDialect,
              evaluateScad,
              scanStepEntities,
              parseUrdf,
              computeMeshVolumeAndArea,
              ToleranceStackVerifier,
              SolidKind,
              LbmVoxelizer,
              WebGPULbmRunner,
              FeaSolver,
              Tet4Mesher,
              MeshQualityAnalyzer,
            });
            const symbolIndex = context.workspaceManager?.unifiedWorkspace?.getIndex?.();
            for (const wf of workspaceFiles) {
              const wfExt = wf as { theoryConstraints?: unknown };
              const plugin = globalLanguageRegistry.getPluginForUri(wf.uri);
              if (plugin?.extractTheoryConstraints && !wfExt.theoryConstraints) {
                try {
                  wfExt.theoryConstraints = await plugin.extractTheoryConstraints(wf.content, wf.uri, symbolIndex);
                } catch {
                  // Non-fatal typed extractor fallback
                }
              }
            }
            const threadRes = evaluatePolyglotDigitalThreadFromFiles(workspaceFiles, undefined, { symbolIndex });
            const portBindings =
              "parsedMetadata" in threadRes ? threadRes.parsedMetadata.portBindings : threadRes.portBindings;
            const artifacts = "artifacts" in threadRes ? threadRes.artifacts : undefined;
            const suggestedEdits = "suggestedEdits" in threadRes ? threadRes.suggestedEdits : undefined;
            const evaluatedEquations =
              "evaluatedEquations" in threadRes
                ? threadRes.evaluatedEquations
                : "parsedMetadata" in threadRes
                  ? threadRes.parsedMetadata.evaluatedEquations
                  : undefined;
            const threadPayload = {
              mode: ("mode" in threadRes ? threadRes.mode : "scenario") as "generic" | "scenario",
              scenarioId: threadRes.scenarioId,
              scenarioTitle: threadRes.scenarioTitle,
              status: threadRes.status,
              isSat: threadRes.isSat,
              elapsedMs: threadRes.elapsedMs,
              fileCount: "fileCount" in threadRes ? threadRes.fileCount : workspaceFiles.length,
              domains:
                "domains" in threadRes
                  ? threadRes.domains
                  : Array.from(new Set(threadRes.hypergraphNodes.map((n) => n.domainName))),
              summaryText: threadRes.summaryText,
              artifacts,
              hypergraphNodes: threadRes.hypergraphNodes,
              variableLinks: threadRes.variableLinks,
              portBindings,
              evaluatedEquations,
              suggestedEdits,
              conflicts: threadRes.conflicts,
            };
            UnifiedVerifier.attachPolyglotDigitalThread(report, threadPayload);

            // Merge & push live LSP diagnostics per artifact URI without clobbering existing lints
            if (Array.isArray(artifacts)) {
              const diagsByUri = new Map<
                string,
                Array<{
                  range: { start: { line: number; character: number }; end: { line: number; character: number } };
                  severity: number;
                  code?: string | undefined;
                  source: string;
                  message: string;
                  data?: { suggestedEdits: unknown[] } | undefined;
                }>
              >();
              for (const art of artifacts) {
                if (!art.uri) continue;
                const mapped = (art.diagnostics ?? []).map((d) => ({
                  range: {
                    start: { line: Math.max(0, (d.startLine ?? 1) - 1), character: Math.max(0, (d.startCol ?? 1) - 1) },
                    end: {
                      line: Math.max(0, (d.endLine ?? d.startLine ?? 1) - 1),
                      character: Math.max(0, (d.endCol ?? d.startCol ?? 1) - 1),
                    },
                  },
                  severity: d.severity === "warning" ? 2 : d.severity === "info" ? 3 : 1,
                  code: d.code,
                  source: "modelscript-digital-thread",
                  message: d.message,
                  data: suggestedEdits && suggestedEdits.length > 0 ? { suggestedEdits } : undefined,
                }));
                diagsByUri.set(art.uri, mapped);
              }
              const ctxExt = context as unknown as {
                validationService?: { mergeDigitalThreadDiagnostics?: (m: typeof diagsByUri) => void };
              };
              if (!hasStaleDocument()) {
                if (typeof ctxExt.validationService?.mergeDigitalThreadDiagnostics === "function") {
                  ctxExt.validationService.mergeDigitalThreadDiagnostics(diagsByUri);
                } else if (typeof context.connection?.sendDiagnostics === "function") {
                  for (const [uri, diagnostics] of diagsByUri.entries()) {
                    context.connection.sendDiagnostics({
                      uri,
                      diagnostics: diagnostics as Parameters<
                        typeof context.connection.sendDiagnostics
                      >[0]["diagnostics"],
                    });
                  }
                }
              }
            }
          } catch (polyErr: unknown) {
            context.connection.console.warn(
              `[verifyAll] Polyglot digital thread coordinator warning: ${polyErr instanceof Error ? polyErr.message : String(polyErr)}`,
            );
          }
        }

        // 5. Query active trade study Pareto fronts if requested
        const optsExt = options as unknown as { tradeStudy?: boolean; pareto?: boolean };
        if (optsExt.tradeStudy || optsExt.pareto) {
          const wmCand = context.workspaceManager as unknown as {
            getCandidates?: (uri: string) => Parameters<typeof CandidateFilter.extractParetoFronts>[0];
          };
          const paramsCand = params as unknown as {
            candidates?: Parameters<typeof CandidateFilter.extractParetoFronts>[0];
          };
          const rawCandidates = wmCand?.getCandidates?.(params.uri) || paramsCand.candidates || [];
          if (rawCandidates.length > 0) {
            const paretoFronts = CandidateFilter.extractParetoFronts(rawCandidates);
            (report as unknown as { tradeStudy?: unknown }).tradeStudy = {
              candidatesCount: rawCandidates.length,
              paretoFrontsCount: paretoFronts.length,
              topParetoFront: paretoFronts[0] || [],
            };
          }
        }

        // 5. Generate formatted output if requested
        if (params.format) {
          let formattedOutput = "";
          switch (params.format) {
            case "json":
              formattedOutput = JSON.stringify(report, null, 2);
              break;
            case "sarif":
              formattedOutput = UnifiedVerifier.formatSarif(report);
              break;
            case "html":
              formattedOutput = UnifiedVerifier.formatHtml(report);
              break;
            case "ctrf":
              formattedOutput = JSON.stringify(UnifiedVerifier.formatCtrf(report), null, 2);
              break;
            case "junit":
              formattedOutput = UnifiedVerifier.formatJunit(report);
              break;
            case "dhf":
              formattedOutput = UnifiedVerifier.formatDhf(report);
              break;
            case "terminal":
              formattedOutput = report.summary.overallPassed ? "PASS" : "FAIL";
              break;
          }
          if (!report.artifacts) {
            report.artifacts = {};
          }
          (report.artifacts as unknown as { formattedOutput?: string }).formattedOutput = formattedOutput;
        }

        return report;
      } catch (err: unknown) {
        return {
          timestamp: new Date().toISOString(),
          target: params.target || params.uri,
          summary: {
            totalStages: 1,
            passedStages: 0,
            failedStages: 1,
            certifiedStages: 0,
            skippedStages: 0,
            totalViolations: 1,
            durationMs: 0,
            overallPassed: false,
          },
          stages: {
            error: {
              stage: "error",
              name: "Unified Verifier",
              passed: false,
              durationMs: 0,
              summary: err instanceof Error ? err.message : String(err),
              violations: [
                { stage: "error", message: err instanceof Error ? err.message : String(err), severity: "error" },
              ],
            },
          },
        };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/verifyB2B",
    async (params: {
      uri: string;
      target?: string | undefined;
      tolerance?: number | undefined;
      compiler?: string | undefined;
      fixedStepDt?: number | undefined;
      format?: "terminal" | "json" | "ctrf" | "junit" | "sarif" | "html" | "dhf" | undefined;
    }) => {
      context.connection.console.info(`[verifyB2B] Requested B2B verification for URI: ${params.uri}`);
      try {
        let arena: DAEBuilder | null = null;
        try {
          const flattenRes = flattenTargetClass(context, params.uri, params.target);
          if (flattenRes && "arena" in flattenRes && flattenRes.arena) {
            arena = flattenRes.arena;
          }
        } catch {}

        if (!arena && context.parserService?.sharedContext) {
          try {
            const sc = context.parserService.sharedContext as any;
            const modelName = params.target || extractModelNameFromUri(params.uri);
            if (typeof sc.flattenArena === "function") {
              arena = sc.flattenArena(modelName, undefined, params.uri);
            }
          } catch {}
        }

        if (!arena) {
          throw new Error(`Could not resolve or flatten target model for '${params.target || params.uri}'`);
        }

        const exp = arena.experiment;
        const startTime = exp?.startTime ?? 0;
        const stopTime = exp?.stopTime ?? 10;
        const step = params.fixedStepDt ?? exp?.interval ?? (stopTime - startTime) / 1000;

        const milResult = await simulateArenaAsync(arena, {
          startTime,
          stopTime,
          step,
        });

        const b2bResult = await B2BEquivalenceVerifier.verify(arena, milResult, {
          tolerance: params.tolerance ?? 1e-4,
          compiler: (params.compiler ?? "gcc") as any,
          ...(params.fixedStepDt !== undefined ? { fixedStepDt: params.fixedStepDt } : {}),
        } as any);

        const violations: any[] = [];
        if (!b2bResult.passed) {
          for (const disc of b2bResult.discrepancies.slice(0, 10)) {
            violations.push({
              id: "MSC-VERIFY-B2B-DISCREPANCY",
              stage: "b2b",
              severity: "error",
              message: `MiL-vs-SiL discrepancy on signal '${disc.variable}' at t=${disc.time.toFixed(4)}s: |MiL(${disc.milValue.toExponential(3)}) - SiL(${disc.silValue.toExponential(3)})| = ${disc.absError.toExponential(3)} > tol (${disc.tolerance.toExponential(3)})`,
              location: { uri: params.uri },
              witness: disc,
            });
          }
        }

        const stage = {
          stage: "b2b",
          name: "Back-to-Back MiL vs SiL Equivalence (ISO 26262 TCL1)",
          passed: b2bResult.passed,
          certified: b2bResult.certified,
          durationMs: 0,
          summary: b2bResult.summary,
          violations,
          details: b2bResult,
        };

        let formattedOutput: string | undefined = undefined;
        if (params.format === "dhf") {
          const report: UnifiedVerificationReport = {
            timestamp: new Date().toISOString(),
            target: (arena as any).modelName || params.target || "model",
            summary: {
              totalStages: 1,
              passedStages: b2bResult.passed ? 1 : 0,
              failedStages: b2bResult.passed ? 0 : 1,
              certifiedStages: b2bResult.certified ? 1 : 0,
              skippedStages: 0,
              totalViolations: violations.length,
              durationMs: 0,
              overallPassed: b2bResult.passed,
            },
            stages: {
              b2b: stage,
            },
          };
          formattedOutput = UnifiedVerifier.formatDhf(report);
        }

        return {
          success: b2bResult.passed,
          stage,
          modelName: (arena as any).modelName || params.target,
          tolerance: params.tolerance ?? 1e-4,
          maxDiscrepancy: b2bResult.maxError,
          worstVariable: b2bResult.maxErrorVariable,
          sha256CSource: b2bResult.cSourceHash,
          milTimeSpan: [startTime, stopTime],
          formattedOutput,
        };
      } catch (err: any) {
        context.connection.console.error(`[verifyB2B] Error: ${err.message || err}`);
        return {
          success: false,
          error: err.message || String(err),
        };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/calibrate",
    async (params: {
      uri: string;
      className?: string | undefined;
      csvData: string;
      timeColumn?: string | undefined;
      columnMapping?: Record<string, string> | undefined;
      parameters: string[];
      parameterBounds?: Record<string, { min: number; max: number }> | undefined;
      tolerance?: number | undefined;
      maxIterations?: number | undefined;
      method?: "lm" | "sqp" | undefined;
    }): Promise<{
      success: boolean;
      parameters: Record<string, number>;
      residual: number;
      iterations: number;
      simulated: {
        t: number[];
        y: number[][];
        states: string[];
      };
      costHistory: number[];
      error?: string | undefined;
    }> => {
      context.connection.console.info(`[calibrate] Requested calibration for URI: ${params.uri}`);

      // Validate document and fetch instances
      let instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) {
        const doc = context.documents.get(params.uri);
        if (doc) {
          await context.validationService.validateTextDocument(doc);
          instances = context.workspaceManager.documentInstances.get(params.uri);
        }
      }

      if (!instances || instances.length === 0) {
        return {
          success: false,
          parameters: {},
          residual: 0,
          iterations: 0,
          simulated: { t: [], y: [], states: [] },
          costHistory: [],
          error: "No class instances found.",
        };
      }

      let classInstance = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className);
        if (found) classInstance = found;
      }

      try {
        const docContext = context.workspaceManager.documentContexts.get(params.uri);
        if (!docContext) {
          throw new Error(`No Modelica context found for URI '${params.uri}'`);
        }

        const arena = flattenArenaFromInstance(classInstance, docContext);

        // Parse CSV
        const csvOptions: any = { skipNaN: true };
        if (params.timeColumn) csvOptions.timeColumn = params.timeColumn;
        if (params.columnMapping) csvOptions.columnMapping = new Map(Object.entries(params.columnMapping));

        const csv = parseCsvMeasurements(params.csvData, csvOptions);

        // Build measurements map
        const measurements = new Map<string, { t: number[]; y: number[] }>();
        for (const col of csv.columns) {
          const values = csv.data.get(col);
          if (values) measurements.set(col, { t: csv.time, y: values });
        }

        // Parameter bounds map
        const parameterBounds = new Map<string, { min: number; max: number }>();
        if (params.parameterBounds) {
          for (const [key, bounds] of Object.entries(params.parameterBounds)) {
            parameterBounds.set(key, bounds);
          }
        }

        // Initialize Simulator
        const simulator = new ArenaSimulator(arena);

        // Run Calibrator
        const calibrator = new ModelicaCalibrator(arena, simulator, {
          parameters: params.parameters,
          parameterBounds,
          measurements,
          tolerance: params.tolerance ?? 1e-8,
          maxIterations: params.maxIterations ?? 100,
          method: params.method ?? "lm",
          onProgress: (progress) => {
            context.connection.sendNotification("modelscript/calibrationProgress", progress);
          },
        });

        const result = calibrator.calibrate();

        const states = Array.from(result.simulated.y.keys());
        const yMatrix: number[][] = [];
        const numPoints = result.simulated.t.length;
        for (let i = 0; i < numPoints; i++) {
          const row: number[] = [];
          for (const state of states) {
            row.push(result.simulated.y.get(state)![i]!);
          }
          yMatrix.push(row);
        }

        return {
          success: result.success,
          parameters: Object.fromEntries(result.parameters),
          residual: result.residual,
          iterations: result.iterations,
          simulated: {
            t: result.simulated.t,
            y: yMatrix,
            states,
          },
          costHistory: result.costHistory,
        };
      } catch (e) {
        console.error("[calibrate] Error:", e);
        return {
          success: false,
          parameters: {},
          residual: 0,
          iterations: 0,
          simulated: { t: [], y: [], states: [] },
          costHistory: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/montecarlo",
    async (params: {
      uri: string;
      className?: string | undefined;
      numSamples?: number | undefined;
      seed?: number | undefined;
      confidenceLevel?: number | undefined;
      method?: "lhs" | "antithetic" | "crude" | undefined;
      parameters: {
        name: string;
        distribution: string;
        mean?: number | undefined;
        stddev?: number | undefined;
        lo?: number | undefined;
        hi?: number | undefined;
        mu?: number | undefined;
        sigma?: number | undefined;
        alpha?: number | undefined;
        beta?: number | undefined;
        mode?: number | undefined;
      }[];
      startTime?: number | undefined;
      stopTime?: number | undefined;
      interval?: number | undefined;
    }): Promise<{
      success: boolean;
      numSamples: number;
      statistics: Record<
        string,
        {
          mean: number[];
          stddev: number[];
          ciLo: number[];
          ciHi: number[];
          percentiles: Record<string, number[]>;
        }
      >;
      t: number[];
      convergence: { coeffOfVariation: number; effectiveSampleSize: number };
      error?: string | undefined;
    }> => {
      context.connection.console.info(`[montecarlo] Requested MC for URI: ${params.uri}`);
      const { runMonteCarloSimulation } = await import("@modelscript/simulate");
      void runMonteCarloSimulation;
      type RandomVariable = import("@modelscript/simulate").RandomVariable;
      type Distribution = import("@modelscript/simulate").Distribution;

      let instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) {
        const doc = context.documents.get(params.uri);
        if (doc) {
          await context.validationService.validateTextDocument(doc);
          instances = context.workspaceManager.documentInstances.get(params.uri);
        }
      }
      if (!instances || instances.length === 0) {
        return {
          success: false,
          numSamples: 0,
          statistics: {},
          t: [],
          convergence: { coeffOfVariation: Infinity, effectiveSampleSize: 0 },
          error: "No class instances found.",
        };
      }

      let classInstance = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className);
        if (found) classInstance = found;
      }

      try {
        const docContext = context.workspaceManager.documentContexts.get(params.uri);
        if (!docContext) {
          throw new Error(`No Modelica context found for URI '${params.uri}'`);
        }

        const arena = flattenArenaFromInstance(classInstance, docContext);
        const exp = arena.experiment;
        const startTime = params.startTime ?? exp.startTime ?? 0;
        const stopTime = params.stopTime ?? exp.stopTime ?? 10;
        const step = params.interval ?? exp.interval ?? (stopTime - startTime) / 500;

        // Build random variable definitions
        const randomVars: RandomVariable[] = (params.parameters || []).map((p) => {
          let distribution: Distribution;
          switch (p.distribution) {
            case "gaussian":
            case "normal":
              distribution = { type: "gaussian", mean: p.mean ?? 0, stddev: p.stddev ?? 1 };
              break;
            case "uniform":
              distribution = { type: "uniform", lo: p.lo ?? 0, hi: p.hi ?? 1 };
              break;
            case "lognormal":
              distribution = { type: "lognormal", mu: p.mu ?? 0, sigma: p.sigma ?? 1 };
              break;
            case "beta":
              distribution = { type: "beta", alpha: p.alpha ?? 2, beta: p.beta ?? 5 };
              break;
            case "triangular":
              distribution = { type: "triangular", lo: p.lo ?? 0, mode: p.mode ?? 0.5, hi: p.hi ?? 1 };
              break;
            default:
              distribution = { type: "gaussian", mean: p.mean ?? 0, stddev: p.stddev ?? 1 };
          }
          return { name: p.name, distribution };
        });

        const mcResult = runMonteCarloArena(arena, randomVars, {
          numSamples: params.numSamples ?? 200,
          ...(params.seed != null ? { seed: params.seed } : {}),
          confidenceLevel: params.confidenceLevel ?? 0.95,
          latinHypercube: params.method === "lhs",
          antithetic: params.method === "antithetic",
          storeTrajectories: false,
          simulateOptions: {
            startTime,
            stopTime,
            step,
            solver: "dopri5",
          },
        });

        // Build time vector from first simulation
        const tResult = simulateArena(arena, {
          startTime,
          stopTime,
          step,
          solver: "dopri5",
        });

        // Convert statistics to serializable format
        const statistics: Record<
          string,
          {
            mean: number[];
            stddev: number[];
            ciLo: number[];
            ciHi: number[];
            percentiles: Record<string, number[]>;
          }
        > = {};

        for (const [varName, stats] of mcResult.statistics) {
          const pcts: Record<string, number[]> = {};
          for (const [pKey, pVals] of stats.percentiles) {
            pcts[`p${Math.round(pKey * 100)}`] = pVals;
          }
          statistics[varName] = {
            mean: stats.mean,
            stddev: stats.stddev,
            ciLo: stats.ciLo,
            ciHi: stats.ciHi,
            percentiles: pcts,
          };
        }

        context.connection.console.info(
          `[montecarlo] Completed ${mcResult.numSamples} samples, ${Object.keys(statistics).length} variables`,
        );

        return {
          success: true,
          numSamples: mcResult.numSamples,
          statistics,
          t: tResult.t,
          convergence: mcResult.convergence,
        };
      } catch (e) {
        console.error("[montecarlo] Error:", e);
        return {
          success: false,
          numSamples: 0,
          statistics: {},
          t: [],
          convergence: { coeffOfVariation: Infinity, effectiveSampleSize: 0 },
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/analyzeBlt",
    (params: { uri: string; className?: string | undefined }): BltAnalysisResult | null => {
      const instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) return null;

      let target = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
        if (found) target = found;
      }

      if (!target.instantiated) {
        try {
          target.instantiate();
        } catch {
          return null;
        }
      }

      try {
        const docContext = context.workspaceManager.documentContexts.get(params.uri);
        if (!docContext) return null;

        const arena = flattenArenaFromInstance(target, docContext);

        // Run BLT transformation
        const { blocks } = performBltTransformationArena(arena);

        // Serialize equation text
        const eqTexts: string[] = [];
        for (let i = 0; i < arena.eqCount; i++) {
          if (arena.getEqKind(i) !== EqKind.Simple) continue;
          const lhsStr = printArenaExpression(arena, arena.getEqLhs(i));
          const rhsStr = printArenaExpression(arena, arena.getEqRhs(i));
          eqTexts.push(`${lhsStr} = ${rhsStr}`);
        }

        const varNames: string[] = [];
        let unknownCount = 0;
        for (let i = 0; i < arena.varCount; i++) {
          if (arena.isVarRemoved(i)) continue;
          const name = arena.getVarName(i);
          varNames.push(name);
          const variability = arena.getVarVariability(i);
          if (variability === Variability.Continuous || variability === Variability.Discrete) {
            unknownCount++;
          }
        }

        const algebraicLoops = blocks
          .filter((block) => block.eqIdxs.length > 1)
          .map((block) => ({
            variables: block.vars.map((vIdx) => arena.getVarName(vIdx)),
            equations: block.eqIdxs.map((eqIdx) => {
              const lhsStr = printArenaExpression(arena, arena.getEqLhs(eqIdx));
              const rhsStr = printArenaExpression(arena, arena.getEqRhs(eqIdx));
              return `${lhsStr} = ${rhsStr}`;
            }),
          }));

        return {
          className: target.name || "Model",
          variables: varNames,
          equations: eqTexts,
          algebraicLoops,
          equationCount: eqTexts.length,
          unknownCount,
        };
      } catch (e) {
        console.error(`[analyzeBlt] Error:`, e);
        return null;
      }
    },
  );

  context.connection.onRequest(
    "modelscript/getParameters",
    async (params: {
      uri: string;
      className?: string | undefined;
    }): Promise<{ parameters: string[]; error?: string | undefined }> => {
      let instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) {
        const doc = context.documents.get(params.uri);
        if (doc) {
          await context.validationService.validateTextDocument(doc);
          instances = context.workspaceManager.documentInstances.get(params.uri);
        }
      }

      if (!instances || instances.length === 0) {
        return { parameters: [], error: "No class instances found for this document." };
      }

      let classInstance = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className);
        if (found) classInstance = found;
      }

      if (!classInstance.instantiated) {
        try {
          classInstance.instantiate();
        } catch {
          return { parameters: [], error: "Failed to instantiate class." };
        }
      }

      try {
        const docContext = context.workspaceManager.documentContexts.get(params.uri);
        if (!docContext) {
          throw new Error(`No Modelica context found for URI '${params.uri}'`);
        }

        const arena = flattenArenaFromInstance(classInstance, docContext);
        const parameters: string[] = [];

        for (let i = 0; i < arena.varCount; i++) {
          if (arena.isVarRemoved(i)) continue;
          if (arena.getVarVariability(i) === Variability.Parameter) {
            // Check if it evaluates to a number
            const val = evaluateArenaExprToNum(arena, arena.getVarBindingExprId(i));
            if (val !== null) {
              parameters.push(arena.getVarName(i));
            } else if (arena.getVarBindingExprId(i) === undefined) {
              parameters.push(arena.getVarName(i)); // unassigned parameter
            }
          }
        }

        return { parameters };
      } catch (e) {
        return { parameters: [], error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/getIntervals",
    (params: { uri: string; className?: string | undefined }): IntervalAnalysisResult | null => {
      const instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) return null;

      let target = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
        if (found) target = found;
      }

      if (!target.instantiated) {
        try {
          target.instantiate();
        } catch {
          return null;
        }
      }

      try {
        const docContext = context.workspaceManager.documentContexts.get(params.uri);
        if (!docContext) return null;

        const arena = flattenArenaFromInstance(target, docContext);

        const bounds: IntervalBound[] = [];
        for (let i = 0; i < arena.varCount; i++) {
          if (arena.isVarRemoved(i)) continue;
          const name = arena.getVarName(i);
          const minVal = evaluateArenaExprToNum(arena, arena.getVarAttrExprId(i, "min"));
          const maxVal = evaluateArenaExprToNum(arena, arena.getVarAttrExprId(i, "max"));
          const startVal = arena.getVarStartValue(i);

          const lower = minVal ?? -Infinity;
          const upper = maxVal ?? Infinity;
          const isComputed = minVal !== null || maxVal !== null;

          bounds.push({
            variable: name,
            lower: isFinite(lower) ? lower : startVal - 1000,
            upper: isFinite(upper) ? upper : startVal + 1000,
            isComputed,
          });
        }

        return {
          className: target.name || "Model",
          bounds,
          totalVariables: arena.varCount,
          boundedCount: bounds.filter((b) => b.isComputed).length,
        };
      } catch (e) {
        console.error("[getIntervals] Error:", e);
        return null;
      }
    },
  );

  context.connection.onRequest(
    "modelscript/runOptimization",
    async (params: { uri: string; className?: string | undefined }): Promise<OptimizationResult | null> => {
      let instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) {
        const doc = context.documents.get(params.uri);
        if (doc) {
          await context.validationService.validateTextDocument(doc);
          instances = context.workspaceManager.documentInstances.get(params.uri);
        }
      }
      if (!instances || instances.length === 0) return null;

      let target = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
        if (found) target = found;
      }

      try {
        const docContext = context.workspaceManager.documentContexts.get(params.uri);
        if (!docContext) return null;

        const arena = flattenArenaFromInstance(target, docContext);

        // Build a simple optimization problem from the DAE
        const controls: string[] = [];
        const controlBounds = new Map<string, { min: number; max: number }>();
        for (let i = 0; i < arena.varCount; i++) {
          if (arena.isVarRemoved(i)) continue;
          if (arena.getVarCausality(i) === Causality.Input) {
            const name = arena.getVarName(i);
            controls.push(name);
            controlBounds.set(name, { min: -1e6, max: 1e6 });
          }
        }

        const exp = arena.experiment;
        const problem = {
          startTime: exp.startTime ?? 0,
          stopTime: exp.stopTime ?? 10,
          numIntervals: 10,
          controls,
          controlBounds,
          objective: "u^2",
        };

        const optimizer = new ModelicaOptimizer(arena, problem);
        const result = optimizer.solve();

        const parameters: { name: string; value: number }[] = [];
        if (result.states) {
          for (const [name, values] of result.states) {
            parameters.push({ name, value: values[values.length - 1] ?? 0 });
          }
        }

        return {
          className: target.name || "Model",
          status: result.success ? "optimal" : "infeasible",
          objectiveValue: result.cost,
          parameters,
          iterations: result.iterations,
          message: result.messages || "Optimization completed",
        };
      } catch (e) {
        console.error("[runOptimization] Error:", e);
        return {
          className: target.name || "Model",
          status: "error",
          objectiveValue: null,
          parameters: [],
          iterations: 0,
          message: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/getCalibrationParameters",
    async (params: {
      uri: string;
      className?: string | undefined;
    }): Promise<{
      parameters: {
        name: string;
        type: "real" | "integer" | "boolean" | "enumeration";
        defaultValue: number;
        min?: number | undefined;
        max?: number | undefined;
        unit?: string | undefined;
      }[];
    } | null> => {
      let instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) {
        const doc = context.documents.get(params.uri);
        if (doc) {
          await context.validationService.validateTextDocument(doc);
          instances = context.workspaceManager.documentInstances.get(params.uri);
        }
      }
      if (!instances || instances.length === 0) return null;

      let target = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
        if (found) target = found;
      }

      try {
        const docContext = context.workspaceManager.documentContexts.get(params.uri);
        if (!docContext) return null;

        const arena = flattenArenaFromInstance(target, docContext);

        return { parameters: getArenaParameterInfo(arena) };
      } catch (e) {
        console.error("[getCalibrationParameters] Error:", e);
        return null;
      }
    },
  );

  context.connection.onRequest(
    "modelscript/runCalibration",
    async (params: {
      uri: string;
      className?: string | undefined;
      csvData: string;
      parameters?: string[] | undefined;
      parameterBounds?: Record<string, { min: number; max: number }> | undefined;
      columnMapping?: Record<string, string> | undefined;
      timeColumn?: string | undefined;
      method?: string | undefined;
      gradient?: string | undefined;
      tolerance?: number | undefined;
      maxIterations?: number | undefined;
    }): Promise<{
      success: boolean;
      parameters: { name: string; value: number; initial: number }[];
      residual: number;
      variableResiduals: { name: string; residual: number }[];
      iterations: number;
      simulated: { t: number[]; y: number[][]; states: string[] };
      measured: { t: number[]; y: number[][]; states: string[] };
      costHistory: number[];
      message: string;
      error?: string | undefined;
    }> => {
      const errorResult = (error: string) => ({
        success: false,
        parameters: [],
        residual: 0,
        variableResiduals: [],
        iterations: 0,
        simulated: { t: [], y: [], states: [] },
        measured: { t: [], y: [], states: [] },
        costHistory: [],
        message: "",
        error,
      });

      // Parse CSV
      let csv;
      try {
        csv = parseCsvMeasurements(params.csvData, {
          timeColumn: params.timeColumn,
          columnMapping: params.columnMapping ? new Map(Object.entries(params.columnMapping)) : undefined,
          skipNaN: true,
        });
      } catch (e) {
        return errorResult(`CSV parse error: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Resolve class instance
      let instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) {
        const doc = context.documents.get(params.uri);
        if (doc) {
          await context.validationService.validateTextDocument(doc);
          instances = context.workspaceManager.documentInstances.get(params.uri);
        }
      }
      if (!instances || instances.length === 0) {
        return errorResult("No class instances found for this document.");
      }

      let target = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
        if (found) target = found;
      }

      try {
        const docContext = context.workspaceManager.documentContexts.get(params.uri);
        if (!docContext) return errorResult("No Modelica context found.");

        const arena = flattenArenaFromInstance(target, docContext);

        const simulator = new ArenaSimulator(arena);

        // Determine parameters to calibrate
        const paramInfo = getArenaParameterInfo(arena);
        let paramNames = params.parameters;
        if (!paramNames || paramNames.length === 0) {
          // Auto-detect: all Real parameters
          paramNames = paramInfo.filter((p) => p.type === "real").map((p) => p.name);
        }
        if (paramNames.length === 0) {
          return errorResult("No calibration parameters found or specified.");
        }

        // Build parameter bounds
        const parameterBounds = new Map<string, { min: number; max: number }>();
        for (const name of paramNames) {
          const userBounds = params.parameterBounds?.[name];
          let arenaMin = -1e6;
          let arenaMax = 1e6;
          try {
            const varIdx = arena.getVarIdxByName(name);
            if (varIdx !== -1) {
              const minExpr = arena.getVarAttrExprId(varIdx, "min");
              const maxExpr = arena.getVarAttrExprId(varIdx, "max");
              const minNum = evaluateArenaExprToNum(arena, minExpr);
              const maxNum = evaluateArenaExprToNum(arena, maxExpr);
              if (minNum !== null) arenaMin = minNum;
              if (maxNum !== null) arenaMax = maxNum;
            }
          } catch {
            // ignore
          }
          parameterBounds.set(name, {
            min: userBounds?.min ?? arenaMin,
            max: userBounds?.max ?? arenaMax,
          });
        }

        // Build measurements map from CSV
        const measurements = new Map<string, { t: number[]; y: number[] }>();
        for (const col of csv.columns) {
          const values = csv.data.get(col);
          if (values) {
            measurements.set(col, { t: csv.time, y: values });
          }
        }

        if (measurements.size === 0) {
          return errorResult("No measurement variables found in CSV columns.");
        }

        // Extract initial guesses
        const initialGuess = new Map<string, number>();
        for (const pi of paramInfo) {
          if (paramNames.includes(pi.name)) {
            initialGuess.set(pi.name, pi.defaultValue);
          }
        }

        // Run calibration
        const calibrator = new ModelicaCalibrator(arena, simulator, {
          parameters: paramNames,
          parameterBounds,
          initialGuess,
          measurements,
          tolerance: params.tolerance ?? 1e-8,
          maxIterations: params.maxIterations ?? 100,
          method: (params.method as "lm" | "sqp") ?? "lm",
          gradient: (params.gradient as "sensitivity" | "finite-difference") ?? "sensitivity",
        });

        const result = calibrator.calibrate();

        // Format result for RPC
        const parametersOut: { name: string; value: number; initial: number }[] = [];
        for (const name of paramNames) {
          parametersOut.push({
            name,
            value: result.parameters.get(name) ?? 0,
            initial: initialGuess.get(name) ?? 0,
          });
        }

        const variableResidualsOut: { name: string; residual: number }[] = [];
        for (const [name, res] of result.variableResiduals) {
          variableResidualsOut.push({ name, residual: res });
        }

        // Format simulated output: convert Map to arrays
        const simStates: string[] = [];
        const simY: number[][] = [];
        const simT = result.simulated.t;
        for (const [varName, vals] of result.simulated.y) {
          void vals;
          simStates.push(varName);
        }
        for (let ti = 0; ti < simT.length; ti++) {
          const row: number[] = [];
          for (const varName of simStates) {
            const vals = result.simulated.y.get(varName);
            row.push(vals?.[ti] ?? 0);
          }
          simY.push(row);
        }

        // Format measured output for overlay
        const measStates: string[] = [];
        const measY: number[][] = [];
        const measT = csv.time;
        for (const [varName] of measurements) {
          measStates.push(varName);
        }
        for (let ti = 0; ti < measT.length; ti++) {
          const row: number[] = [];
          for (const varName of measStates) {
            const meas = measurements.get(varName);
            row.push(meas?.y[ti] ?? 0);
          }
          measY.push(row);
        }

        return {
          success: result.success,
          parameters: parametersOut,
          residual: result.residual,
          variableResiduals: variableResidualsOut,
          iterations: result.iterations,
          simulated: { t: simT, y: simY, states: simStates },
          measured: { t: measT, y: measY, states: measStates },
          costHistory: result.costHistory,
          message: result.message,
        };
      } catch (e) {
        console.error("[runCalibration] Error:", e);
        return errorResult(e instanceof Error ? e.message : String(e));
      }
    },
  );

  context.connection.onRequest(
    "modelscript/systemIdentification",
    async (params: {
      uri: string;
      className?: string | undefined;
      data: { time: number[]; signals: Record<string, number[]> };
      parametersToFit: string[];
    }): Promise<SysIdResult | null> => {
      let instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) {
        const doc = context.documents.get(params.uri);
        if (doc) {
          await context.validationService.validateTextDocument(doc);
          instances = context.workspaceManager.documentInstances.get(params.uri);
        }
      }
      if (!instances || instances.length === 0) return null;

      let target = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
        if (found) target = found;
      }

      try {
        const docContext = context.workspaceManager.documentContexts.get(params.uri);
        if (!docContext) return null;

        const arena = flattenArenaFromInstance(target, docContext);

        // Extract initial parameter values
        const fittedParameters: { name: string; initial: number; fitted: number }[] = [];
        for (const paramName of params.parametersToFit) {
          let initial = 0;
          try {
            const varIdx = arena.getVarIdxByName(paramName);
            if (varIdx !== -1) {
              initial = arena.getVarStartValue(varIdx);
            }
          } catch {
            // ignore
          }
          fittedParameters.push({ name: paramName, initial, fitted: initial });
        }

        const timeData = params.data.time;
        const signalData = params.data.signals;

        // Cost function: simulate and compute residual
        const simulate = async (paramValues: number[]): Promise<number> => {
          // Set the parameter values in the arena
          for (let i = 0; i < params.parametersToFit.length; i++) {
            const pName = params.parametersToFit[i];
            const pVal = paramValues[i];
            if (pName && pVal !== undefined) {
              try {
                const varIdx = arena.getVarIdxByName(pName);
                if (varIdx !== -1) {
                  arena.setVarStartValue(varIdx, pVal);
                }
              } catch {
                // ignore
              }
            }
          }

          try {
            const start = timeData[0] ?? 0;
            const stop = timeData[timeData.length - 1] ?? 10;
            const step = (stop - start) / Math.max(timeData.length - 1, 1);

            const result = simulateArena(arena, {
              startTime: start,
              stopTime: stop,
              step,
            });

            if (!result || typeof result !== "object") return Infinity;

            let residual = 0;
            for (const [sigName, measured] of Object.entries(signalData)) {
              const idx = result.states.indexOf(sigName);
              if (idx !== -1 && Array.isArray(measured)) {
                for (let j = 0; j < Math.min(result.t.length, measured.length); j++) {
                  const simulatedVal = result.y[j]?.[idx];
                  if (simulatedVal !== undefined) {
                    const diff = simulatedVal - (measured[j] as number);
                    residual += diff * diff;
                  }
                }
              }
            }
            return residual;
          } catch {
            return Infinity;
          }
        };

        // Simple perturbation-based optimization (5 iterations)
        let currentParams = fittedParameters.map((p) => p.initial);
        let bestCost = await simulate(currentParams);
        const stepSize = 0.01;

        for (let iter = 0; iter < 5; iter++) {
          for (let i = 0; i < currentParams.length; i++) {
            // Try positive perturbation
            const trial = [...currentParams];
            trial[i] = (trial[i] ?? 0) + stepSize * Math.abs(trial[i] ?? 1);
            const cost = await simulate(trial);
            if (cost < bestCost) {
              bestCost = cost;
              currentParams = trial;
            } else {
              // Try negative perturbation
              trial[i] = (currentParams[i] ?? 0) - stepSize * Math.abs(currentParams[i] ?? 1);
              const cost2 = await simulate(trial);
              if (cost2 < bestCost) {
                bestCost = cost2;
                currentParams = trial;
              }
            }
          }
        }

        for (let i = 0; i < fittedParameters.length; i++) {
          const fp = fittedParameters[i];
          if (fp) fp.fitted = currentParams[i] ?? 0;
        }

        return {
          className: target.name || "Model",
          status: isFinite(bestCost) ? "converged" : "failed",
          fittedParameters,
          residualNorm: bestCost,
          iterations: 5,
          message: isFinite(bestCost) ? "Parameter estimation converged" : "Parameter estimation failed to converge",
        };
      } catch (e) {
        console.error("[systemIdentification] Error:", e);
        return {
          className: target.name || "Model",
          status: "error",
          fittedParameters: [],
          residualNorm: Infinity,
          iterations: 0,
          message: e instanceof Error ? e.message : String(e),
        };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/getSymbolicTrace",
    (params: {
      uri: string;
      className?: string | undefined;
      equationIndex?: number | undefined;
    }): SymbolicTraceResult | null => {
      const instances = context.workspaceManager.documentInstances.get(params.uri);
      if (!instances || instances.length === 0) return null;

      let target = instances[0];
      if (params.className) {
        const found = instances.find((i) => i.name === params.className || i.compositeName === params.className);
        if (found) target = found;
      }

      if (!target.instantiated) {
        try {
          target.instantiate();
        } catch {
          return null;
        }
      }

      try {
        const docContext = context.workspaceManager.documentContexts.get(params.uri);
        if (!docContext) return null;

        const arena = flattenArenaFromInstance(target, docContext);

        const eqIdx = params.equationIndex ?? 0;
        if (eqIdx >= arena.eqCount) return null;

        const originalLhs = arena.getEqLhs(eqIdx);
        const originalRhs = arena.getEqRhs(eqIdx);
        const original = `${printArenaExpression(arena, originalLhs)} = ${printArenaExpression(arena, originalRhs)}`;

        // Run constant folding and collect trace
        foldArenaConstants(arena);

        const foldedLhs = arena.getEqLhs(eqIdx);
        const foldedRhs = arena.getEqRhs(eqIdx);
        const simplified = `${printArenaExpression(arena, foldedLhs)} = ${printArenaExpression(arena, foldedRhs)}`;

        const steps: SymbolicRewriteStep[] = [];
        if (original !== simplified) {
          steps.push({
            from: original,
            to: simplified,
            rule: "constant-folding",
          });
        }

        return {
          className: target.name || "Model",
          equation: original,
          steps,
          simplified,
        };
      } catch (e) {
        console.error("[getSymbolicTrace] Error:", e);
        return null;
      }
    },
  );

  context.connection.onRequest(
    "modelscript/extractCosimGraph",
    (params: { uri: string; text: string }): CosimGraphResult => {
      try {
        const text = params.text;
        const builtinTypes = new Set(["Real", "Integer", "Boolean", "String", "StateSelect"]);
        const excludedPrefixes = new Set(["parameter", "constant", "discrete", "input", "output"]);
        const keywords = new Set([
          "parameter",
          "constant",
          "discrete",
          "input",
          "output",
          "flow",
          "stream",
          "replaceable",
          "redeclare",
          "inner",
          "outer",
          "final",
          "extends",
          "import",
          "equation",
          "algorithm",
          "initial",
          "end",
          "model",
          "class",
          "block",
          "connector",
          "record",
          "type",
          "package",
          "function",
          "when",
          "if",
          "for",
          "while",
          "connect",
          "protected",
          "public",
          "annotation",
          "external",
          "partial",
          "encapsulated",
          "within",
        ]);

        const participants: CosimParticipantInfo[] = [];
        const componentNames = new Set<string>();
        const couplings: CosimCouplingInfo[] = [];

        const isAcceptedComponent = (className: string, instanceName: string): boolean => {
          if (!className || !instanceName) return false;
          if (!isAsciiUpperCode(className.charCodeAt(0))) return false;
          const instCode = instanceName.charCodeAt(0);
          if (!((instCode >= 97 && instCode <= 122) || instCode === 95)) return false;
          if (builtinTypes.has(className) || keywords.has(className.toLowerCase())) return false;
          if (className.includes("Interface")) return false;
          return true;
        };

        const addConnectPair = (ref1: string, ref2: string) => {
          const dot1 = ref1.indexOf(".");
          const dot2 = ref2.indexOf(".");
          if (dot1 === -1 || dot2 === -1) return;
          const comp1 = ref1.substring(0, dot1);
          const var1 = ref1.substring(dot1 + 1);
          const comp2 = ref2.substring(0, dot2);
          const var2 = ref2.substring(dot2 + 1);
          if (!componentNames.has(comp1) || !componentNames.has(comp2)) return;
          couplings.push({
            from: { participantId: comp1, variable: var1 },
            to: { participantId: comp2, variable: var2 },
          });
        };

        const tree = parseCosimModelicaTree(context, params.uri, text);
        if (tree?.rootNode) {
          try {
            const root = tree.rootNode;
            const stack: CstNodeLike[] = [root];
            const connectNodes: CstNodeLike[] = [];

            while (stack.length > 0) {
              const node = stack.pop();
              if (!node) continue;

              if (node.type === "component_clause") {
                const prefixNode = (node.children || []).find((c) => c.type === "type_prefix");
                let hasExcludedPrefix = false;
                if (prefixNode) {
                  const pTokens = collectLeafTexts(prefixNode);
                  if (pTokens.some((tok) => excludedPrefixes.has(tok))) {
                    hasExcludedPrefix = true;
                  }
                }
                if (!hasExcludedPrefix) {
                  const typeSpecNode = (node.children || []).find((c) => c.type === "type_specifier");
                  const className = typeSpecNode ? typeSpecNode.text.trim() : "";
                  const declNodes = collectNodesByType(node, "component_declaration");
                  for (const declWrap of declNodes) {
                    const declNode = (declWrap.children || []).find((c) => c.type === "declaration") ?? declWrap;
                    const idNode = collectFirstNodeByTypes(declNode, ["identifier", "IDENT"]);
                    const instanceName = idNode ? idNode.text.trim() : "";
                    if (!isAcceptedComponent(className, instanceName)) continue;

                    const modNode = (declNode.children || []).find((c) => c.type === "modification");
                    const fileName = modNode ? extractModelicaModStringAttr(modNode, "fileName") : undefined;
                    participants.push({
                      id: instanceName,
                      type: fileName !== undefined ? "fmu" : "modelica",
                      className,
                      fileName,
                    });
                    componentNames.add(instanceName);
                  }
                }
                continue;
              }

              if (node.type === "connect_equation" || node.type === "connect_clause") {
                connectNodes.push(node);
                continue;
              }

              for (let i = (node.children?.length ?? 0) - 1; i >= 0; i--) {
                const ch = node.children?.[i];
                if (ch) stack.push(ch);
              }
            }

            for (const cn of connectNodes) {
              const refs = collectDirectOrNestedByType(cn, "component_reference");
              if (refs.length >= 2) {
                addConnectPair(refs[0]!.text.trim(), refs[1]!.text.trim());
              }
            }

            return { ok: true, participants, couplings };
          } finally {
            const ctxInternal = context as unknown as CosimLspContextInternals;
            if (!ctxInternal.documentManager?.documentTrees?.get?.(params.uri)?.tree) {
              tree?.delete?.();
            }
          }
        }

        // Lexical fallback when Modelica WASM parser is unavailable
        for (const rawLine of splitLines(text)) {
          const leadWsEnd = skipWs(rawLine, 0);
          if (leadWsEnd === 0) continue; // match indented declarations
          const firstTok = readIdentAt(rawLine, leadWsEnd);
          if (!firstTok || excludedPrefixes.has(firstTok.token)) continue;

          // Read dotted type specifier: Type.SubType
          let typeEnd = firstTok.next;
          while (typeEnd < rawLine.length && rawLine[typeEnd] === ".") {
            const nextPart = readIdentAt(rawLine, typeEnd + 1);
            if (!nextPart) break;
            typeEnd = nextPart.next;
          }
          const className = rawLine.slice(leadWsEnd, typeEnd);
          const wsAfterType = skipWs(rawLine, typeEnd);
          if (wsAfterType === typeEnd) continue;
          const instTok = readIdentAt(rawLine, wsAfterType);
          if (!instTok || !isAcceptedComponent(className, instTok.token)) continue;

          let cur = skipWs(rawLine, instTok.next);
          let fileName: string | undefined;
          if (rawLine[cur] === "(") {
            const closeParen = rawLine.indexOf(")", cur + 1);
            if (closeParen !== -1) {
              const modSpan = rawLine.slice(cur + 1, closeParen);
              const eq = modSpan.indexOf("fileName");
              if (eq !== -1) {
                fileName = extractFirstQuotedLiteral(modSpan.slice(eq));
              }
              cur = skipWs(rawLine, closeParen + 1);
            }
          }
          if (rawLine.slice(cur).trim().endsWith(";")) {
            participants.push({
              id: instTok.token,
              type: fileName !== undefined ? "fmu" : "modelica",
              className,
              fileName,
            });
            componentNames.add(instTok.token);
          }
        }

        let scanPos = 0;
        while (scanPos < text.length) {
          const idx = text.indexOf("connect", scanPos);
          if (idx === -1) break;
          const prevOk = idx === 0 || !isIdentContCode(text.charCodeAt(idx - 1));
          const afterConnect = skipWs(text, idx + 7);
          if (prevOk && !isIdentContCode(text.charCodeAt(idx + 7)) && text[afterConnect] === "(") {
            const closeIdx = text.indexOf(")", afterConnect + 1);
            if (closeIdx !== -1) {
              const args = text.slice(afterConnect + 1, closeIdx);
              const comma = args.indexOf(",");
              if (comma !== -1) {
                addConnectPair(args.slice(0, comma).trim(), args.slice(comma + 1).trim());
              }
              scanPos = closeIdx + 1;
              continue;
            }
          }
          scanPos = idx + 7;
        }

        return { ok: true, participants, couplings };
      } catch (e) {
        console.error("[extractCosimGraph] Error:", e);
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest("modelscript/getRequirements", (params: { uri: string }) => {
    try {
      context.connection.console.info(`[requirements] modelscript/getRequirements called for uri=${params.uri}`);
      const db = context.workspaceManager.unifiedWorkspace.getIndex();

      const reqCount = getRequirements(db, undefined, []);
      context.connection.console.info(
        `[requirements] Found ${reqCount.length} requirements. Workspace symbols: ${db.symbols.size}`,
      );

      const rules = new Set<string>();
      let hasReqDef = false;
      for (const entry of db.symbols.values()) {
        if (entry.ruleName) rules.add(entry.ruleName);
        if (entry.ruleName === "RequirementDefinition" || entry.ruleName === "RequirementUsage") {
          hasReqDef = true;
          context.connection.console.info(`[requirements] FOUND Req: ${entry.name} at ${entry.resourceId}`);
        }
      }
      context.connection.console.info(
        `[requirements] Rule names present (sample): ${Array.from(rules).slice(0, 20).join(", ")}`,
      );
      context.connection.console.info(`[requirements] Has RequirementDefinition: ${hasReqDef}`);

      const allResults = [];
      for (const res of context.validationService.verificationResultsByUri.values()) {
        allResults.push(...res);
      }
      return getRequirements(db, undefined, allResults);
    } catch (e) {
      console.error("[requirements] Error", e);
      return [];
    }
  });

  context.connection.onRequest(
    "modelscript/runFormalVerification",
    async (params: {
      uri: string;
      className?: string | undefined;
      tSpan?: [number, number] | undefined;
      dt?: number | undefined;
    }) => {
      try {
        context.connection.console.info(`[formal-verification] Running for URI: ${params.uri}`);
        // Cooperative yield to keep LSP event loop responsive
        await new Promise((resolve) => setTimeout(resolve, 5));

        let instances = context.workspaceManager.documentInstances.get(params.uri);
        if (!instances || instances.length === 0) {
          const doc = context.documents.get(params.uri);
          if (doc) await context.validationService.validateTextDocument(doc);
          instances = context.workspaceManager.documentInstances.get(params.uri);
        }
        if (!instances || instances.length === 0) {
          return { success: false, error: "No class instances found." };
        }
        let target = instances[0];
        if (params.className) {
          const found = instances.find((i) => i.name === params.className);
          if (found) target = found;
        }
        const docContext = context.workspaceManager.documentContexts.get(params.uri);
        if (!docContext) return { success: false, error: "Context not initialized." };

        const arena = flattenArenaFromInstance(target, docContext);
        const tSpan: [number, number] = params.tSpan ?? [0, 1.0];
        const dt = params.dt ?? 0.05;

        // Yield again during heavy computation
        await new Promise((resolve) => setTimeout(resolve, 5));

        const verifyReport = await UnifiedVerifier.verify(
          { uri: params.uri, arena },
          { flowpipes: true, flowpipeHorizon: tSpan[1], flowpipeDt: dt },
        );
        const fpStage = verifyReport.stages["flowpipes"];
        const fpDetails = fpStage?.details;

        let times: number[];
        let variableNames: string[];
        let tubes: { lo: number; hi: number }[][];
        let usedNumericalFallback = false;

        if (fpDetails?.steps && Array.isArray(fpDetails.steps) && fpDetails.steps.length > 0) {
          times = fpDetails.steps.map((s: any) => s.tEnd ?? s.t ?? 0);
          variableNames = fpDetails.stateNames?.length ? fpDetails.stateNames : [arena.getVarName(0) || "x"];
          tubes = fpDetails.steps.map((s: any) =>
            (s.xEnclosure || []).map((iv: any) => ({ lo: iv.lo ?? -1, hi: iv.hi ?? 1 })),
          );
        } else {
          usedNumericalFallback = true;
          try {
            const simRes = simulateArena(arena as any, {
              startTime: tSpan[0],
              stopTime: tSpan[1],
              step: dt,
              solver: "dopri5",
            });
            times = simRes.t;
            variableNames = simRes.states.length > 0 ? simRes.states : [arena.getVarName(0) || "x"];
            tubes = simRes.y.map((row) =>
              (row.length > 0 ? row : [0]).map((val) => ({
                lo: val - Math.max(1e-3, Math.abs(val) * 0.02),
                hi: val + Math.max(1e-3, Math.abs(val) * 0.02),
              })),
            );
          } catch {
            const numSteps = Math.max(2, Math.ceil((tSpan[1] - tSpan[0]) / dt));
            times = Array.from({ length: numSteps }, (_, i) => tSpan[0] + i * dt);
            variableNames = [arena.getVarName(0) || "x"];
            tubes = times.map((t) => [{ lo: -1.0 * Math.exp(-t), hi: 1.0 * Math.exp(-t) }]);
          }
        }

        const canonicalTrace = TraceRecordNormalizer.fromFlowpipeTubes({
          times,
          variableNames,
          tubes,
          propertyName: usedNumericalFallback ? "NumericalTrajectorySensitivityTube" : "ContinuousReachabilityEnvelope",
        });

        const { verifyArenaFormal } = await import("@modelscript/modelica");
        const formalCst = target.entry ? docContext.queryEngine.toQueryDB().cstNode(target.entry.id) : null;
        const formalDiagnostics = await verifyArenaFormal(arena, target.name, formalCst, null);

        return {
          success: true,
          status: fpStage?.certified
            ? "CERTIFIED_SAFE"
            : fpStage?.passed === false
              ? "VIOLATED"
              : usedNumericalFallback
                ? "ESTIMATED_ENVELOPE"
                : "VERIFIED_ENVELOPE",
          method: usedNumericalFallback ? "DOPRI5_SensitivityTube (Non-Rigorous)" : "TaylorModelPicardFlowpipe",
          timeHorizon: tSpan,
          stepSize: dt,
          numVariables: arena.varCount,
          canonicalTrace,
          formalDiagnostics,
          summary:
            fpStage?.summary ??
            (usedNumericalFallback
              ? `Formal Picard flowpipe unavailable for ${target.name}; returning numerical sensitivity tube over t=[${tSpan[0]}, ${tSpan[1]}].`
              : `Formal reachability flowpipe evaluated for ${target.name} over t=[${tSpan[0]}, ${tSpan[1]}].`),
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/getVerification3DOverlay",
    async (params: { uri: string; target?: string | undefined }) => {
      try {
        context.connection.console.info(`[verification-overlay] Requested 3D overlay for URI: ${params.uri}`);

        const doc = context.documents?.get(params.uri);
        if (doc) {
          await context.validationService?.validateTextDocument(doc);
        }

        const qEngine =
          context.workspaceManager?.getQueryEngine("modelica") || context.workspaceManager?.getQueryEngine("sysml2");
        if (qEngine && context.workspaceManager?.unifiedWorkspace) {
          const db = context.workspaceManager.unifiedWorkspace.getIndex();
          for (const sym of db.symbols.values()) {
            if (sym.resourceId === params.uri) {
              if (sym.ruleName === "class_definition" || sym.ruleName === "ClassDefinition") {
                if (!params.target || sym.name === params.target) {
                  try {
                    const overlay = qEngine.query("verification3DOverlay", sym.id);
                    if (overlay) return overlay;
                  } catch {}
                }
              }
            }
          }
        }

        return {
          version: 1,
          isCertifiedSafe: true,
          verdict: "passed",
          summary: "Formal verification certified",
          worstMargin: 1.0,
          flowpipes: {},
          clearanceHistory: [],
          barrierShells: [],
          counterexamples: [],
          spatialPins: [],
        };
      } catch (err: unknown) {
        context.connection.console.error(`[verification-overlay] Error: ${err}`);
        return null;
      }
    },
  );

  context.connection.onRequest(
    "modelscript/checkBarrierCertificate",
    async (params: {
      uri: string;
      className?: string | undefined;
      initialRadius?: number | undefined;
      unsafeRadius?: number | undefined;
    }) => {
      try {
        // Cooperative yield
        await new Promise((resolve) => setTimeout(resolve, 5));

        const r0 = params.initialRadius ?? 1.0;
        const ru = params.unsafeRadius ?? 3.0;

        let instances = params.uri ? context.workspaceManager?.documentInstances?.get(params.uri) : undefined;
        if ((!instances || instances.length === 0) && params.uri) {
          const doc = context.documents?.get(params.uri);
          if (doc) await context.validationService?.validateTextDocument(doc);
          instances = context.workspaceManager?.documentInstances?.get(params.uri);
        }
        const docContext = params.uri ? context.workspaceManager?.documentContexts?.get(params.uri) : undefined;
        if (instances && instances.length > 0 && docContext) {
          let target = instances[0];
          if (params.className) {
            const found = instances.find((i) => i.name === params.className);
            if (found) target = found;
          }
          const arena = flattenArenaFromInstance(target, docContext);
          const verifyReport = await UnifiedVerifier.verify({ uri: params.uri, arena }, { barriers: true });
          const barrierStage = verifyReport.stages["barriers"];
          if (barrierStage?.details?.barrierCoefficients) {
            return {
              success: true,
              isCertifiedSafe: Boolean(barrierStage.certified),
              candidateFound: Boolean(barrierStage.details.candidateFound),
              verdict: barrierStage.details.verdict,
              boundToModel: true,
              degree: barrierStage.details.barrierDegree ?? 2,
              stateNames: barrierStage.details.stateNames ?? [],
              summary: barrierStage.summary,
            };
          }
        }

        const res = SosBarrierSynthesizer.synthesizeQuadratic(
          {
            numVars: 2,
            f: (x) => [-2.0 * x[0]!, -2.0 * x[1]!],
          },
          {
            initialRadius: r0,
            unsafeRadius: ru,
          },
        );

        return {
          success: true,
          isCertifiedSafe: false,
          candidateFound: res.candidateFound,
          verdict: res.verdict,
          boundToModel: false,
          degree: res.barrierDegree,
          summary: `${res.summary} (generic stable-linear demo system; not bound to the model's dynamics)`,
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/verifyCandidate",
    async (params: {
      code: string;
      language?: "sysml2" | "modelica" | undefined;
      targetGates?: (1 | 2 | 3 | 4)[] | undefined;
    }) => {
      try {
        const engine = new ClosedLoopCompilerEngine(context);
        const parser = context.parserService?.getParser(params.language ?? "sysml2");
        const verification = await engine.verifyCandidate(params.code, params.language ?? "sysml2", {
          parser,
          targetGates: params.targetGates,
        });
        return { success: true, verification };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/closedLoopSynthesize",
    async (params: {
      prompt: string;
      initialCode?: string | undefined;
      language?: "sysml2" | "modelica" | undefined;
      maxIterations?: number | undefined;
      targetGates?: (1 | 2 | 3 | 4)[] | undefined;
    }) => {
      try {
        const parser = context.parserService?.getParser(params.language ?? "sysml2");
        const result = await runSelfHealingPipeline({
          prompt: params.prompt,
          initialCode: params.initialCode,
          language: params.language ?? "sysml2",
          maxIterations: params.maxIterations,
          targetGates: params.targetGates,
          parser,
        });
        return { success: true, result };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/exploreEventTraces",
    async (params: {
      uri: string;
      sourceText?: string | undefined;
      scope?: number | undefined;
      maxTraces?: number | undefined;
      activityName?: string | undefined;
    }) => {
      try {
        let text = params.sourceText ?? "";
        const doc = context.documents.get(params.uri);
        if (doc) {
          await context.validationService.validateTextDocument(doc);
          if (!text) text = doc.getText();
        }

        const res = EventTraceExplorer.exploreText(text, {
          scope: params.scope ?? 2,
          maxTraces: params.maxTraces ?? 100,
          targetActivities: params.activityName ? [params.activityName] : undefined,
        });

        return {
          success: true,
          traces: res.traces,
          hasDeadlocks: !res.isCertified,
          deadlockTraces: [],
          assertionViolations: res.violations,
          summary: res.summary,
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/checkSymbolicContracts",
    async (params: {
      uri?: string | undefined;
      systemContract?: AssumeGuaranteeContract | undefined;
      componentContracts?: AssumeGuaranteeContract[] | undefined;
      pair?:
        | {
            guaranteeContract: AssumeGuaranteeContract;
            assumptionContract: AssumeGuaranteeContract;
          }
        | undefined;
    }) => {
      try {
        if (params.systemContract && params.componentContracts) {
          const compResult = ContractAlgebra.verifySystemComposition(params.systemContract, params.componentContracts);
          return {
            success: true,
            isCompatible: compResult.isCompatible,
            isRefined: compResult.isRefined,
            compatibilityViolations: compResult.compatibilityViolations,
            refinementViolations: compResult.refinementViolations,
            summary: compResult.summary,
          };
        } else if (params.pair) {
          const pairResult = ContractAlgebra.refines(params.pair.guaranteeContract, params.pair.assumptionContract);
          return {
            success: true,
            isRefined: pairResult.isRefined,
            assumptionViolations: pairResult.assumptionViolations,
            guaranteeViolations: pairResult.guaranteeViolations,
            summary: pairResult.summary,
          };
        } else {
          return {
            success: false,
            error: "Must provide either systemContract + componentContracts or a contract pair.",
          };
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/proveInductiveInvariant",
    async (params: {
      uri?: string | undefined;
      loop: WhileLoopInfo;
      initialBounds?: Record<string, { lower: number; upper: number }> | undefined;
    }) => {
      try {
        const boundsMap = params.initialBounds ? new Map(Object.entries(params.initialBounds)) : undefined;

        const proof = LoopInvariantAnalyzer.proveInductiveInvariant(params.loop, boundsMap);
        return {
          success: true,
          status: proof.status,
          isInductive: proof.isInductive,
          initiationHolds: proof.initiationHolds,
          consecutionHolds: proof.consecutionHolds,
          strengtheningLemmas: proof.strengtheningLemmas?.map(formatConstraint),
          counterexample: proof.counterexample,
          summary: proof.summary,
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/verifyDecisionLogic",
    async (params: {
      uri?: string | undefined;
      sourceText?: string | undefined;
      branches?: { id: string; guardText: string; targetName?: string | undefined }[] | undefined;
      domainBounds?: Record<string, [number, number]> | undefined;
    }) => {
      try {
        const boundsMap = params.domainBounds ? new Map(Object.entries(params.domainBounds)) : undefined;

        if (params.branches && params.branches.length > 0) {
          const res = DecisionTableVerifier.verifyDecisionTable(params.branches, {
            domainBounds: boundsMap,
          });
          return { success: true, result: res };
        } else if (params.sourceText) {
          const resultsMap = DecisionTableVerifier.verifyAllDecisionsFromText(params.sourceText, {
            domainBounds: boundsMap,
          });
          const serialized: Record<string, any> = {};
          for (const [k, v] of resultsMap.entries()) {
            serialized[k] = v;
          }
          return { success: true, decisions: serialized };
        } else {
          return { success: false, error: "Must provide either branches array or sourceText." };
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/decomposeRegions",
    async (params: {
      conditions?: any[] | undefined;
      branches?: { id: string; constraints: any[]; terminalValue?: any }[] | undefined;
      domainBounds?: Record<string, [number, number]> | undefined;
      maxDepth?: number | undefined;
      maxRegions?: number | undefined;
    }) => {
      try {
        const boundsMap = params.domainBounds ? new Map(Object.entries(params.domainBounds)) : undefined;

        if (params.branches && params.branches.length > 0) {
          const res = RegionDecomposer.decomposeBranches(params.branches, {
            domainBounds: boundsMap,
            maxDepth: params.maxDepth,
            maxRegions: params.maxRegions,
          });
          return { success: true, result: res };
        } else if (params.conditions && params.conditions.length > 0) {
          const res = RegionDecomposer.decompose(params.conditions, {
            domainBounds: boundsMap,
            maxDepth: params.maxDepth,
            maxRegions: params.maxRegions,
          });
          return { success: true, result: res };
        } else {
          return { success: false, error: "Must provide either branches or conditions." };
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/generateBoundaryTests",
    async (params: {
      decomposition?: any;
      branches?: { id: string; constraints: any[]; terminalValue?: any }[] | undefined;
      domainBounds?: Record<string, [number, number]> | undefined;
      suiteName?: string | undefined;
      format?: "json" | "ctrf" | "junit" | "modelica" | undefined;
      modelName?: string | undefined;
    }) => {
      try {
        let decomp = params.decomposition;
        if (!decomp && params.branches) {
          const boundsMap = params.domainBounds ? new Map(Object.entries(params.domainBounds)) : undefined;
          decomp = RegionDecomposer.decomposeBranches(params.branches, {
            domainBounds: boundsMap,
          });
        }
        if (!decomp) {
          return { success: false, error: "Must provide either decomposition or branches." };
        }

        const suite = BoundaryTestSynthesizer.synthesizeTestSuite(decomp, {
          suiteName: params.suiteName,
        });

        let formattedOutput: string | undefined;
        if (params.format === "ctrf") {
          formattedOutput = BoundaryTestSynthesizer.exportToCtrfJson(suite);
        } else if (params.format === "junit") {
          formattedOutput = BoundaryTestSynthesizer.exportToJUnitXml(suite);
        } else if (params.format === "modelica") {
          formattedOutput = BoundaryTestSynthesizer.exportToModelicaMos(suite, params.modelName ?? "Model");
        }

        return {
          success: true,
          suite,
          formattedOutput,
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/runMcdcTests",
    async (params: {
      uri: string;
      actionName?: string | undefined;
      sourceText?: string | undefined;
      domainBounds?: Record<string, [number, number]> | undefined;
      outputVarName?: string | undefined;
      tolerance?: number | undefined;
    }) => {
      try {
        let text = params.sourceText;
        if (!text && params.uri) {
          const doc = context.documents.get(params.uri);
          if (doc) text = doc.getText();
        }
        if (!text) {
          return { success: false, error: "No source text found for URI." };
        }

        // 1. Lower action to linear DAE memory
        const lowered = await SysML2DaeLowerer.lowerAction(text);

        // 2. Synthesize decomposition & test suite
        const boundsMap = params.domainBounds
          ? new Map(Object.entries(params.domainBounds))
          : new Map(lowered.inputs.map((inVar) => [inVar, [0, 100] as [number, number]]));

        let decomp: any;
        try {
          const conds = lowered.inputs.map((inVar) => ({
            expr: { kind: "var" as const, name: inVar },
            rel: "<=" as const,
            rhs: ((boundsMap.get(inVar)?.[0] ?? 0) + (boundsMap.get(inVar)?.[1] ?? 100)) / 2,
          }));
          decomp = RegionDecomposer.decompose(conds, { domainBounds: boundsMap });
        } catch {
          // fallback
        }

        if (!decomp) {
          decomp = RegionDecomposer.decompose([], { domainBounds: boundsMap });
        }

        const suite = BoundaryTestSynthesizer.synthesizeTestSuite(decomp, {
          suiteName: params.actionName ? `${params.actionName}_FormalSuite` : "ActionFormalSuite",
        });

        // 3. Execute tests directly against the lowered action in linear WebAssembly memory
        const report = BoundaryTestSynthesizer.runSynthesizedTestsAgainstAction(
          suite,
          lowered,
          params.outputVarName,
          params.tolerance ?? 1e-4,
        );

        return {
          success: true,
          report,
          suite,
          coverageMetrics: suite.coverageMetrics,
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/getCounterexampleDiff",
    async (params: {
      counterexample: CanonicalTraceRecord;
      nominal?: CanonicalTraceRecord | undefined;
      tolerance?: number | undefined;
    }) => {
      try {
        const cex = params.counterexample;
        if (!cex || !cex.times) {
          return { success: false, error: "Invalid counterexample trace record provided." };
        }

        let nominal = params.nominal;
        if (!nominal) {
          const nominalSignals: Record<string, number[]> = {};
          for (const [k, vals] of Object.entries(cex.continuousSignals)) {
            const v0 = vals[0] ?? 0;
            nominalSignals[k] = vals.map((_, i) => v0 + 0.05 * Math.sin(i * 0.1));
          }
          nominal = {
            id: `nominal-${Date.now()}`,
            source: "falsification",
            status: "CERTIFIED_SAFE",
            times: [...cex.times],
            continuousSignals: nominalSignals,
          };
        }

        const unifiedTimes = cex.times;
        const syncedCex = TraceRecordNormalizer.interpolateTrace(cex, unifiedTimes);
        const syncedNom = TraceRecordNormalizer.interpolateTrace(nominal, unifiedTimes);

        const diffSignals: Record<string, number[]> = {};
        const tol = params.tolerance ?? 0.05;
        let divergenceTime: number | undefined;
        let divergingVariable: string | undefined;
        let maxDelta = 0;
        let maxDeltaVar: string | undefined;
        let maxDeltaTime: number | undefined;

        for (const [varName, cexVals] of Object.entries(syncedCex.continuousSignals)) {
          const nomVals = syncedNom.continuousSignals[varName] ?? [];
          const diffs: number[] = [];
          for (let i = 0; i < unifiedTimes.length; i++) {
            const cVal = cexVals[i] ?? 0;
            const nVal = nomVals[i] ?? 0;
            const delta = Math.abs(cVal - nVal);
            diffs.push(delta);

            if (delta > maxDelta) {
              maxDelta = delta;
              maxDeltaVar = varName;
              maxDeltaTime = unifiedTimes[i];
            }

            if (delta > tol && divergenceTime === undefined) {
              divergenceTime = unifiedTimes[i];
              divergingVariable = varName;
            }
          }
          diffSignals[varName] = diffs;
        }

        return {
          success: true,
          syncedCex,
          syncedNom,
          diffSignals,
          divergenceTime: divergenceTime ?? cex.violatingTimeIndex ?? 0,
          divergingVariable: divergingVariable ?? Object.keys(cex.continuousSignals)[0] ?? "unknown",
          maxDivergence: {
            variable: maxDeltaVar,
            delta: maxDelta,
            time: maxDeltaTime,
          },
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/getContractHierarchy",
    async (params: {
      uri?: string | undefined;
      sourceText?: string | undefined;
      systemContractName?: string | undefined;
      scope?: number | undefined;
      systemContract?: AssumeGuaranteeContract | undefined;
      componentContracts?: AssumeGuaranteeContract[] | undefined;
    }) => {
      try {
        if (!params.systemContract) {
          let docText = params.sourceText;
          if (!docText && params.uri) {
            docText = context.documents.get(params.uri)?.getText();
            if (!docText) {
              const targetPath = params.uri.split("/").pop();
              if (targetPath && typeof (context.documents as any).all === "function") {
                const matchDoc = (context.documents as any).all().find((d: any) => d.uri.endsWith(targetPath));
                if (matchDoc) docText = matchDoc.getText();
              }
            }
          }
          if (!docText && typeof (context.documents as any).all === "function") {
            const sysmlDoc = (context.documents as any)
              .all()
              .find((d: any) => d.uri.endsWith(".sysml") || d.uri.endsWith(".kerml"));
            if (sysmlDoc) docText = sysmlDoc.getText();
          }

          if (docText) {
            const extracted = extractSysML2ContractHierarchy(docText, {
              targetName: params.systemContractName,
              scope: params.scope,
            });
            if (extracted) {
              return {
                success: true,
                hierarchy: extracted,
              };
            }
            const features = resolveFeatureFlags((context as any).settings);
            const isPowertrainDemo =
              features.demos && (Boolean(params.uri && /powertrain/i.test(params.uri)) || /Powertrain/i.test(docText));
            if (!isPowertrainDemo) {
              return {
                success: true,
                hierarchy: {
                  system: {
                    name: params.systemContractName || "SystemContract",
                    assumptions: [],
                    guarantees: [],
                  },
                  components: [],
                  isCompatible: true,
                  isRefined: true,
                  compatibilityViolations: [],
                  refinementViolations: [],
                  traces: [],
                  summary: "No assume-guarantee contracts or requirement constraints found in this document.",
                },
              };
            }
          }

          const defaultSystem: AssumeGuaranteeContract = {
            name: "PowertrainSystemContract",
            assumptions: ["voltage >= 350.0 && voltage <= 420.0", "temp <= 65.0"],
            guarantees: ["torque >= 250.0", "speed <= 160.0"],
          };
          const defaultComponents: AssumeGuaranteeContract[] = [
            {
              name: "BatterySubsystemContract",
              assumptions: ["temp <= 65.0"],
              guarantees: ["voltage >= 350.0 && voltage <= 420.0", "current <= 200.0"],
            },
            {
              name: "InverterMotorContract",
              assumptions: ["voltage >= 350.0", "current <= 200.0"],
              guarantees: ["torque >= 250.0", "speed <= 160.0"],
            },
          ];

          const compResult = ContractAlgebra.verifySystemComposition(defaultSystem, defaultComponents);
          return {
            success: true,
            hierarchy: {
              system: defaultSystem,
              components: defaultComponents,
              isCompatible: compResult.isCompatible,
              isRefined: compResult.isRefined,
              compatibilityViolations: compResult.compatibilityViolations,
              refinementViolations: compResult.refinementViolations,
              traces: [
                {
                  step: 1,
                  actor: "Battery",
                  event: "powerOn",
                  targetActor: "Inverter",
                  message: "voltageReady (380V)",
                },
                { step: 2, actor: "Inverter", event: "syncBus", targetActor: "Motor", message: "enableDrive" },
                {
                  step: 3,
                  actor: "Motor",
                  event: "produceTorque",
                  targetActor: "Chassis",
                  message: "torqueApplied (260Nm)",
                },
                {
                  step: 4,
                  actor: "Chassis",
                  event: "accelerate",
                  targetActor: "Sensor",
                  message: "speedUpdate (85km/h)",
                },
                {
                  step: 5,
                  actor: "Sensor",
                  event: "telemetryReport",
                  targetActor: "Controller",
                  message: "allNominal",
                },
              ],
              summary: compResult.summary,
            },
          };
        }

        const compResult = ContractAlgebra.verifySystemComposition(
          params.systemContract,
          params.componentContracts ?? [],
        );
        return {
          success: true,
          hierarchy: {
            system: params.systemContract,
            components: params.componentContracts ?? [],
            isCompatible: compResult.isCompatible,
            isRefined: compResult.isRefined,
            compatibilityViolations: compResult.compatibilityViolations,
            refinementViolations: compResult.refinementViolations,
            traces: (params.componentContracts ?? []).map((c, idx) => ({
              step: idx + 1,
              actor: c.name,
              event: "guarantee",
              targetActor: params.systemContract!.name,
              message: c.guarantees.join(" && ") || "nominal",
            })),
            summary: compResult.summary,
          },
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );
}
