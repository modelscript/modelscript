// SPDX-License-Identifier: AGPL-3.0-or-later

import { formatFmuSimulateResult, generateFmu, simulateFmuArchive } from "@modelscript/exchange/fmu";
import { Context } from "@modelscript/modelica/context";
import { createWasmParser } from "@modelscript/modelica/parser";
import {
  foldArenaConstants,
  hasArrayEquations,
  initBltWasm,
  scalarizeArena,
  type DAEBuilder,
} from "@modelscript/runtime";
import { simulateArena, simulateArenaAsync, snapshotMemory, type MemorySnapshot } from "@modelscript/simulate";
import { execFileSync, execSync, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";
import { Profiler } from "../util/timing.js";
import { parseStartValueArgs } from "./fmu.js";
import { generateSimulationC } from "./sim-c-codegen.js";
import { simulateCloud } from "./simulate-cloud.js";

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

/** CLI arguments and flags for the `msx simulate` command. */
export interface SimulateArgs {
  /** Fully-qualified name of the Modelica/SysML class to simulate, or path to a `.fmu` archive. */
  name: string;
  /** Additional library or module file paths to load. */
  paths?: string[] | undefined;
  /** Optional output file path for writing simulation results. */
  output?: string | undefined;
  "start-time"?: number | undefined;
  /** Experiment start time override in seconds. */
  startTime?: number | undefined;
  "stop-time"?: number | undefined;
  /** Experiment stop time override in seconds. */
  stopTime?: number | undefined;
  /** Relative/absolute integration tolerance override. */
  tolerance?: number | undefined;
  /** Output communication interval / step size in seconds. */
  interval?: number | undefined;
  "step-size"?: number | undefined;
  stepSize?: number | undefined;
  "output-interval"?: number | undefined;
  outputInterval?: number | undefined;
  /** Output serialization format (`"csv"`, `"json"`, or `"none"`). */
  format: string;
  /** Numerical ODE/DAE solver algorithm name (`"dopri5"`, `"cvode"`, `"bdf"`, `"rodas4p"`, etc.). */
  solver: string;
  /** Real-time pacing scale factor (e.g., `1.0` for 1x wall-clock speed). */
  realtime?: number | undefined;
  /** Simulation execution backend (`"js"`, `"arena"`, `"wasm"`, `"c"`, or `"jit"`). */
  engine: string;
  /** Whether to emit stage timing metrics as JSON to stderr. */
  timing?: boolean | undefined;
  "memory-profile"?: boolean | undefined;
  /** Whether to profile heap/linear-memory consumption across compilation and simulation phases. */
  memoryProfile?: boolean | undefined;
  /** Jacobian evaluation strategy (`"dense"`, `"sparse"`, or `"fd"`). */
  jacobian: "dense" | "sparse" | "fd";
  /** Flattener backend (`"ts"`, `"wasm"`, `"hybrid"`, or `"diff"`). */
  flattener?: "ts" | "wasm" | "hybrid" | "diff" | undefined;
  "steady-state"?: boolean | undefined;
  /** Whether to solve only the initial steady-state equilibrium without time integration. */
  steadyState?: boolean | undefined;
  /** Whether to use the in-memory JIT compilation engine. */
  jit?: boolean | undefined;

  // FMU direct simulation options
  "interface-type"?: "cs" | "me" | "auto" | undefined;
  /** FMI interface mode (`"cs"` Co-Simulation, `"me"` Model Exchange, or `"auto"`). */
  interfaceType?: "cs" | "me" | "auto" | undefined;
  "start-value"?: string[] | undefined;
  /** Variable start-value overrides (`name=value`). */
  startValue?: string[] | undefined;
  "input-file"?: string | undefined;
  /** Path to a CSV file containing time-varying input trajectories. */
  inputFile?: string | undefined;
  "output-variable"?: string[] | undefined;
  /** Specific variable names to record in FMU simulation output. */
  outputVariable?: string[] | undefined;
  "initial-fmu-state-file"?: string | undefined;
  /** Path to a serialized FMU state file to restore before integration. */
  initialFmuStateFile?: string | undefined;
  "final-fmu-state-file"?: string | undefined;
  /** Path where the final serialized FMU state should be saved after integration. */
  finalFmuStateFile?: string | undefined;
  "log-fmi-calls"?: boolean | undefined;
  /** Whether to log all FMI C API calls and diagnostic callbacks to stderr. */
  logFmiCalls?: boolean | undefined;

  // Cloud bursting options
  /** Whether to dispatch the simulation job to the ModelScript Cloud HPC cluster. */
  cloud?: boolean | undefined;
  /** Cloud compute profile (`"standard"`, `"high-memory"`, `"gpu-a100"`, `"hpc-mpi-64"`). */
  profile?: string | undefined;
  /** Whether to submit the cloud job asynchronously and return the Job ID immediately. */
  async?: boolean | undefined;
  "poll-interval"?: number | undefined;
  /** Polling interval in milliseconds when waiting for cloud simulation completion. */
  pollInterval?: number | undefined;
  "output-dir"?: string | undefined;
  /** Local directory for downloaded cloud simulation result artifacts. */
  outputDir?: string | undefined;
  "api-url"?: string | undefined;
  /** Override base URL for the ModelScript Cloud API server. */
  apiUrl?: string | undefined;
}

/**
 * `msx simulate <name> [paths..]` CLI command module supporting Modelica, SysML v2, and FMU
 * simulation across JS, linear-memory Arena, Emscripten WASM, native C, JIT, and Cloud HPC backends.
 */
export const Simulate: CommandModule<{}, SimulateArgs> = {
  command: "simulate <name> [paths..]",
  describe: "Simulate a Modelica model, SysML v2 system, or FMU archive and output results",

  builder: ((yargs: any) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "name of class to simulate, or path to a .fmu archive",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: false,
        description: "paths of libraries and modules to load",
        type: "string",
      })
      .option("output", {
        alias: "o",
        description: "output file path for simulation results",
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
        alias: ["step-size", "output-interval"],
        description: "override experiment output interval / step size",
        type: "number",
      })
      .option("format", {
        description: "output format",
        type: "string",
        choices: ["csv", "json", "none"],
        default: "csv",
      })
      .option("solver", {
        description: "ODE solver to use",
        type: "string",
        choices: ["euler", "rk4", "dopri5", "tsit5", "trbdf2", "rodas4p", "bdf", "auto", "cvode", "webgpu"],
        default: "dopri5",
      })
      .option("interface-type", {
        description: "FMI interface type when simulating an FMU: 'cs', 'me', or 'auto'",
        type: "string",
        choices: ["cs", "me", "auto"],
      })
      .option("start-value", {
        array: true,
        description: "override FMU variable start value as name=value (repeatable)",
        type: "string",
      })
      .option("input-file", {
        description: "CSV file providing time-varying input trajectories (time,u1,u2,...)",
        type: "string",
      })
      .option("output-variable", {
        array: true,
        description: "variable name(s) to record in FMU simulation output (repeatable)",
        type: "string",
      })
      .option("initial-fmu-state-file", {
        description: "restore serialized FMU state from file before stepping",
        type: "string",
      })
      .option("final-fmu-state-file", {
        description: "save serialized FMU state to file after simulation finishes",
        type: "string",
      })
      .option("log-fmi-calls", {
        description: "log all FMI C API calls and logger callbacks to stderr",
        type: "boolean",
        default: false,
      })
      .option("realtime", {
        description: "run simulation in real-time mode with given scale factor (e.g., 1.0 for 1x)",
        type: "number",
      })
      .option("engine", {
        description:
          "simulation backend: js (pure JavaScript), arena (arena-native DoD), wasm (WebAssembly via emcc), c (native compiled), jit (in-memory JIT)",
        type: "string",
        choices: ["js", "arena", "wasm", "c", "jit"],
        default: "js",
      })
      .option("jit", {
        description: "enable in-memory JIT compilation engine (sub-15ms execution)",
        type: "boolean",
        default: false,
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
      })
      .option("flattener", {
        alias: "F",
        choices: ["ts", "wasm", "hybrid", "diff"],
        default: "hybrid",
        description:
          "Flattener backend: 'ts' (reference TS), 'wasm' (zero-GC kernel), 'hybrid' (WASM with TS fallback), or 'diff' (parity comparison)",
        type: "string",
      })
      .option("steady-state", {
        description: "Solve steady-state initial equilibrium only without time integration",
        type: "boolean",
        default: false,
      })
      .option("cloud", {
        description: "dispatch simulation to ModelScript Cloud HPC cluster",
        type: "boolean",
        default: false,
      })
      .option("profile", {
        description: "cloud compute profile (standard, high-memory, gpu-a100, hpc-mpi-64)",
        type: "string",
        default: "standard",
      })
      .option("async", {
        description: "submit cloud job asynchronously and return immediately with Job ID",
        type: "boolean",
        default: false,
      })
      .option("poll-interval", {
        description: "polling interval in milliseconds for cloud simulation status",
        type: "number",
        default: 1500,
      })
      .option("output-dir", {
        description: "directory to write downloaded simulation result file",
        type: "string",
        default: "./results",
      })
      .option("api-url", {
        description: "override ModelScript API base URL",
        type: "string",
      });
  }) as CommandModule<{}, SimulateArgs>["builder"],
  handler: async (args) => {
    const fmuCandidate = args.name.endsWith(".fmu") ? args.name : args.paths?.find((p) => p.endsWith(".fmu"));
    if (fmuCandidate) {
      try {
        const meSolver = args.solver === "euler" || args.solver === "cvode" ? args.solver : "rk4";
        const simRes = await simulateFmuArchive(fmuCandidate, {
          interfaceType: args.interfaceType ?? args["interface-type"] ?? "auto",
          solver: meSolver,
          startTime: args.startTime ?? args["start-time"],
          stopTime: args.stopTime ?? args["stop-time"],
          stepSize:
            args.interval ?? args.stepSize ?? args["step-size"] ?? args.outputInterval ?? args["output-interval"],
          tolerance: args.tolerance,
          startValues: parseStartValueArgs(args.startValue ?? args["start-value"]),
          inputFile: args.inputFile ?? args["input-file"],
          outputVariables: args.outputVariable ?? args["output-variable"],
          initialStateFile: args.initialFmuStateFile ?? args["initial-fmu-state-file"],
          finalStateFile: args.finalFmuStateFile ?? args["final-fmu-state-file"],
          logFmiCalls: Boolean(args.logFmiCalls ?? args["log-fmi-calls"]),
        });
        const formatted = formatFmuSimulateResult(simRes, (args.format as "csv" | "json" | "none") ?? "csv");
        if (args.output) {
          fs.writeFileSync(path.resolve(args.output), formatted, "utf-8");
        } else if (formatted) {
          process.stdout.write(formatted);
        }
      } catch (err) {
        console.error(`FMU simulation failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
      return;
    }

    if (args.cloud) {
      await simulateCloud(args as any);
      return;
    }
    const paths = args.paths ?? [];
    if (paths.length === 0) {
      console.error("Error: Please provide at least one Modelica/SysML file or a .fmu archive.");
      process.exitCode = 1;
      return;
    }

    const profiler = new Profiler();
    const memProfiles: Record<string, unknown> = {};
    let lastSnap = args.memoryProfile ? snapshotMemory(true) : null;

    const isSysml = paths.some((p) => p.endsWith(".sysml") || p.endsWith(".kerml"));
    let arena: DAEBuilder | null = null;

    if (isSysml) {
      profiler.start("parsing");
      let combinedSource = "";
      for (const p of paths) {
        if (p.endsWith(".sysml") || p.endsWith(".kerml")) {
          combinedSource += fs.readFileSync(p, "utf-8") + "\n";
        }
      }
      profiler.end("parsing");

      profiler.start("flattening");
      const { SysML2DaeLowerer } = await import("@modelscript/sysml2");
      arena = await SysML2DaeLowerer.lowerSystem(combinedSource);
      profiler.end("flattening");
    } else {
      const { parser } = await createWasmParser(modelicaWasmPath);
      Context.registerParser(".mo", parser as any);
      const context = Context.createBatch(new NodeFileSystem());

      // Build mapping from absolute resolved paths to user-provided paths
      const pathMap = new Map<string, string>();
      for (const p of paths) {
        pathMap.set(path.resolve(p), p);
      }

      profiler.start("parsing");
      for (const p of paths) await context.addLibrary(p);
      profiler.end("parsing");

      if (args.memoryProfile && lastSnap) {
        const snap = snapshotMemory(true);
        memProfiles["parsing"] = { before: lastSnap, after: snap };
        lastSnap = snap;
      }

      // Flatten the model
      profiler.start("flattening");
      arena = context.flattenArena(args.name, undefined, undefined, {
        backend: args.flattener,
      });
      profiler.end("flattening");
    }

    if (arena) {
      let hasArrays = hasArrayEquations(arena);
      if (!hasArrays) {
        for (let i = 0; i < arena.varCount; i++) {
          if (arena.getVarShape(i).length > 0) {
            hasArrays = true;
            break;
          }
        }
      }
      if (hasArrays) {
        arena = scalarizeArena(arena, true);
        foldArenaConstants(arena);
      }
    }

    if (args.memoryProfile && lastSnap) {
      const snap = snapshotMemory(true);
      memProfiles["flattening"] = { before: lastSnap, after: snap };
      lastSnap = snap;
    }

    await initBltWasm();

    if (!arena) {
      console.error(`'${args.name}' not found or had flattening errors.`);
      process.exitCode = 1;
      return;
    }

    const exp = arena.experiment;
    const startTime = args.startTime ?? exp.startTime ?? 0;
    const stopTime = args.stopTime ?? exp.stopTime ?? 10;
    const step = args.interval ?? exp.interval ?? (stopTime - startTime) / 1000;

    try {
      if (args.jit) {
        args.engine = "jit";
      }
      switch (args.engine) {
        case "wasm":
          await simulateWasm(arena, args, profiler, startTime, stopTime, step, memProfiles, lastSnap);
          break;
        case "c":
          await simulateC(arena, args, profiler, startTime, stopTime, step, memProfiles, lastSnap);
          break;
        case "jit":
          await simulateJit(arena, args, profiler, startTime, stopTime, step, memProfiles, lastSnap);
          break;
        case "arena":
          await simulateArenaEngine(arena, args, profiler, startTime, stopTime, step, memProfiles, lastSnap);
          break;
        case "js":
        default:
          simulateJs(arena, args, profiler, startTime, stopTime, step, memProfiles, lastSnap);
          break;
      }
    } catch (err: unknown) {
      console.error(`Simulation failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }

    if (args.memoryProfile) {
      console.error(JSON.stringify({ memory: memProfiles }, null, 2));
    }

    if (args.timing) profiler.report();
  },
};

// ── JS Engine ──

/**
 * Executes synchronous JavaScript/Arena DAE simulation via `simulateArena` and formats trajectories to stdout.
 */
function simulateJs(
  arena: DAEBuilder,
  args: SimulateArgs,
  profiler: Profiler,
  startTime: number,
  stopTime: number,
  step: number,
  memProfiles: Record<string, unknown>,
  lastSnap: MemorySnapshot | null,
): void {
  profiler.start("simulation");

  const outputStringIds: number[] = [];
  for (let i = 0; i < arena.varCount; i++) {
    const name = arena.getVarName(i);
    if (!name.startsWith("$") && !name.startsWith("der(")) {
      outputStringIds.push(arena.getVarNameId(i));
    }
  }

  // Map CLI solver to simulateArena solver
  const solver = args.solver as
    | "euler"
    | "rk4"
    | "dopri5"
    | "tsit5"
    | "trbdf2"
    | "rodas4p"
    | "bdf"
    | "auto"
    | "cvode"
    | "webgpu";
  const result = simulateArena(arena, {
    startTime,
    stopTime,
    step,
    solver,
    outputStringIds,
    steadyStateOnly: Boolean(args["steady-state"] || args.steadyState),
  });

  profiler.end("simulation");

  if (args.memoryProfile && lastSnap) {
    const snap = snapshotMemory(true);
    memProfiles["simulation"] = { before: lastSnap, after: snap };
  }

  outputResults(result.t, result.y, result.states, args.format);
}

// ── Arena Engine ──

/**
 * Executes asynchronous linear-memory DAE simulation (supporting CVODE WASM and WebGPU solvers)
 * via `simulateArenaAsync`.
 */
async function simulateArenaEngine(
  arena: DAEBuilder,
  args: SimulateArgs,
  profiler: Profiler,
  startTime: number,
  stopTime: number,
  step: number,
  memProfiles: Record<string, unknown>,
  lastSnap: MemorySnapshot | null,
): Promise<void> {
  profiler.start("simulation");

  const outputStringIds: number[] = [];
  for (let i = 0; i < arena.varCount; i++) {
    const name = arena.getVarName(i);
    if (!name.startsWith("$") && !name.startsWith("der(")) {
      outputStringIds.push(arena.getVarNameId(i));
    }
  }

  const solver = args.solver as
    | "euler"
    | "rk4"
    | "dopri5"
    | "tsit5"
    | "trbdf2"
    | "rodas4p"
    | "bdf"
    | "auto"
    | "cvode"
    | "webgpu";
  const opts: any = {
    startTime,
    stopTime,
    step,
    solver,
    outputStringIds,
    steadyStateOnly: Boolean(args["steady-state"] || args.steadyState),
  };
  if (args.tolerance) {
    opts.atol = Number(args.tolerance);
    opts.rtol = Number(args.tolerance);
  }
  const result = await simulateArenaAsync(arena, opts);

  profiler.end("simulation");

  if (args.memoryProfile && lastSnap) {
    const snap = snapshotMemory(true);
    memProfiles["simulation"] = { before: lastSnap, after: snap };
  }

  outputResults(result.t, result.y, result.states, args.format);
}

// ── WASM Engine ──

/**
 * Generates standalone C simulation source from the DAE arena, compiles it to WebAssembly
 * via Emscripten (`emcc`), and runs the compiled module under Node.js.
 */
async function simulateWasm(
  arena: DAEBuilder,
  args: SimulateArgs,
  profiler: Profiler,
  startTime: number,
  stopTime: number,
  step: number,
  memProfiles: Record<string, unknown>,
  lastSnap: MemorySnapshot | null,
): Promise<void> {
  const modelIdentifier = args.name.replace(/\./g, "_");
  const fmuResult = generateFmu(arena, { modelIdentifier, generationTool: "ModelScript CLI" });
  const isCvode = args.solver === "cvode";

  // Generate standalone C simulation source
  profiler.start("codegen");
  const cSource = generateSimulationC(arena, fmuResult, {
    modelIdentifier,
    startTime,
    stopTime,
    stepSize: step,
    quiet: args.format === "none",
    solver: isCvode ? "cvode" : "rk4",
    tolerance: args.tolerance,
  });
  profiler.end("codegen");

  // Compile with Emscripten
  profiler.start("compilation");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-wasm-"));
  try {
    const cFile = path.join(tmpDir, `${modelIdentifier}_sim.c`);
    const jsFile = path.join(tmpDir, `${modelIdentifier}_sim.js`);

    fs.writeFileSync(cFile, cSource);

    const rawEmcc = process.env["EMCC"] ?? "emcc";
    const emcc = /^[a-zA-Z0-9_./-]+$/.test(rawEmcc) ? rawEmcc : "emcc";
    const optFlag = process.env["EMCC_CFLAGS"] ?? (process.env["CFLAGS"] ? process.env["CFLAGS"] : "-O3");
    const emccArgs: string[] = [...optFlag.split(/\s+/).filter(Boolean), "-w", cFile];
    if (isCvode) {
      const sundialsInstall = path.resolve(
        path.dirname(require.resolve("@modelscript/dsl/package.json")),
        ".build/sundials/install",
      );
      emccArgs.push(
        `-I${path.join(sundialsInstall, "include")}`,
        path.join(sundialsInstall, "lib/libsundials_cvode.a"),
        path.join(sundialsInstall, "lib/libsundials_nvecserial.a"),
        path.join(sundialsInstall, "lib/libsundials_core.a"),
      );
    }
    emccArgs.push("-s", "ALLOW_MEMORY_GROWTH=1", "-s", "NODEJS_CATCH_EXIT=0", "-o", jsFile);

    try {
      execFileSync(emcc, emccArgs, { stdio: "pipe", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    } catch (e: unknown) {
      const stderr =
        e && typeof e === "object" && "stderr" in e ? String((e as { stderr: unknown }).stderr) : String(e);
      console.error(`WASM compilation failed:\n${stderr}`);
      process.exitCode = 1;
      return;
    }
    profiler.end("compilation");

    if (args.memoryProfile && lastSnap) {
      const snap = snapshotMemory(true);
      memProfiles["codegen"] = { before: lastSnap, after: snap };
      lastSnap = snap;
    }

    console.error(`WASM compiled: ${emcc} ${optFlag} → ${jsFile}`);

    // Run simulation via Node
    profiler.start("simulation");
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn("node", [jsFile], { stdio: ["ignore", "pipe", "pipe"] });
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
          reject(new Error(`WASM simulation exited with code ${code}: ${stderr}`));
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

    if (args.format === "none") {
      // No output
    } else if (args.format === "json") {
      const lines = output.trim().split("\n");
      const header = lines[0]?.split(",") ?? [];
      const rows = lines.slice(1).map((l) => l.split(",").map(Number));
      const times = rows.map((r) => r[0] ?? 0);
      const y = rows.map((r) => r.slice(1));
      const varNames = header.slice(1);
      outputResults(times, y, varNames, "json");
    } else {
      process.stdout.write(output);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── JIT Engine ──

/**
 * Generates standalone C source from the DAE arena and executes it via the in-memory JIT engine (`simulateArenaJit`).
 */
async function simulateJit(
  arena: DAEBuilder,
  args: SimulateArgs,
  profiler: Profiler,
  startTime: number,
  stopTime: number,
  step: number,
  memProfiles: Record<string, unknown>,
  lastSnap: MemorySnapshot | null,
): Promise<void> {
  const modelIdentifier = args.name.replace(/\./g, "_");
  const fmuResult = generateFmu(arena, { modelIdentifier, generationTool: "ModelScript CLI" });

  profiler.start("codegen");
  const cSource = generateSimulationC(arena, fmuResult, {
    modelIdentifier,
    startTime,
    stopTime,
    stepSize: step,
    quiet: args.format === "none",
    solver: "rk4",
    tolerance: args.tolerance,
  });
  profiler.end("codegen");

  profiler.start("simulation");
  const { simulateArenaJit } = await import("@modelscript/simulate");
  const res = await simulateArenaJit(arena, {
    startTime,
    stopTime,
    step,
    cSource,
    modelName: modelIdentifier,
    mode: "auto",
  });
  profiler.end("simulation");

  if (args.timing) {
    console.error(
      `JIT (${res.modeUsed}) compile: ${res.compilationTimeMs.toFixed(2)}ms, exec: ${res.executionTimeMs.toFixed(2)}ms, total: ${res.totalTimeMs.toFixed(2)}ms, cacheHit: ${res.cacheHit}`,
    );
  }

  if (args.memoryProfile && lastSnap) {
    const snap = snapshotMemory(true);
    memProfiles["simulation"] = { before: lastSnap, after: snap };
  }

  outputResults(res.t, res.y, res.states, args.format);
}

// ── C Engine ──

/**
 * Generates standalone C simulation source from the DAE arena, compiles a native binary via `$CC` (`gcc`),
 * and executes the native binary to stream CSV/JSON trajectories.
 */
async function simulateC(
  arena: DAEBuilder,
  args: SimulateArgs,
  profiler: Profiler,
  startTime: number,
  stopTime: number,
  step: number,
  memProfiles: Record<string, unknown>,
  lastSnap: MemorySnapshot | null,
): Promise<void> {
  const modelIdentifier = args.name.replace(/\./g, "_");
  const fmuResult = generateFmu(arena, { modelIdentifier, generationTool: "ModelScript CLI" });
  const isCvode = args.solver === "cvode";

  // Generate standalone C simulation source
  profiler.start("codegen");
  const cSource = generateSimulationC(arena, fmuResult, {
    modelIdentifier,
    startTime,
    stopTime,
    stepSize: step,
    quiet: args.format === "none",
    solver: isCvode ? "cvode" : "rk4",
    tolerance: args.tolerance,
  });
  profiler.end("codegen");

  // Compile
  profiler.start("compilation");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-sim-"));
  try {
    const cFile = path.join(tmpDir, `${modelIdentifier}_sim.c`);
    const binFile = path.join(tmpDir, `${modelIdentifier}_sim`);

    fs.writeFileSync(cFile, cSource);

    const cc = process.env["CC"] ?? "gcc";
    const optFlag = process.env["CFLAGS"] ? process.env["CFLAGS"] : "-O3 -fno-math-errno";
    const cvodeFlags = isCvode
      ? "-I/usr/include/omc/sundials -L/usr/lib/x86_64-linux-gnu/omc -Wl,-rpath=/usr/lib/x86_64-linux-gnu/omc -lsundials_cvode -lsundials_nvecserial"
      : "";
    const ccCmd = [cc, optFlag, "-w", cFile, cvodeFlags, "-o", binFile, "-lm"].filter(Boolean).join(" ");

    try {
      execSync(ccCmd, { stdio: "pipe", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    } catch (e: unknown) {
      const stderr =
        e && typeof e === "object" && "stderr" in e ? String((e as { stderr: unknown }).stderr) : String(e);
      console.error(`C compilation failed:\n${stderr}`);
      process.exitCode = 1;
      return;
    }
    profiler.end("compilation");

    if (args.memoryProfile && lastSnap) {
      const snap = snapshotMemory(true);
      memProfiles["codegen"] = { before: lastSnap, after: snap };
      lastSnap = snap;
    }

    console.error(`Compiled: ${cc} ${optFlag} → ${binFile}`);

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

    // The C binary outputs CSV to stdout — relay it or convert to JSON
    if (args.format === "none") {
      // No output requested
    } else if (args.format === "json") {
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
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Output helpers ──

/**
 * Formats and writes time-series simulation trajectories (`t`, `y`, `varNames`) to `process.stdout`
 * as CSV or JSON.
 */
function outputResults(t: number[], y: number[][], varNames: string[], format: string): void {
  if (format === "none") return;
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
