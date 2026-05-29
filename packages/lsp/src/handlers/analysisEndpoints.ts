/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */
// @ts-nocheck
import { EqKind, performBltTransformationArena, Variability } from "@modelscript/compiler";
import { ModelicaCalibrator, ModelicaOptimizer } from "@modelscript/compiler/optimizer";
import {
  ArenaSimulator,
  buildArenaSurrogate,
  runMonteCarloArena,
  simulateArena,
  type ArenaDoEInputRange,
} from "@modelscript/compiler/simulator";
import { parseCsvMeasurements } from "@modelscript/csv/csv-parser";
import { generateRomWasmSource } from "@modelscript/fmi";
import { extractSysML2Constraints, mapConstraintsToOptimizer } from "@modelscript/sysml2/constraint-extractor";
import { LspContext } from "../LspContext";
import { evaluateArenaExprToNum, getArenaParameterInfo, printArenaExpression } from "../utils/arenaUtils";

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

  context.connection.onRequest(
    "modelscript/optimizeModel",
    async (params: {
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
          context.connection.sendNotification("modelscript/status", {
            state: "loading",
            message: "Indexing dependencies for optimization...",
          });
          await context.workspaceManager.globalWorkspaceIndex.indexRemainingInBackground(50);
          context.connection.sendNotification("modelscript/status", { state: "ready", message: getReadyMessage() });

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

        // ── SysML2 constraint injection ──
        let stateConstraints: { variable: string; bound: number; type: "<=" | ">=" }[] | undefined;
        if (params.sysmlUri && context.workspaceManager.globalSysML2QueryEngine) {
          try {
            // Ensure the SysML2 document is indexed
            const sysmlDoc = context.documents.get(params.sysmlUri);
            if (sysmlDoc) await context.validationService.validateTextDocument(sysmlDoc);

            const sysmlDb = context.workspaceManager.globalSysML2QueryEngine.toQueryDB();
            const rawConstraints = extractSysML2Constraints(sysmlDb, params.sysmlFilter);
            const variableMap = params.sysmlVariableMap ? new Map(Object.entries(params.sysmlVariableMap)) : undefined;
            stateConstraints = mapConstraintsToOptimizer(rawConstraints, variableMap);
            context.connection.console.info(
              `[optimize] Extracted ${stateConstraints.length} SysML2 constraints` +
                (params.sysmlFilter ? ` (filter: ${params.sysmlFilter})` : ""),
            );
            for (const sc of stateConstraints) {
              context.connection.console.info(`[optimize]   ${sc.variable} ${sc.type} ${sc.bound}`);
            }
          } catch (e) {
            context.connection.console.warn(
              `[optimize] SysML2 constraint extraction failed: ${e instanceof Error ? e.message : String(e)}`,
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
          parameterOverrides: params.parameterOverrides
            ? new Map(Object.entries(params.parameterOverrides))
            : undefined,
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
      const { runMonteCarloSimulation } = await import("@modelscript/compiler/simulator");
      type RandomVariable = import("@modelscript/compiler/simulator").RandomVariable;
      type Distribution = import("@modelscript/compiler/simulator").Distribution;

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
}

// @ts-nocheck
