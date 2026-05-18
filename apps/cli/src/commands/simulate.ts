// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaDAE, ModelicaFlattener } from "@modelscript/core";
import { compileToWasm, generateFmu, generateFmuWasmSource } from "@modelscript/fmi";
import Modelica from "@modelscript/modelica/parser";
import { ModelicaSimulator, runWasmSimulation, snapshotMemory, type MemorySnapshot } from "@modelscript/simulator";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";
import { Profiler } from "../util/timing.js";
import { generateSimulationC } from "./sim-c-codegen.js";

interface SimulateArgs {
  name: string;
  paths: string[];
  "start-time"?: number;
  startTime?: number;
  "stop-time"?: number;
  stopTime?: number;
  tolerance?: number;
  interval?: number;
  format: string;
  solver: string;
  realtime?: number;
  engine: string;
  timing?: boolean;
  "memory-profile"?: boolean;
  memoryProfile?: boolean;
  jacobian: "dense" | "sparse" | "fd";
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Simulate: CommandModule<{}, SimulateArgs> = {
  command: "simulate <name> <paths..>",
  describe: "Simulate a Modelica model and output results",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: ((yargs: any) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "name of class to simulate",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "paths of libraries and modules to load",
        type: "string",
      })
      .option("start-time", {
        description: "override experiment start time",
        type: "number",
      })
      .option("stop-time", {
        description: "override experiment stop time",
        type: "number",
      })
      .option("tolerance", {
        description: "override experiment tolerance",
        type: "number",
      })
      .option("interval", {
        description: "override experiment output interval",
        type: "number",
      })
      .option("format", {
        description: "output format",
        type: "string",
        choices: ["csv", "json"],
        default: "csv",
      })
      .option("solver", {
        description: "ODE solver to use",
        type: "string",
        choices: ["rk4", "dopri5", "bdf", "auto"],
        default: "dopri5",
      })
      .option("realtime", {
        description: "run simulation in real-time mode with given scale factor (e.g., 1.0 for 1x)",
        type: "number",
      })
      .option("engine", {
        description: "simulation backend: js (pure JavaScript), wasm (WebAssembly via emcc), c (native compiled)",
        type: "string",
        choices: ["js", "wasm", "c"],
        default: "js",
      })
      .option("timing", {
        description: "report timing information for each stage as JSON to stderr",
        type: "boolean",
        default: false,
      })
      .option("memory-profile", {
        description: "profile memory usage across phases and report as JSON to stderr",
        type: "boolean",
        default: false,
      })
      .option("jacobian", {
        description: "Jacobian calculation method",
        choices: ["dense", "sparse", "fd"],
        default: "sparse",
      });
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  }) as CommandModule<{}, SimulateArgs>["builder"],
  handler: async (args) => {
    const profiler = new Profiler();
    const parser = new Parser();
    parser.setLanguage(Modelica);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Context.registerParser(".mo", parser as any);
    const context = Context.createBatch(new NodeFileSystem());

    // Build mapping from absolute resolved paths to user-provided paths
    const pathMap = new Map<string, string>();
    for (const p of args.paths) {
      pathMap.set(path.resolve(p), p);
    }

    const memProfiles: Record<string, unknown> = {};
    let lastSnap = args.memoryProfile ? snapshotMemory(true) : null;

    profiler.start("parsing");
    for (const p of args.paths) await context.addLibrary(p);
    profiler.end("parsing");

    if (args.memoryProfile && lastSnap) {
      const snap = snapshotMemory(true);
      memProfiles["parsing"] = { before: lastSnap, after: snap };
      lastSnap = snap;
    }

    const instance = context.query(args.name);
    if (!instance) {
      console.error(`'${args.name}' not found`);
      return;
    }

    // Flatten the model
    profiler.start("flattening");
    const dae = new ModelicaDAE(instance.name ?? "DAE", instance.description);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (instance as any).accept(new ModelicaFlattener(), ["", dae]);
    profiler.end("flattening");

    if (args.memoryProfile && lastSnap) {
      const snap = snapshotMemory(true);
      memProfiles["flattening"] = { before: lastSnap, after: snap };
      lastSnap = snap;
    }

    // Resolve experiment parameters: CLI flags > annotation > defaults
    const exp = dae.experiment;
    const startTime = args.startTime ?? exp.startTime ?? 0;
    const stopTime = args.stopTime ?? exp.stopTime ?? 10;
    const step = args.interval ?? exp.interval ?? (stopTime - startTime) / 1000;

    // Dispatch to the selected engine
    switch (args.engine) {
      case "wasm":
        await simulateWasm(dae, args, profiler, startTime, stopTime, step, memProfiles, lastSnap);
        break;
      case "c":
        await simulateC(dae, args, profiler, startTime, stopTime, step, memProfiles, lastSnap);
        break;
      case "js":
      default:
        simulateJs(dae, args, profiler, startTime, stopTime, step, memProfiles, lastSnap);
        break;
    }

    if (args.memoryProfile) {
      console.error(JSON.stringify({ memory: memProfiles }, null, 2));
    }

    if (args.timing) profiler.report();
  },
};

// ── JS Engine ──

function simulateJs(
  dae: ModelicaDAE,
  args: SimulateArgs,
  profiler: Profiler,
  startTime: number,
  stopTime: number,
  step: number,
  memProfiles: Record<string, unknown>,
  lastSnap: MemorySnapshot | null,
): void {
  const simulator = new ModelicaSimulator(dae);
  simulator.prepare();
  const states = Array.from(simulator.stateVars) as string[];

  if (args.memoryProfile && lastSnap) {
    const snap = snapshotMemory(true);
    memProfiles["codegen"] = { before: lastSnap, after: snap }; // JS "codegen" is prepare()
    lastSnap = snap;
  }

  // Map CLI jacobian arg to SolverOptions
  let jacobianMethod: "finite-difference" | "ad-forward" | "ad-colored" = "finite-difference";
  if (args.jacobian === "dense") jacobianMethod = "ad-forward";
  if (args.jacobian === "sparse") jacobianMethod = "ad-colored";

  profiler.start("simulation");

  if (args.realtime !== undefined && args.realtime > 0) {
    // For simplicity, run synchronously here (realtime is niche for CLI)
    const result = simulator.simulate(startTime, stopTime, step, {
      solver: args.solver as "rk4" | "dopri5" | "bdf" | "auto",
      solverOptions: { jacobian: jacobianMethod },
    });
    profiler.end("simulation");

    if (args.memoryProfile && lastSnap) {
      const snap = snapshotMemory(true);
      memProfiles["simulation"] = { before: lastSnap, after: snap };
    }

    outputResults(result.t, result.y, states, args.format);
  } else {
    const result = simulator.simulate(startTime, stopTime, step, {
      solver: args.solver as "rk4" | "dopri5" | "bdf" | "auto",
      solverOptions: { jacobian: jacobianMethod },
    });
    profiler.end("simulation");

    if (args.memoryProfile && lastSnap) {
      const snap = snapshotMemory(true);
      memProfiles["simulation"] = { before: lastSnap, after: snap };
    }

    outputResults(result.t, result.y, states, args.format);
  }
}

// ── WASM Engine ──

async function simulateWasm(
  dae: ModelicaDAE,
  args: SimulateArgs,
  profiler: Profiler,
  startTime: number,
  stopTime: number,
  step: number,
  memProfiles: Record<string, unknown>,
  lastSnap: MemorySnapshot | null,
): Promise<void> {
  // Generate FMI result for scalar variable metadata
  const simulator = new ModelicaSimulator(dae);
  simulator.prepare();

  const modelIdentifier = args.name.replace(/\./g, "_");
  const fmuResult = generateFmu(dae, { modelIdentifier, generationTool: "ModelScript CLI" }, simulator.stateVars);

  // Generate WASM C source
  profiler.start("codegen");
  const wasmSource = generateFmuWasmSource(dae, fmuResult, { modelIdentifier });
  profiler.end("codegen");

  // Compile to WASM
  profiler.start("compilation");
  const compileResult = await compileToWasm(wasmSource.wasmC, modelIdentifier, wasmSource.exportedFunctions);
  profiler.end("compilation");

  if (args.memoryProfile && lastSnap) {
    const snap = snapshotMemory(true);
    memProfiles["codegen"] = { before: lastSnap, after: snap };
    lastSnap = snap;
  }

  if (!compileResult.success || !compileResult.wasm || !compileResult.jsGlue) {
    console.error(`WASM compilation failed: ${compileResult.message}`);
    return;
  }

  console.error(`WASM compiled: ${compileResult.message}`);

  // Run simulation via WASM runner
  profiler.start("simulation");
  const scalarVars = fmuResult.scalarVariables.map((sv) => ({
    name: sv.name,
    valueReference: sv.valueReference,
    causality: sv.causality,
  }));

  const result = await runWasmSimulation(compileResult.wasm.buffer as ArrayBuffer, compileResult.jsGlue, scalarVars, {
    startTime,
    stopTime,
    stepSize: step,
  });
  profiler.end("simulation");

  if (args.memoryProfile && lastSnap) {
    const snap = snapshotMemory(true);
    memProfiles["simulation"] = { before: lastSnap, after: snap };
  }

  if (result.error) {
    console.error(`WASM simulation error: ${result.error}`);
    return;
  }

  // Convert WASM result format (column-major trajectories) to row-major
  const times = result.times;
  const names = result.variableNames;
  const y = times.map((_t: number, i: number) =>
    names.map((_n: string, j: number) => result.trajectories[j]?.[i] ?? 0),
  );

  outputResults(times, y, names, args.format);
}

// ── C Engine ──

async function simulateC(
  dae: ModelicaDAE,
  args: SimulateArgs,
  profiler: Profiler,
  startTime: number,
  stopTime: number,
  step: number,
  memProfiles: Record<string, unknown>,
  lastSnap: MemorySnapshot | null,
): Promise<void> {
  const simulator = new ModelicaSimulator(dae);
  simulator.prepare();

  const modelIdentifier = args.name.replace(/\./g, "_");
  const fmuResult = generateFmu(dae, { modelIdentifier, generationTool: "ModelScript CLI" }, simulator.stateVars);

  // Generate standalone C simulation source
  profiler.start("codegen");
  const cSource = generateSimulationC(dae, fmuResult, {
    modelIdentifier,
    startTime,
    stopTime,
    stepSize: step,
  });
  profiler.end("codegen");

  // Compile
  profiler.start("compilation");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-sim-"));
  const cFile = path.join(tmpDir, `${modelIdentifier}_sim.c`);
  const binFile = path.join(tmpDir, `${modelIdentifier}_sim`);

  fs.writeFileSync(cFile, cSource);

  const cc = process.env.CC ?? "gcc";
  const ccCmd = [cc, "-O3", "-Wall", cFile, "-o", binFile, "-lm"].join(" ");

  try {
    execSync(ccCmd, { stdio: "pipe", timeout: 30000 });
  } catch (e: unknown) {
    const stderr = e && typeof e === "object" && "stderr" in e ? String((e as { stderr: unknown }).stderr) : String(e);
    console.error(`C compilation failed:\n${stderr}`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return;
  }
  profiler.end("compilation");

  if (args.memoryProfile && lastSnap) {
    const snap = snapshotMemory(true);
    memProfiles["codegen"] = { before: lastSnap, after: snap };
    lastSnap = snap;
  }

  console.error(`Compiled: ${cc} -O3 → ${binFile}`);

  // Execute the compiled binary and capture stdout
  profiler.start("simulation");
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(binFile, [], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`Simulation binary exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
    child.on("error", reject);
  });
  profiler.end("simulation");

  if (args.memoryProfile && lastSnap) {
    const snap = snapshotMemory(true);
    memProfiles["simulation"] = { before: lastSnap, after: snap };
  }

  // Clean up temp files
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // The C binary outputs CSV to stdout — relay it or convert to JSON
  if (args.format === "json") {
    // Parse the CSV output and convert to JSON
    const lines = output.trim().split("\n");
    const header = lines[0]?.split(",") ?? [];
    const rows = lines.slice(1).map((line) => {
      const values = line.split(",");
      const row: Record<string, number> = {};
      for (let i = 0; i < header.length; i++) {
        row[header[i] as string] = parseFloat(values[i] ?? "0");
      }
      return row;
    });
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
  } else {
    // Already CSV — write directly
    process.stdout.write(output);
  }
}

// ── Output helpers ──

function outputResults(t: number[], y: number[][], varNames: string[], format: string): void {
  if (format === "json") {
    const rows = t.map((time: number, i: number) => {
      const row: Record<string, number> = { time };
      varNames.forEach((name: string, vIndex: number) => {
        row[name] = y[i]?.[vIndex] ?? 0;
      });
      return row;
    });
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
  } else {
    const header = ["time", ...varNames].join(",");
    process.stdout.write(header + "\n");
    for (let i = 0; i < t.length; i++) {
      const values = [t[i], ...varNames.map((_: string, vIndex: number) => y[i]?.[vIndex] ?? 0)];
      process.stdout.write(values.join(",") + "\n");
    }
  }
}
