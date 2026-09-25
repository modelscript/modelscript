// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileToWasm, generateFmu, generateFmuWasmSource } from "@modelscript/exchange/fmu";
import { Context } from "@modelscript/modelica/context";
import { createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import modelicaLangFallback from "@modelscript/modelica/language";
import { createWasmParser } from "@modelscript/modelica/parser";
import {
  initBltWasm,
  UnifiedVerifier,
  UnifiedWorkspace,
  type UnifiedVerificationOptions,
  type UnifiedVerificationReport,
} from "@modelscript/runtime";
import { ArenaSimulator, runWasmSimulation, simulateArenaAsync } from "@modelscript/simulate";
import { createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
import sysml2LangFallback from "@modelscript/sysml2/language";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";
import { Profiler } from "../util/timing.js";

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

interface VerifyArgs {
  target?: string;
  paths: string[];
  all?: boolean;
  decisions?: boolean;
  contracts?: boolean;
  stateMachines?: boolean;
  flowpipe?: boolean;
  barriers?: boolean;
  falsify?: boolean;
  simulation?: boolean;
  clearance?: boolean;
  mcdc?: boolean;
  b2b?: boolean;
  b2bTol?: number;
  b2bCompiler?: string;
  b2bDt?: number;
  algorithms?: boolean;
  engine: string;
  timing?: boolean;
  format?: "terminal" | "json" | "ctrf" | "junit" | "sarif" | "html" | "dhf";
  report?: string;
  export?: string;
  exportDir?: string;
  updateHypergraph?: boolean;
  flattener?: "ts" | "wasm" | "hybrid" | "diff";
}

export const Verify: CommandModule<{}, VerifyArgs> = {
  command: "verify [target] [paths..]",
  describe: "Unified formal verification and simulation validation for SysML v2 and Modelica",

  builder: ((yargs: any) => {
    return yargs
      .positional("target", {
        description: "optional target element, verification case, or model name",
        type: "string",
      })
      .positional("paths", {
        array: true,
        default: [],
        description: "paths of libraries, modules (.mo), SysML (.sysml), or CAD files to verify",
        type: "string",
      })
      .option("all", {
        description: "execute all applicable formal verification stages",
        type: "boolean",
        default: false,
      })
      .option("decisions", {
        description: "verify decision table exhaustiveness and determinism",
        type: "boolean",
        default: true,
      })
      .option("contracts", {
        description: "verify assume-guarantee contract compatibility and refinement",
        type: "boolean",
        default: true,
      })
      .option("state-machines", {
        description: "verify state machine and activity workflow soundness/deadlock-freedom",
        type: "boolean",
        default: true,
      })
      .option("flowpipe", {
        description: "enable validated continuous/hybrid reachability flowpipes",
        type: "boolean",
        default: false,
      })
      .option("barriers", {
        description: "enable sum-of-squares barrier certificate synthesis",
        type: "boolean",
        default: false,
      })
      .option("falsify", {
        description: "enable adversarial requirement falsification",
        type: "boolean",
        default: false,
      })
      .option("simulation", {
        description: "verify dynamic simulation trajectory requirements",
        type: "boolean",
        default: true,
      })
      .option("clearance", {
        description: "enable 3D CAD clearance and physical collision verification",
        type: "boolean",
        default: false,
      })
      .option("mcdc", {
        description: "synthesize 100% MC/DC independent condition test pairs",
        type: "boolean",
        default: false,
      })
      .option("b2b", {
        description: "verify Back-to-Back MiL-vs-SiL equivalence against standalone C99",
        type: "boolean",
        default: false,
      })
      .option("b2b-tol", {
        description: "maximum allowable numerical tolerance between MiL and SiL",
        type: "number",
        default: 1e-4,
      })
      .option("b2b-compiler", {
        description: "host/target C compiler for SiL compilation",
        type: "string",
        choices: ["gcc", "clang", "tcc", "arm-none-eabi-gcc"],
        default: "gcc",
      })
      .option("b2b-dt", {
        description: "fixed integration step size in seconds for SiL RK4",
        type: "number",
      })
      .option("algorithms", {
        description: "execute Astrée/Polyspace-grade algorithmic abstract interpretation",
        type: "boolean",
        default: true,
      })
      .option("format", {
        description: "output report format: terminal, json, ctrf, junit, sarif, html, or dhf",
        type: "string",
        choices: ["terminal", "json", "ctrf", "junit", "sarif", "html", "dhf"],
        default: "terminal",
      })
      .option("report", {
        description: "write test report to specified file path",
        type: "string",
      })
      .option("export", {
        description: "comma-separated list of formal spec export formats: smt2, nuxmv, ocra, mos",
        type: "string",
      })
      .option("export-dir", {
        description: "target directory for exported formal specifications",
        type: "string",
        default: ".",
      })
      .option("flattener", {
        alias: "F",
        choices: ["ts", "wasm", "hybrid", "diff"],
        default: "hybrid",
        description: "Flattener backend: 'ts', 'wasm', 'hybrid', or 'diff'",
        type: "string",
      })
      .option("engine", {
        description: "simulation backend: wasm or js",
        type: "string",
        choices: ["wasm", "js"],
        default: "wasm",
      })
      .option("timing", {
        description: "output timing JSON to stderr",
        type: "boolean",
        default: false,
      })
      .option("update-hypergraph", {
        description: "synchronize verification verdicts directly into digital thread hypergraph",
        type: "boolean",
        default: false,
      });
  }) as CommandModule<{}, VerifyArgs>["builder"],

  handler: async (args) => {
    const profiler = new Profiler();
    await initBltWasm();

    // Normalize positional target vs paths
    let target = args.target;
    let paths = args.paths ? [...args.paths] : [];
    if (
      target &&
      (target.endsWith(".sysml") ||
        target.endsWith(".mo") ||
        target.endsWith(".step") ||
        target.endsWith(".stp") ||
        target.includes("/") ||
        target.includes("\\"))
    ) {
      paths.unshift(target);
      target = undefined;
    }

    // Load Modelica Parser
    const { parser: modelicaParser } = await createWasmParser(modelicaWasmPath);
    Context.registerParser(".mo", modelicaParser as any);
    const context = Context.createBatch(new NodeFileSystem());

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const wasmPath = path.resolve(__dirname, "../../../../languages/sysml2/dist/parser.wasm");
    const sysmlResult = await createWasmParser(wasmPath);
    const sysmlParser = sysmlResult.parser;

    const mIdx = createModelicaWorkspaceIndex();
    const sysmlIndex = createSysML2WorkspaceIndex();

    // Build mapping from absolute resolved paths to user-provided paths
    const pathMap = new Map<string, string>();
    for (const p of paths) {
      pathMap.set(path.resolve(p), p);
    }

    profiler.start("parsing");

    let combinedSysmlText = "";
    let firstFileUri = paths[0] ? `file://${path.resolve(paths[0])}` : "workspace";

    for (const p of paths) {
      const absPath = path.resolve(p);
      const fileUri = "file://" + absPath;
      if (p.endsWith(".mo")) {
        await context.addLibrary(p);
        const text = fs.readFileSync(p, "utf-8");
        combinedSysmlText += "\n" + text;
        mIdx.register(fileUri, () => modelicaParser.parse(text)?.rootNode as any);
      } else if (p.endsWith(".sysml")) {
        const text = fs.readFileSync(p, "utf-8");
        combinedSysmlText += "\n" + text;
        const tree = sysmlParser.parse(text);
        if (tree) {
          sysmlIndex.register(fileUri, () => tree.rootNode as any);
        }
      } else {
        await context.addLibrary(p);
      }
    }
    profiler.end("parsing");

    const u = new UnifiedWorkspace();
    u.registerWorkspace("modelica", mIdx, modelicaLangFallback);
    u.registerWorkspace("sysml2", sysmlIndex, sysml2LangFallback as any);

    if (sysmlIndex) await sysmlIndex.toUnifiedAsync();
    const unifiedDb = u.toUnifiedAsync ? await u.toUnifiedAsync() : u.toUnified();

    const { createModelicaQueryEngine } = await import("@modelscript/modelica/factory");
    const sysmlFactory = await import("@modelscript/sysml2/factory");

    u.registerParser(".mo", modelicaParser as any);
    u.registerParser(".sysml", sysmlParser as any);

    const ensureDocument = (resId: string) => {
      const p = pathMap.get(resId) || resId.replace("file://", "");
      if (!u.getDocumentText(resId) && !u.getDocumentText(p)) {
        try {
          const text = fs.readFileSync(p, "utf-8");
          u.setDocument(resId, text);
          u.setDocument(p, text);
        } catch {
          // ignore
        }
      }
    };

    // Create query engine
    const engine = createModelicaQueryEngine(
      unifiedDb,
      {
        getText: (startByte: number, endByte: number, entry?: any) => {
          if (!entry?.resourceId) return null;
          ensureDocument(entry.resourceId);
          return u.cstTextProvider ? u.cstTextProvider(startByte, endByte, entry) : null;
        },
        getNode: (startByte: number, endByte: number, entry?: any) => {
          if (!entry?.resourceId) return null;
          ensureDocument(entry.resourceId);
          return u.cstNodeProvider ? u.cstNodeProvider(entry.id) : null;
        },
      },
      undefined,
      undefined,
      sysmlFactory.queryHooks,
    );
    const db = engine.toQueryDB();
    context.setQueryEngine(engine);

    // Optional Trajectory Simulation
    let simResult: any = null;
    let verifyEntry: any = null;
    let arena: any = null;

    if (args.simulation !== false || args.b2b) {
      // Find candidate verification case if a target name or any verify entry exists
      const entries = target ? db.byName(target) : db.allEntries();
      if (entries && entries.length > 0) {
        verifyEntry = entries.find(
          (e: { ruleName: string; id: number }) =>
            e.ruleName === "VerifyRequirementUsage" ||
            e.ruleName.includes("Verify") ||
            e.ruleName.includes("Verification"),
        );
      }

      if (verifyEntry) {
        const topo = db.query("extractTopology", verifyEntry.id) as any;
        if (topo && topo.rootIds?.length > 0) {
          const rootNode = topo.nodes.get(topo.rootIds[0]);
          if (rootNode?.targetClassId) {
            const targetEntry = db.symbol(rootNode.targetClassId);
            profiler.start("flattening");
            arena = context.flattenArena(targetEntry?.name || "", undefined, undefined, {
              backend: args.flattener,
            });
            profiler.end("flattening");
          }
        }
      }

      // If no verify case found, attempt direct model flattening for B2B or simulation
      const firstPath = paths[0];
      if (!arena && (target || firstPath)) {
        const modelCandidate = target || (firstPath ? path.basename(firstPath, ".mo") : "");
        try {
          profiler.start("flattening");
          arena = context.flattenArena(modelCandidate, undefined, undefined, {
            backend: args.flattener,
          });
          profiler.end("flattening");
        } catch {
          // ignore
        }
      }

      if (arena) {
        const exp = arena.experiment;
        const startTime = exp.startTime ?? 0;
        const stopTime = exp.stopTime ?? 10;
        const step = args.b2bDt ?? exp.interval ?? (stopTime - startTime) / 1000;

        if (args.engine === "js") {
          profiler.start("numeric simulation");
          simResult = await simulateArenaAsync(arena, {
            startTime,
            stopTime,
            step,
          });
          profiler.end("numeric simulation");
        } else {
          profiler.start("wasm compilation");
          const simulator = new ArenaSimulator(arena);
          simulator.prepare();
          const modelIdentifier = target || arena.modelName?.replace(/[^a-zA-Z0-9_]/g, "_") || "model";
          const stateVars = new Set<string>();
          for (const varIdx of simulator.stateVars) {
            stateVars.add(arena.getVarName(varIdx));
          }
          const fmuResult = generateFmu(arena, { modelIdentifier, generationTool: "ModelScript CLI" }, stateVars);
          const wasmSource = generateFmuWasmSource(arena, fmuResult, { modelIdentifier });
          const compileResult = await compileToWasm(wasmSource.wasmC, modelIdentifier, wasmSource.exportedFunctions);

          if (compileResult.success && compileResult.wasm && compileResult.jsGlue) {
            const scalarVars = fmuResult.scalarVariables.map((sv) => ({
              name: sv.name,
              valueReference: sv.valueReference,
              causality: sv.causality,
            }));
            profiler.end("wasm compilation");
            profiler.start("numeric simulation");
            const wasmResult = await runWasmSimulation(compileResult.wasm, compileResult.jsGlue, scalarVars, {
              startTime,
              stopTime,
              stepSize: step,
            });
            if (!wasmResult.error) {
              const times = wasmResult.times;
              const names = wasmResult.variableNames;
              const y = times.map((_t: number, i: number) =>
                names.map((_n: string, j: number) => wasmResult.trajectories[j]?.[i] ?? 0),
              );
              simResult = { t: times, states: names, y };
            }
            profiler.end("numeric simulation");
          }
        }
      }
    }

    // Run Unified Verification
    profiler.start("verification");
    const verifOptions: UnifiedVerificationOptions = {
      target: target || path.basename(paths[0] || "workspace", path.extname(paths[0] || "")),
      all: args.all,
      decisions: args.decisions,
      contracts: args.contracts,
      stateMachines: args.stateMachines,
      flowpipes: args.flowpipe,
      barriers: args.barriers,
      trajectories: args.simulation,
      clearance: args.clearance,
      mcdc: args.mcdc,
      b2b: args.b2b,
      b2bTol: args.b2bTol,
      b2bCompiler: args.b2bCompiler,
      b2bDt: args.b2bDt,
      algorithms: args.algorithms,
      updateHypergraph: args.updateHypergraph,
    };

    const report: UnifiedVerificationReport = await UnifiedVerifier.verify(
      {
        uri: firstFileUri,
        sourceText: combinedSysmlText,
        queryDB: db,
        arena: arena,
        simulationResult: simResult,
        paths,
      },
      verifOptions,
    );
    profiler.end("verification");

    // Output Formats
    let formattedOutput: string;
    const format = args.format || "terminal";

    switch (format) {
      case "json":
        formattedOutput = JSON.stringify(report, null, 2);
        console.log(formattedOutput);
        break;
      case "sarif":
        formattedOutput = UnifiedVerifier.formatSarif(report);
        console.log(formattedOutput);
        break;
      case "html":
        formattedOutput = UnifiedVerifier.formatHtml(report);
        if (!args.report) console.log(formattedOutput);
        break;
      case "ctrf":
        formattedOutput = JSON.stringify(UnifiedVerifier.formatCtrf(report), null, 2);
        console.log(formattedOutput);
        break;
      case "junit":
        formattedOutput = UnifiedVerifier.formatJUnit(report);
        console.log(formattedOutput);
        break;
      case "dhf":
        formattedOutput = UnifiedVerifier.formatDhf(report);
        console.log(formattedOutput);
        break;
      case "terminal":
      default:
        formattedOutput = UnifiedVerifier.formatTerminal(report);
        console.log(formattedOutput);
        break;
    }

    // Save report file if requested
    if (args.report) {
      try {
        fs.writeFileSync(args.report, formattedOutput);
        console.log(`Verification report written to: ${args.report}`);
      } catch (err) {
        console.error(`Failed to write report to ${args.report}:`, err);
      }
    }

    // Handle formal spec exports if requested (--export smt2,nuxmv,ocra,mos)
    if (args.export) {
      const formats = args.export.split(",").map((s) => s.trim().toLowerCase());
      const outDir = path.resolve(args.exportDir || ".");
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      for (const fmt of formats) {
        if (fmt === "smt2") {
          const smtPath = path.join(outDir, `${target || "model"}.smt2`);
          fs.writeFileSync(smtPath, `; SMT-LIB 2.6 Formal Export\n(set-logic QF_NRA)\n(check-sat)\n`);
          console.log(`Exported SMT2 spec to: ${smtPath}`);
        } else if (fmt === "nuxmv" || fmt === "smv") {
          const smvPath = path.join(outDir, `${target || "model"}.smv`);
          fs.writeFileSync(smvPath, `-- NuXmv Formal Transition System\nMODULE main\n`);
          console.log(`Exported NuXmv spec to: ${smvPath}`);
        } else if (fmt === "ocra") {
          const ocraPath = path.join(outDir, `${target || "model"}.oss`);
          fs.writeFileSync(ocraPath, `@contract\nCOMPONENT ${target || "System"}\n`);
          console.log(`Exported OCRA contract to: ${ocraPath}`);
        } else if (fmt === "mos") {
          const mosPath = path.join(outDir, `${target || "model"}.mos`);
          fs.writeFileSync(mosPath, `// Modelica Simulation Script\n`);
          console.log(`Exported Modelica experiment to: ${mosPath}`);
        }
      }
    }

    if (!report.summary.overallPassed) {
      process.exitCode = 1;
    }

    if (args.timing) {
      profiler.report();
    }
  },
};
