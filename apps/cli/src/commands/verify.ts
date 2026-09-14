// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileToWasm, generateFmu, generateFmuWasmSource } from "@modelscript/exchange/fmu";
import { Context } from "@modelscript/modelica/context";
import { createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import modelicaLangFallback from "@modelscript/modelica/language";
import { createWasmParser } from "@modelscript/modelica/parser";
import {
  DigitalThreadHypergraph,
  generateCtrfReport,
  generateJUnitReport,
  UnifiedWorkspace,
  VerificationRunner,
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
  name: string; // The sysml verification case name
  paths: string[];
  engine: string;
  timing?: boolean;
  format?: "terminal" | "json" | "ctrf" | "junit";
  report?: string;
  updateHypergraph?: boolean;
}

export const Verify: CommandModule<{}, VerifyArgs> = {
  command: "verify <name> <paths..>",
  describe: "Run SysML2 verification against a simulation",

  builder: ((yargs: any) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "name of the SysML Verification Case",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "paths of libraries, modules (.mo) and sysml files to load",
        type: "string",
      })
      .option("engine", {
        description: "simulation backend: wasm (WebAssembly via emcc) or js (pure JavaScript)",
        type: "string",
        choices: ["wasm", "js"],
        default: "wasm",
      })
      .option("timing", {
        description: "output timing JSON to stderr",
        type: "boolean",
        default: false,
      })
      .option("format", {
        description: "output report format: terminal, json, ctrf, or junit",
        type: "string",
        choices: ["terminal", "json", "ctrf", "junit"],
        default: "terminal",
      })
      .option("report", {
        description: "write test report to specified file path",
        type: "string",
      })
      .option("update-hypergraph", {
        description: "synchronize verification verdicts directly into digital thread hypergraph",
        type: "boolean",
        default: false,
      });
  }) as CommandModule<{}, VerifyArgs>["builder"],
  handler: async (args) => {
    const profiler = new Profiler();

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
    for (const p of args.paths) {
      pathMap.set(path.resolve(p), p);
    }

    profiler.start("parsing");

    let sysmlFileUri = "";

    for (const p of args.paths) {
      if (p.endsWith(".mo")) {
        await context.addLibrary(p);
        const text = fs.readFileSync(p, "utf-8");

        mIdx.register(`file://${path.resolve(p)}`, () => modelicaParser.parse(text)?.rootNode as any);
      } else if (p.endsWith(".sysml")) {
        const text = fs.readFileSync(p, "utf-8");
        const tree = sysmlParser.parse(text);
        const fileUri = "file://" + path.resolve(p);
        if (tree) {
          sysmlIndex.register(fileUri, () => tree.rootNode as any);
        }
        if (!sysmlFileUri) sysmlFileUri = fileUri;
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

    // 1. Find the verify case
    const verifyEntries = db.byName(args.name);
    if (!verifyEntries || verifyEntries.length === 0) {
      console.error(`Verification case '${args.name}' not found.`);
      return;
    }

    const verifyEntry = verifyEntries.find(
      (e: { ruleName: string; id: number }) =>
        e.ruleName === "VerifyRequirementUsage" || e.ruleName.includes("Verify") || e.ruleName.includes("Verification"),
    );
    if (!verifyEntry) {
      console.error(`'${args.name}' is not a valid verification case.`);
      return;
    }

    // 2. Extract topology mapping

    const topo = db.query("extractTopology", verifyEntry.id) as any;
    if (!topo || topo.rootIds.length === 0) {
      console.error(`Verification case '${args.name}' does not resolve to a valid simulation target topology.`);
      return;
    }

    const rootNode = topo.nodes.get(topo.rootIds[0]);
    if (!rootNode?.targetClassId) {
      console.error(`Simulation target class ID not found in topology for verification case '${args.name}'.`);
      return;
    }

    const targetEntry = db.symbol(rootNode.targetClassId);

    // Flatten the model
    profiler.start("flattening");
    const arena = context.flattenArena(targetEntry?.name || "");
    profiler.end("flattening");

    if (!arena) {
      console.error(
        `Modelica target '${targetEntry?.name}' not found or had flattening errors. Ensure both sysml and modelica files are passed.`,
      );
      return;
    }

    const exp = arena.experiment;
    const startTime = exp.startTime ?? 0;
    const stopTime = exp.stopTime ?? 10;
    const step = exp.interval ?? (stopTime - startTime) / 1000;

    let simResult;

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
      // WASM execution path
      const simulator = new ArenaSimulator(arena);
      simulator.prepare();

      const modelIdentifier = targetEntry?.name?.replace(/\./g, "_") || "model";
      const stateVars = new Set<string>();
      for (const varIdx of simulator.stateVars) {
        stateVars.add(arena.getVarName(varIdx));
      }
      const fmuResult = generateFmu(arena, { modelIdentifier, generationTool: "ModelScript CLI" }, stateVars);
      const wasmSource = generateFmuWasmSource(arena, fmuResult, { modelIdentifier });
      const compileResult = await compileToWasm(wasmSource.wasmC, modelIdentifier, wasmSource.exportedFunctions);

      if (!compileResult.success || !compileResult.wasm || !compileResult.jsGlue) {
        console.error(`WASM compilation failed: ${compileResult.message}`);
        return;
      }

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

      if (wasmResult.error) {
        console.error(`WASM simulation error: ${wasmResult.error}`);
        if (args.timing) profiler.report();
        return;
      }

      const times = wasmResult.times;
      const names = wasmResult.variableNames;
      const y = times.map((_t: number, i: number) =>
        names.map((_n: string, j: number) => wasmResult.trajectories[j]?.[i] ?? 0),
      );

      simResult = {
        t: times,
        states: names,
        y: y,
      };
      profiler.end("numeric simulation");
    }

    // Verify
    // Output CSV for plotting
    try {
      let csvStr = "time";
      for (const name of simResult.states) {
        csvStr += "," + name;
      }
      csvStr += "\n";
      for (let i = 0; i < simResult.t.length; i++) {
        csvStr += simResult.t[i];
        for (let j = 0; j < simResult.states.length; j++) {
          csvStr += "," + (simResult.y?.[i]?.[j] ?? 0);
        }
        csvStr += "\n";
      }
      fs.writeFileSync("results.csv", csvStr);
    } catch (e) {
      console.error("Failed to write results.csv", e);
    }

    profiler.start("verification");
    const runner = new VerificationRunner(db, topo.variableMap);
    let hypergraph: DigitalThreadHypergraph | undefined;
    if (args.updateHypergraph) {
      hypergraph = new DigitalThreadHypergraph();
    }
    const vResults = runner.verifyCase(verifyEntry.id, simResult, hypergraph);
    profiler.end("verification");

    let hasFailures = false;
    for (const res of vResults) {
      if (!res.isSatisfied) {
        hasFailures = true;
      }
    }

    // Format output
    if (args.format === "json") {
      console.log(JSON.stringify(vResults, null, 2));
    } else if (args.format === "ctrf") {
      console.log(JSON.stringify(generateCtrfReport(vResults), null, 2));
    } else if (args.format === "junit") {
      console.log(generateJUnitReport(args.name, vResults));
    } else {
      // Default: terminal
      for (const res of vResults) {
        if (!res.isSatisfied) {
          let diagMsg = "Requirement Violated";
          if (res.requirementName && res.message) {
            diagMsg = `Requirement '${res.requirementName}' violated: ${res.message.replace(/^Requirement violated: /, "")}`;
          } else if (res.message) {
            diagMsg = res.message;
          }
          if (res.blastRadius !== undefined) {
            diagMsg += ` [Blast Radius: ${res.blastRadius} downstream nodes]`;
          }
          console.error(`[VERIFICATION FAILED] ${diagMsg}`);
        } else {
          let passMsg = `Requirement '${res.requirementName || res.requirementId}' satisfied.`;
          if (res.metricName && res.metricValue !== undefined) {
            passMsg += ` (${res.metricName} = ${res.metricValue.toFixed(2)})`;
          }
          console.log(`[VERIFICATION PASSED] ${passMsg}`);
        }
      }
    }

    // Save report file if requested
    if (args.report) {
      try {
        if (args.report.endsWith(".xml") || args.format === "junit") {
          fs.writeFileSync(args.report, generateJUnitReport(args.name, vResults));
        } else {
          fs.writeFileSync(args.report, JSON.stringify(generateCtrfReport(vResults), null, 2));
        }
        console.log(`Verification report written to: ${args.report}`);
      } catch (err) {
        console.error(`Failed to write report to ${args.report}:`, err);
      }
    }

    if (hasFailures) {
      process.exitCode = 1;
    }

    if (args.timing) {
      profiler.report();
    }
  },
};
