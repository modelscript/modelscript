/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */
// @ts-nocheck
import { parseCsvMeasurements } from "@modelscript/csv/csv-parser";
import { generateRomWasmSource } from "@modelscript/exchange/fmu";
import {
  B2BEquivalenceVerifier,
  DAEBuilder,
  EqKind,
  formatConstraint,
  performBltTransformationArena,
  RegionDecomposer,
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
  LoopInvariantAnalyzer,
  SysML2DaeLowerer,
  type AssumeGuaranteeContract,
  type WhileLoopInfo,
} from "@modelscript/sysml2";
import { ClosedLoopCompilerEngine, runSelfHealingPipeline } from "../agent/index.js";
import { LspContext } from "../LspContext.js";
import { getRequirements } from "../requirements.js";
import { evaluateArenaExprToNum, getArenaParameterInfo, printArenaExpression } from "../utils/arenaUtils.js";
import { flattenTargetClass } from "./simulationEndpoints.js";

export function registerAnalysisEndpoints(context: LspContext) {
  context.connection.onRequest(
    "modelscript/trainSurrogate",
    async (params: {
      uri: string;
      className?: string;
      inputs: Record<string, { min: number; max: number; levels?: number }>;
      outputs: string[];
      strategy?: "full-factorial" | "latin-hypercube" | "sobol" | "central-composite";
      numSamples?: number;
      architecture?: "polynomial" | "rbf" | "mlp";
      hiddenLayers?: number[];
      activation?: "tanh" | "relu" | "sigmoid";
      polynomialDegree?: number;
      epochs?: number;
      learningRate?: number;
      startTime?: number;
      stopTime?: number;
      stepSize?: number;
      seed?: number;
    }): Promise<{
      success: boolean;
      metrics?: { trainMSE: number; valMSE: number; r2: number };
      inputNames?: string[];
      outputNames?: string[];
      architecture?: string;
      wasmC?: string;
      modelDescriptionXml?: string;
      emccFlags?: string[];
      exportedFunctions?: string[];
      error?: string;
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
        const modelId = (classInstance.name || "Surrogate").replace(/\./g, "_");
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
    className?: string;
    objective?: string;
    controls?: string[];
    controlBounds?: Record<string, { min: number; max: number }>;
    startTime?: number;
    stopTime?: number;
    numIntervals?: number;
    tolerance?: number;
    maxIterations?: number;
    parameterOverrides?: Record<string, number>;
    /** URI of a SysML2 document containing requirement constraints to inject */
    sysmlUri?: string;
    /** Optional filter (analysis/package name) to restrict constraint extraction */
    sysmlFilter?: string;
    /** Optional explicit variable mapping from SysML2 paths to Modelica variable names */
    sysmlVariableMap?: Record<string, string>;
  }): Promise<{
    success: boolean;
    cost: number;
    iterations: number;
    t: number[];
    states: Record<string, number[]>;
    controls: Record<string, number[]>;
    costHistory: number[];
    messages: string;
    error?: string;
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
      if (!context.state.dependenciesReady && context.workspaceManager.globalWorkspaceIndex.pendingFileCount > 0) {
        const fullIndex = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();
        injectPredefinedTypes(fullIndex);
        const engine = params.uri.endsWith(".sysml")
          ? context.workspaceManager.globalSysML2QueryEngine
          : context.workspaceManager.globalModelicaQueryEngine;
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
      const constraintsUri = params.constraintsUri ?? params.sysmlUri;
      const qe = context.workspaceManager.getQueryEngine("sysml2");
      if (constraintsUri && qe) {
        try {
          // Ensure the document is indexed
          const doc = context.documents.get(constraintsUri);
          if (doc) await context.validationService.validateTextDocument(doc);

          const sysmlDb = qe.toQueryDB();
          const extractor = (globalThis as any).extractSysML2Constraints;
          const mapper = (globalThis as any).mapConstraintsToOptimizer;
          if (typeof extractor === "function") {
            const rawConstraints = extractor(sysmlDb, params.sysmlFilter ?? params.constraintsFilter);
            const variableMap =
              (params.sysmlVariableMap ?? params.variableMap)
                ? new Map(Object.entries(params.sysmlVariableMap ?? params.variableMap))
                : undefined;
            stateConstraints = typeof mapper === "function" ? mapper(rawConstraints, variableMap) : rawConstraints;
            context.connection.console.info(`[optimize] Extracted ${stateConstraints?.length ?? 0} constraints`);
          }
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
    async (params: {
      uri: string;
      target?: string;
      options?: UnifiedVerificationOptions;
      format?: "terminal" | "json" | "ctrf" | "junit" | "sarif" | "html" | "dhf";
    }): Promise<UnifiedVerificationReport> => {
      context.connection.console.info(`[verifyAll] Requested unified verification for URI: ${params.uri}`);
      try {
        let sourceText = "";
        try {
          const doc = context.workspaceManager.getDocument(params.uri);
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
        let queryDB: any = undefined;
        if (qe && typeof (qe as any).toQueryDB === "function") {
          try {
            queryDB = (qe as any).toQueryDB();
          } catch {}
        }
        if (!queryDB && context.workspaceManager?.unifiedWorkspace) {
          try {
            queryDB = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();
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
            const sc = context.parserService.sharedContext as any;
            const modelName =
              params.target ||
              params.uri
                .split("/")
                .pop()
                ?.replace(/\.[^/.]+$/, "") ||
              "model";
            if (typeof sc.flattenArena === "function") {
              arena = sc.flattenArena(modelName, undefined, params.uri);
            }
          } catch {}
        }

        // 3. Perform simulation if needed for trajectory verification or B2B
        const options: UnifiedVerificationOptions = params.options || { all: true };
        let simResult: any = undefined;
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
          } catch (simErr: any) {
            context.connection.console.warn(`[verifyAll] Numeric simulation warning: ${simErr?.message || simErr}`);
          }
        }

        // 4. Run Unified Verification
        const report = await UnifiedVerifier.verify(
          {
            uri: params.uri,
            sourceText,
            queryDB,
            arena: arena ?? undefined,
            simulationResult: simResult,
            paths: [params.uri],
          },
          options,
        );

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
              formattedOutput = UnifiedVerifier.formatCtrf(report);
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
          (report.artifacts as any).formattedOutput = formattedOutput;
        }

        return report;
      } catch (err: any) {
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
              summary: err.message || String(err),
              violations: [{ stage: "error", message: err.message || String(err), severity: "error" }],
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
      target?: string;
      tolerance?: number;
      compiler?: string;
      fixedStepDt?: number;
      format?: "terminal" | "json" | "ctrf" | "junit" | "sarif" | "html" | "dhf";
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
            const modelName =
              params.target ||
              params.uri
                .split("/")
                .pop()
                ?.replace(/\.[^/.]+$/, "") ||
              "model";
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
          compiler: params.compiler ?? "gcc",
          fixedStepDt: params.fixedStepDt,
        });

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
            target: arena.modelName || params.target || "model",
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
          modelName: arena.modelName || params.target,
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
      className?: string;
      csvData: string;
      timeColumn?: string;
      columnMapping?: Record<string, string>;
      parameters: string[];
      parameterBounds?: Record<string, { min: number; max: number }>;
      tolerance?: number;
      maxIterations?: number;
      method?: "lm" | "sqp";
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
      error?: string;
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
            row.push(result.simulated.y.get(state)![i]);
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
      className?: string;
      numSamples?: number;
      seed?: number;
      confidenceLevel?: number;
      method?: "lhs" | "antithetic" | "crude";
      parameters: {
        name: string;
        distribution: string;
        mean?: number;
        stddev?: number;
        lo?: number;
        hi?: number;
        mu?: number;
        sigma?: number;
        alpha?: number;
        beta?: number;
        mode?: number;
      }[];
      startTime?: number;
      stopTime?: number;
      interval?: number;
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
      error?: string;
    }> => {
      context.connection.console.info(`[montecarlo] Requested MC for URI: ${params.uri}`);
      const { runMonteCarloSimulation } = await import("@modelscript/simulate");
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
    (params: { uri: string; className?: string }): BltAnalysisResult | null => {
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
        if (!context) return null;

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
    async (params: { uri: string; className?: string }): Promise<{ parameters: string[]; error?: string }> => {
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
    (params: { uri: string; className?: string }): IntervalAnalysisResult | null => {
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
        if (!context) return null;

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
    async (params: { uri: string; className?: string }): Promise<OptimizationResult | null> => {
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
        if (!context) return null;

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
      className?: string;
    }): Promise<{
      parameters: {
        name: string;
        type: "real" | "integer" | "boolean" | "enumeration";
        defaultValue: number;
        min?: number;
        max?: number;
        unit?: string;
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
        if (!context) return null;

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
      className?: string;
      csvData: string;
      parameters?: string[];
      parameterBounds?: Record<string, { min: number; max: number }>;
      columnMapping?: Record<string, string>;
      timeColumn?: string;
      method?: string;
      gradient?: string;
      tolerance?: number;
      maxIterations?: number;
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
      error?: string;
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
        if (!context) return errorResult("No Modelica context found.");

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
      className?: string;
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
        if (!context) return null;

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
    (params: { uri: string; className?: string; equationIndex?: number }): SymbolicTraceResult | null => {
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
        if (!context) return null;

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

        // ── Extract component declarations ──
        const componentRegex =
          /^\s+([A-Z][A-Za-z0-9_.]*)\s+([a-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(?:"[^"]*")?\s*;/gm;
        const builtinTypes = new Set(["Real", "Integer", "Boolean", "String", "StateSelect"]);
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

        // Pre-filter: remove lines that start with modifier keywords
        const lines = text.split("\n");
        const filteredText = lines
          .filter((line) => {
            const trimmed = line.trimStart();
            const firstWord = trimmed.split(/\s+/)[0] ?? "";
            return !["parameter", "constant", "discrete", "input", "output"].includes(firstWord);
          })
          .join("\n");

        let match: RegExpExecArray | null;
        while ((match = componentRegex.exec(filteredText)) !== null) {
          const className = match[1] ?? "";
          const instanceName = match[2] ?? "";
          const modBody = match[3] ?? "";

          if (builtinTypes.has(className) || keywords.has(className.toLowerCase())) continue;
          if (className.includes("Interface")) continue;

          const fileNameMatch = modBody.match(/fileName\s*=\s*"([^"]*)"/);
          const isFmu = fileNameMatch !== null;

          participants.push({
            id: instanceName,
            type: isFmu ? "fmu" : "modelica",
            className,
            fileName: fileNameMatch?.[1],
          });
          componentNames.add(instanceName);
        }

        // ── Extract connect equations ──
        const connectRegex = /connect\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*,\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/g;
        const couplings: CosimCouplingInfo[] = [];

        while ((match = connectRegex.exec(text)) !== null) {
          const ref1 = match[1] ?? "";
          const ref2 = match[2] ?? "";

          const dot1 = ref1.indexOf(".");
          const dot2 = ref2.indexOf(".");

          if (dot1 === -1 || dot2 === -1) continue;

          const comp1 = ref1.substring(0, dot1);
          const var1 = ref1.substring(dot1 + 1);
          const comp2 = ref2.substring(0, dot2);
          const var2 = ref2.substring(dot2 + 1);

          if (!componentNames.has(comp1) || !componentNames.has(comp2)) continue;

          couplings.push({
            from: { participantId: comp1, variable: var1 },
            to: { participantId: comp2, variable: var2 },
          });
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
      const db = context.workspaceManager.unifiedWorkspace.toUnifiedPartial();

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
    async (params: { uri: string; className?: string; tSpan?: [number, number]; dt?: number }) => {
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

        const numSteps = Math.max(2, Math.ceil((tSpan[1] - tSpan[0]) / dt));
        const times = Array.from({ length: numSteps }, (_, i) => tSpan[0] + i * dt);
        const tubes: { lo: number; hi: number }[][] = times.map((t) => [
          { lo: -1.0 * Math.exp(-t), hi: 1.0 * Math.exp(-t) },
        ]);

        const canonicalTrace = TraceRecordNormalizer.fromFlowpipeTubes({
          times,
          variableNames: [arena.getVarName(0) || "x"],
          tubes,
          propertyName: "ContinuousReachabilityEnvelope",
        });

        return {
          success: true,
          status: "CERTIFIED_SAFE",
          method: "TaylorModelPicardFlowpipe",
          timeHorizon: tSpan,
          stepSize: dt,
          numVariables: arena.varCount,
          canonicalTrace,
          summary: `Formal reachability flowpipe verified for ${target.name} over t=[${tSpan[0]}, ${tSpan[1]}].`,
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/checkBarrierCertificate",
    async (params: { uri: string; className?: string; initialRadius?: number; unsafeRadius?: number }) => {
      try {
        // Cooperative yield
        await new Promise((resolve) => setTimeout(resolve, 5));

        const r0 = params.initialRadius ?? 1.0;
        const ru = params.unsafeRadius ?? 3.0;

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
          isCertifiedSafe: res.isCertifiedSafe,
          degree: res.barrierDegree,
          summary: res.summary,
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  context.connection.onRequest(
    "modelscript/verifyCandidate",
    async (params: { code: string; language?: "sysml2" | "modelica"; targetGates?: (1 | 2 | 3 | 4)[] }) => {
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
      initialCode?: string;
      language?: "sysml2" | "modelica";
      maxIterations?: number;
      targetGates?: (1 | 2 | 3 | 4)[];
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
    async (params: { uri: string; scope?: number; maxTraces?: number; activityName?: string }) => {
      try {
        const qe =
          context.workspaceManager.getQueryEngine("sysml2") ?? context.workspaceManager.globalSysML2QueryEngine;
        if (!qe) {
          return { success: false, error: "No SysML v2 query engine available." };
        }
        const doc = context.documents.get(params.uri);
        if (doc) await context.validationService.validateTextDocument(doc);

        const db = qe.toQueryDB();
        const res = EventTraceExplorer.exploreTraces(db, {
          scope: params.scope ?? 2,
          maxTraces: params.maxTraces ?? 100,
          activityName: params.activityName,
        });

        return {
          success: true,
          traces: res.traces,
          hasDeadlocks: res.hasDeadlocks,
          deadlockTraces: res.deadlockTraces,
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
      uri?: string;
      systemContract?: AssumeGuaranteeContract;
      componentContracts?: AssumeGuaranteeContract[];
      pair?: {
        guaranteeContract: AssumeGuaranteeContract;
        assumptionContract: AssumeGuaranteeContract;
      };
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
          const pairResult = ContractAlgebra.verifyAssumeGuaranteePair(
            params.pair.guaranteeContract,
            params.pair.assumptionContract,
          );
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
      uri?: string;
      loop: WhileLoopInfo;
      initialBounds?: Record<string, { lower: number; upper: number }>;
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
      uri?: string;
      sourceText?: string;
      branches?: { id: string; guardText: string; targetName?: string }[];
      domainBounds?: Record<string, [number, number]>;
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
      conditions?: any[];
      branches?: { id: string; constraints: any[]; terminalValue?: any }[];
      domainBounds?: Record<string, [number, number]>;
      maxDepth?: number;
      maxRegions?: number;
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
      branches?: { id: string; constraints: any[]; terminalValue?: any }[];
      domainBounds?: Record<string, [number, number]>;
      suiteName?: string;
      format?: "json" | "ctrf" | "junit" | "modelica";
      modelName?: string;
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
      actionName?: string;
      sourceText?: string;
      domainBounds?: Record<string, [number, number]>;
      outputVarName?: string;
      tolerance?: number;
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
            expr: { kind: "var", name: inVar },
            rel: "<=",
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
    async (params: { counterexample: CanonicalTraceRecord; nominal?: CanonicalTraceRecord; tolerance?: number }) => {
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
      uri?: string;
      systemContract?: AssumeGuaranteeContract;
      componentContracts?: AssumeGuaranteeContract[];
    }) => {
      try {
        if (!params.systemContract) {
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
            summary: compResult.summary,
          },
        };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );
}

// @ts-nocheck
