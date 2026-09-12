// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateFmu } from "@modelscript/exchange/fmu";
import { Context } from "@modelscript/modelica/context";
import { createWasmParser } from "@modelscript/modelica/parser";
import { initBltWasm, type DAEBuilder } from "@modelscript/runtime";
import { simulateArena, simulateArenaAsync, snapshotMemory, type MemorySnapshot } from "@modelscript/simulate";
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";
import { Profiler } from "../util/timing.js";
import { generateSimulationC } from "./sim-c-codegen.js";

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

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

export const Simulate: CommandModule<{}, SimulateArgs> = {
  command: "simulate <name> <paths..>",
  describe: "Simulate a Modelica model and output results",

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
        choices: ["csv", "json", "none"],
        default: "csv",
      })
      .option("solver", {
        description: "ODE solver to use",
        type: "string",
        choices: ["euler", "rk4", "dopri5", "bdf", "auto", "cvode"],
        default: "dopri5",
      })
      .option("realtime", {
        description: "run simulation in real-time mode with given scale factor (e.g., 1.0 for 1x)",
        type: "number",
      })
      .option("engine", {
        description:
          "simulation backend: js (pure JavaScript), arena (arena-native DoD), wasm (WebAssembly via emcc), c (native compiled)",
        type: "string",
        choices: ["js", "arena", "wasm", "c"],
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
  }) as CommandModule<{}, SimulateArgs>["builder"],
  handler: async (args) => {
    const profiler = new Profiler();
    const { parser } = await createWasmParser(modelicaWasmPath);

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

    // Flatten the model
    profiler.start("flattening");
    const arena = context.flattenArena(args.name);
    profiler.end("flattening");

    if (args.memoryProfile && lastSnap) {
      const snap = snapshotMemory(true);
      memProfiles["flattening"] = { before: lastSnap, after: snap };
      lastSnap = snap;
    }

    await initBltWasm();

    if (!arena) {
      console.error(`'${args.name}' not found or had flattening errors.`);
      return;
    }

    const exp = arena.experiment;
    const startTime = args.startTime ?? exp.startTime ?? 0;
    const stopTime = args.stopTime ?? exp.stopTime ?? 10;
    const step = args.interval ?? exp.interval ?? (stopTime - startTime) / 1000;

    switch (args.engine) {
      case "wasm":
        await simulateWasm(arena, args, profiler, startTime, stopTime, step, memProfiles, lastSnap);
        break;
      case "c":
        await simulateC(arena, args, profiler, startTime, stopTime, step, memProfiles, lastSnap);
        break;
      case "arena":
        await simulateArenaEngine(arena, args, profiler, startTime, stopTime, step, memProfiles, lastSnap);
        break;
      case "js":
      default:
        simulateJs(arena, args, profiler, startTime, stopTime, step, memProfiles, lastSnap);
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
  const solver = args.solver as "euler" | "rk4" | "dopri5" | "bdf" | "auto" | "cvode";
  const result = simulateArena(arena, {
    startTime,
    stopTime,
    step,
    solver,
    outputStringIds,
  });

  profiler.end("simulation");

  if (args.memoryProfile && lastSnap) {
    const snap = snapshotMemory(true);
    memProfiles["simulation"] = { before: lastSnap, after: snap };
  }

  outputResults(result.t, result.y, result.states, args.format);
}

// ── Arena Engine ──

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

  const solver = args.solver as "euler" | "rk4" | "dopri5" | "bdf" | "auto" | "cvode";
  const opts: any = {
    startTime,
    stopTime,
    step,
    solver,
    outputStringIds,
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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-wasm-"));
  const cFile = path.join(tmpDir, `${modelIdentifier}_sim.c`);
  const jsFile = path.join(tmpDir, `${modelIdentifier}_sim.js`);

  fs.writeFileSync(cFile, cSource);

  const emcc = process.env.EMCC ?? "emcc";
  const optFlag = arena.eqCount >= 2000 ? "-O0" : arena.eqCount >= 500 ? "-O1" : "-O3";
  let cvodeFlags = "";
  if (isCvode) {
    const sundialsInstall = path.resolve(
      path.dirname(require.resolve("@modelscript/dsl/package.json")),
      ".build/sundials/install",
    );
    cvodeFlags = [
      `-I${path.join(sundialsInstall, "include")}`,
      path.join(sundialsInstall, "lib/libsundials_cvode.a"),
      path.join(sundialsInstall, "lib/libsundials_nvecserial.a"),
      path.join(sundialsInstall, "lib/libsundials_core.a"),
    ].join(" ");
  }

  const emccCmd = [
    emcc,
    optFlag,
    "-w",
    cFile,
    cvodeFlags,
    "-s ALLOW_MEMORY_GROWTH=1",
    "-s NODEJS_CATCH_EXIT=0",
    "-o",
    jsFile,
  ]
    .filter(Boolean)
    .join(" ");

  try {
    execSync(emccCmd, { stdio: "pipe", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  } catch (e: unknown) {
    const stderr = e && typeof e === "object" && "stderr" in e ? String((e as { stderr: unknown }).stderr) : String(e);
    console.error(`WASM compilation failed:\n${stderr}`);
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
}

// ── C Engine ──

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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-sim-"));
  const cFile = path.join(tmpDir, `${modelIdentifier}_sim.c`);
  const binFile = path.join(tmpDir, `${modelIdentifier}_sim`);

  fs.writeFileSync(cFile, cSource);

  const cc = process.env.CC ?? "gcc";
  const optFlag = arena.eqCount >= 2000 ? "-O0" : arena.eqCount >= 500 ? "-O1 -fno-tree-vectorize" : "-O3";
  const cvodeFlags = isCvode
    ? "-I/usr/include/omc/sundials -L/usr/lib/x86_64-linux-gnu/omc -Wl,-rpath=/usr/lib/x86_64-linux-gnu/omc -lsundials_cvode -lsundials_nvecserial"
    : "";
  const ccCmd = [cc, optFlag, "-w", cFile, cvodeFlags, "-o", binFile, "-lm"].filter(Boolean).join(" ");

  try {
    execSync(ccCmd, { stdio: "pipe", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  } catch (e: unknown) {
    const stderr = e && typeof e === "object" && "stderr" in e ? String((e as { stderr: unknown }).stderr) : String(e);
    console.error(`C compilation failed:\n${stderr}`);
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
}

// ── Output helpers ──

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
