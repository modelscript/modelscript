// SPDX-License-Identifier: AGPL-3.0-or-later

import { VerificationRunner } from "@modelscript/compiler";
import { ArenaSimulator, runWasmSimulation, simulateArenaAsync } from "@modelscript/compiler/simulator";
import { Context, createSysML2QueryEngine, createSysML2WorkspaceIndex } from "@modelscript/core";
import { compileToWasm, generateFmu, generateFmuWasmSource } from "@modelscript/fmi";
import Modelica from "@modelscript/modelica/parser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";
import { Profiler } from "../util/timing.js";

// Remove createRequire and require

interface VerifyArgs {
  name: string; // The sysml verification case name
  paths: string[];
  engine: string;
  timing?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Verify: CommandModule<{}, VerifyArgs> = {
  command: "verify <name> <paths..>",
  describe: "Run SysML2 verification against a simulation",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      });
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  }) as CommandModule<{}, VerifyArgs>["builder"],
  handler: async (args) => {
    const profiler = new Profiler();

    // Load Modelica Parser
    const modelicaParser = new Parser();
    modelicaParser.setLanguage(Modelica);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Context.registerParser(".mo", modelicaParser as any);
    const context = Context.createBatch(new NodeFileSystem());

    const WebParserModule = await import("web-tree-sitter");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const WebParser: any = WebParserModule.default || WebParserModule;

    await WebParser.Parser.init();
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const wasmPath = path.resolve(__dirname, "../../../../languages/sysml2/tree-sitter-sysml2.wasm");
    const SysML2 = await WebParser.Language.load(fs.readFileSync(wasmPath));
    const sysmlParser = new WebParser.Parser();
    sysmlParser.setLanguage(SysML2);

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
      } else if (p.endsWith(".sysml")) {
        const text = fs.readFileSync(p, "utf-8");
        const tree = sysmlParser.parse(text);
        const fileUri = "file://" + path.resolve(p);
        sysmlIndex.register(fileUri, () => tree.rootNode);
        if (!sysmlFileUri) sysmlFileUri = fileUri;
      } else {
        await context.addLibrary(p);
      }
    }
    profiler.end("parsing");

    await sysmlIndex.toUnifiedAsync();
    const sysmlUnified = sysmlIndex.toTreeIndex();

    // Create query engine
    const engine = createSysML2QueryEngine(sysmlUnified, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getText: (startByte: number, endByte: number, entry?: any) => {
        if (!entry || !entry.resourceId) return null;
        const text = fs.readFileSync(pathMap.get(entry.resourceId) || entry.resourceId.replace("file://", ""), "utf-8");
        return text.substring(startByte, endByte);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getNode: (startByte: number, endByte: number, entry?: any) => {
        if (!entry || !entry.resourceId) return null;
        // In CLI, we only parse once so we can just re-parse or use the cached tree.
        // But we don't have the tree cached here! Let's parse it.
        const text = fs.readFileSync(pathMap.get(entry.resourceId) || entry.resourceId.replace("file://", ""), "utf-8");
        const tree = sysmlParser.parse(text);
        return tree.rootNode.descendantForIndex(startByte, Math.max(startByte, endByte - 1));
      },
    });
    const db = engine.toQueryDB();

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      const wasmResult = await runWasmSimulation(
        compileResult.wasm.buffer as ArrayBuffer,
        compileResult.jsGlue,
        scalarVars,
        {
          startTime,
          stopTime,
          stepSize: step,
        },
      );

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
    profiler.start("verification");
    const runner = new VerificationRunner(db, topo.variableMap);
    const vResults = runner.verifyCase(verifyEntry.id, simResult);
    profiler.end("verification");

    // Use the bridge to get formatted LSP-like diagnostics, then print them
    // Note: emitVerificationDiagnostics requires a position index. Since this is CLI,
    // we can create a dummy one or mock the LSP behavior.

    let hasFailures = false;
    for (const res of vResults) {
      if (!res.isSatisfied) {
        hasFailures = true;
        let diagMsg = "Requirement Violated";
        if (res.requirementName && res.message) {
          diagMsg = `Requirement '${res.requirementName}' violated: ${res.message.replace(/^Requirement violated: /, "")}`;
        } else if (res.message) {
          diagMsg = res.message;
        }
        console.error(`[VERIFICATION FAILED] ${diagMsg}`);
      } else {
        console.log(`[VERIFICATION PASSED] Requirement '${res.requirementName || res.requirementId}' satisfied.`);
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
