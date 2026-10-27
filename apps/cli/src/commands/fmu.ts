// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  type FmuArchiveOptions,
  FMI2_FUNCTIONS_H,
  FMI2_FUNCTION_TYPES_H,
  FMI2_TYPES_PLATFORM_H,
  buildFmuArchive,
  buildSourceFmuArchive,
  compileAsToWasm,
  compileToWasm,
  formatFmuSimulateResult,
  generateFmu,
  generateFmuAsSources,
  generateFmuCSources,
  generateFmuWasmSource,
  inspectFmuArchive,
  simulateFmuArchive,
  validateFmuArchive,
} from "@modelscript/exchange/fmu";
import { Context } from "@modelscript/modelica/context";
import { createWasmParser } from "@modelscript/modelica/parser";
import { ExprKind, foldArenaConstants, hasArrayEquations, initBltWasm, scalarizeArena } from "@modelscript/runtime";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";
import { Profiler } from "../util/timing.js";

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

/** CLI arguments and flags for the `msx fmu` command. */
interface FmuArgs {
  /** Modelica class name to export, or FMU subcommand (`"import"`, `"validate"`, `"info"`, `"list"`, `"build"`, `"simulate"`). */
  name: string;
  /** Library/module paths to load, or `.fmu` archive path when running a subcommand. */
  paths?: string[] | undefined;
  /** Output file path for the generated `.fmu` or `.fmu.xml`. */
  output?: string | undefined;
  /** Human-readable model description string embedded in `modelDescription.xml`. */
  description?: string | undefined;
  "start-time"?: number | undefined;
  /** Default experiment start time in seconds. */
  startTime?: number | undefined;
  "stop-time"?: number | undefined;
  /** Default experiment stop time in seconds. */
  stopTime?: number | undefined;
  "step-size"?: number | undefined;
  /** Default experiment communication step size in seconds. */
  stepSize?: number | undefined;
  "output-interval"?: number | undefined;
  outputInterval?: number | undefined;
  /** Solver relative tolerance. */
  tolerance?: number | undefined;
  "xml-only"?: boolean | undefined;
  /** Whether to emit only `modelDescription.xml` without building a ZIP archive. */
  xmlOnly?: boolean | undefined;
  /** FMU capability type (`"me"` Model Exchange, `"cs"` Co-Simulation, or `"both"`). */
  type?: string | undefined;
  "interface-type"?: "cs" | "me" | "auto" | undefined;
  /** FMI interface mode when simulating an FMU (`"cs"`, `"me"`, or `"auto"`). */
  interfaceType?: "cs" | "me" | "auto" | undefined;
  /** ODE solver when simulating an FMU in Model Exchange mode (`"euler"`, `"rk4"`, `"cvode"`). */
  solver?: string | undefined;
  "start-value"?: string[] | undefined;
  /** Variable start-value overrides (`name=value`). */
  startValue?: string[] | undefined;
  "input-file"?: string | undefined;
  /** CSV file providing time-varying input trajectories. */
  inputFile?: string | undefined;
  "output-variable"?: string[] | undefined;
  /** Variable names to record in simulation output. */
  outputVariable?: string[] | undefined;
  "initial-fmu-state-file"?: string | undefined;
  /** Serialized FMU state file to restore before stepping. */
  initialFmuStateFile?: string | undefined;
  "final-fmu-state-file"?: string | undefined;
  /** File path where serialized FMU state is saved after simulation. */
  finalFmuStateFile?: string | undefined;
  "log-fmi-calls"?: boolean | undefined;
  /** Whether to log all FMI C API calls and logger callbacks to stderr. */
  logFmiCalls?: boolean | undefined;
  /** Simulation output format (`"csv"`, `"json"`, or `"none"`). */
  format?: "csv" | "json" | "none" | undefined;
  /** Export target (`"wasm"`, `"c"`, `"js"`, or `"all"`). */
  target?: "wasm" | "c" | "js" | "all" | undefined;
  /** Whether to include generated C source files in `sources/` inside the FMU archive. */
  source?: boolean | undefined;
  /** Whether to compile C sources into a platform-native shared library (`.so`/`.dylib`/`.dll`). */
  compile?: boolean | undefined;
  /** FMI standard version (`"2"`, `"3"`, or `"both"`). */
  "fmi-version": string;
  /** Whether to compile the model to WebAssembly and include it in the FMU archive. */
  wasm: boolean;
  /** Whether to report stage timing metrics as JSON to stderr. */
  timing: boolean;
  /** Flattener backend (`"ts"`, `"wasm"`, `"hybrid"`, or `"diff"`). */
  flattener?: "ts" | "wasm" | "hybrid" | "diff" | undefined;
  /** Path to golden CSV trajectory for verification. */
  golden?: string | undefined;
}

/**
 * Parses repeatable `--start-value name=value` CLI arguments into a typed map of boolean,
 * numeric, or string overrides.
 */
export function parseStartValueArgs(raw?: string | string[]): Record<string, number | string | boolean> {
  const result: Record<string, number | string | boolean> = {};
  if (!raw) return result;
  const items = Array.isArray(raw) ? raw : [raw];
  for (const item of items) {
    const eqIdx = item.indexOf("=");
    if (eqIdx === -1) continue;
    const key = item.slice(0, eqIdx).trim();
    const valStr = item.slice(eqIdx + 1).trim();
    if (!key) continue;
    if (valStr === "true") result[key] = true;
    else if (valStr === "false") result[key] = false;
    else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(valStr)) result[key] = Number(valStr);
    else result[key] = valStr.replace(/^['"]|['"]$/g, "");
  }
  return result;
}

/**
 * `msx fmu <name> [paths..]` CLI command module for exporting FMI 2.0/3.0 FMU archives
 * (with C, JS, WASM, and native binaries) as well as validating, inspecting, building, and simulating FMUs.
 */
export const Fmu: CommandModule<{}, FmuArgs> = {
  command: "fmu <name> [paths..]",
  aliases: ["export-fmu"], // Keep old name for backward compatibility
  describe: "Export, validate, inspect, build, or simulate an FMU archive",

  builder: ((yargs: Argv) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "class name to export, or subcommand ('import', 'validate', 'info', 'list', 'build', 'simulate')",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: false,
        description: "paths of libraries/modules to load, or .fmu path when using a subcommand",
        type: "string",
      })
      .option("output", {
        alias: "o",
        description: "output file path (default: <name>.fmu or <name>.fmu.xml)",
        type: "string",
      })
      .option("description", {
        description: "model description string",
        type: "string",
      })
      .option("start-time", {
        description: "default experiment start time",
        type: "number",
      })
      .option("stop-time", {
        description: "default experiment stop time",
        type: "number",
      })
      .option("step-size", {
        alias: ["output-interval"],
        description: "default experiment step size / output interval",
        type: "number",
      })
      .option("tolerance", {
        description: "solver relative tolerance",
        type: "number",
      })
      .option("xml-only", {
        description: "output only the modelDescription.xml (no archive)",
        type: "boolean",
        default: false,
      })
      .option("type", {
        description: "FMU type: 'me' (Model Exchange), 'cs' (Co-Simulation), 'both' (default)",
        type: "string",
        default: "both",
        choices: ["me", "cs", "both"],
      })
      .option("interface-type", {
        description: "FMI interface type when simulating an FMU: 'cs', 'me', or 'auto'",
        type: "string",
        choices: ["cs", "me", "auto"],
      })
      .option("solver", {
        description: "ODE solver when simulating an FMU in Model Exchange mode ('euler', 'rk4', 'cvode')",
        type: "string",
        default: "rk4",
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
        description: "variable name(s) to record in simulation output (repeatable)",
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
      .option("format", {
        description: "simulation output format ('csv', 'json', 'none')",
        type: "string",
        choices: ["csv", "json", "none"],
        default: "csv",
      })
      .option("target", {
        description: "export target: 'wasm' (WebAssembly), 'c' (C sources), 'js' (JavaScript), or 'all' (multi-target)",
        type: "string",
        default: "all",
        choices: ["wasm", "c", "js", "all"],
      })
      .option("source", {
        description: "include C source files in the FMU archive",
        type: "boolean",
        default: true,
      })
      .option("compile", {
        description: "compile C sources into a shared library using the system C compiler",
        type: "boolean",
        default: false,
      })
      .option("fmi-version", {
        description: "FMI version to include: '2', '3', or 'both'",
        type: "string",
        default: "both",
        choices: ["2", "3", "both"],
      })
      .option("wasm", {
        description: "compile model to WebAssembly and include in the FMU archive",
        type: "boolean",
        default: false,
      })
      .option("flattener", {
        alias: "F",
        choices: ["ts", "wasm", "hybrid", "diff"],
        default: "hybrid",
        description:
          "Flattener backend: 'ts' (reference TS), 'wasm' (zero-GC kernel), 'hybrid' (WASM with TS fallback), or 'diff' (parity comparison)",
        type: "string",
      })
      .option("golden", {
        description: "path to golden CSV trajectory for 'verify' subcommand",
        type: "string",
      })
      .option("timing", {
        description: "report timing information for each stage as JSON to stderr",
        type: "boolean",
        default: false,
      });
  }) as CommandModule<{}, FmuArgs>["builder"],

  handler: async (args) => {
    const fmuSubcommands = new Set(["import", "validate", "info", "list", "build", "simulate", "record", "verify"]);
    if (fmuSubcommands.has(args.name)) {
      const fmuTarget = args.paths?.[0];
      if (!fmuTarget) {
        console.error(`Error: Please provide the path to the .fmu file (e.g. msx fmu ${args.name} <path.fmu>)`);
        process.exitCode = 1;
        return;
      }

      if (args.name === "import") {
        const { runImportFmu } = await import("./import-fmu.js");
        const code = await runImportFmu({
          fmu: fmuTarget,
          output: args.output,
          verbose: false,
        });
        if (code !== 0) process.exitCode = code;
        return;
      }

      const absPath = path.resolve(fmuTarget);
      if (!fs.existsSync(absPath)) {
        console.error(`Error: FMU archive not found at '${absPath}'`);
        process.exitCode = 1;
        return;
      }

      if (args.name === "validate") {
        const res = validateFmuArchive(fs.readFileSync(absPath));
        console.log(`Validating FMU: ${absPath}`);
        if (res.modelDescription) {
          console.log(`  Model: ${res.modelDescription.modelName} (FMI ${res.modelDescription.fmiVersion})`);
        }
        for (const w of res.warnings) {
          console.warn(`  [WARN ${w.code}] ${w.message}`);
        }
        for (const e of res.errors) {
          console.error(`  [ERROR ${e.code}] ${e.message}`);
        }
        if (res.valid) {
          console.log(`Validation PASSED (${res.warnings.length} warning(s), 0 errors).`);
        } else {
          console.error(`Validation FAILED (${res.errors.length} error(s), ${res.warnings.length} warning(s)).`);
          process.exitCode = 1;
        }
        return;
      }

      if (args.name === "info") {
        const info = inspectFmuArchive(fs.readFileSync(absPath));
        console.log(`FMU Information: ${path.basename(absPath)}`);
        console.log(`  FMI Version:     ${info.fmiVersion}`);
        console.log(`  Model Name:      ${info.modelName}`);
        console.log(`  GUID / Token:    ${info.guid}`);
        if (info.generationTool) console.log(`  Generation Tool: ${info.generationTool}`);
        if (info.description) console.log(`  Description:     ${info.description}`);
        console.log(
          `  Interfaces:      ${info.interfaces.map((i) => `${i.type} (${i.modelIdentifier})`).join(", ") || "None"}`,
        );
        console.log(`  Platforms:       ${info.platforms.join(", ") || "None (source/WASM/JS only)"}`);
        console.log(
          `  Artifacts:       sources=${info.hasSources}, buildDescription=${info.hasBuildDescription}, wasm=${info.hasWasm}, js=${info.hasJs}`,
        );
        if (info.defaultExperiment) {
          const de = info.defaultExperiment;
          console.log(
            `  Experiment:      startTime=${de.startTime ?? 0}, stopTime=${de.stopTime ?? 1}, stepSize=${de.stepSize ?? "auto"}, tolerance=${de.tolerance ?? "default"}`,
          );
        }
        console.log(
          `  Variables:       ${info.counts.total} total (${info.counts.inputs} inputs, ${info.counts.outputs} outputs, ${info.counts.parameters} parameters, ${info.counts.states} states, ${info.counts.eventIndicators} event indicators)`,
        );
        return;
      }

      if (args.name === "list") {
        const info = inspectFmuArchive(fs.readFileSync(absPath));
        console.log("VR\tType\tCausality\tVariability\tStart\tName");
        for (const v of info.variables) {
          console.log(
            `${v.valueReference}\t${v.type}\t${v.causality}\t${v.variability}\t${v.start !== undefined ? String(v.start) : "-"}\t${v.name}`,
          );
        }
        return;
      }

      if (args.name === "build") {
        try {
          const built = buildSourceFmuArchive(fs.readFileSync(absPath));
          const outPath = args.output ? path.resolve(args.output) : absPath;
          fs.writeFileSync(outPath, built.archive);
          console.log(`Built native shared library '${built.binaryPath}' (${built.platform}) -> ${outPath}`);
        } catch (err) {
          console.error(`Error building source FMU: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
        }
        return;
      }

      if (args.name === "simulate") {
        try {
          const interfaceType =
            args.interfaceType ??
            args["interface-type"] ??
            (args.type === "me" || args.type === "cs" ? (args.type as "me" | "cs") : "auto");
          const simRes = await simulateFmuArchive(absPath, {
            interfaceType,
            solver: args.solver,
            startTime: args.startTime ?? args["start-time"],
            stopTime: args.stopTime ?? args["stop-time"],
            stepSize: args.stepSize ?? args["step-size"] ?? args.outputInterval ?? args["output-interval"],
            tolerance: args.tolerance,
            startValues: parseStartValueArgs(args.startValue ?? args["start-value"]),
            inputFile: args.inputFile ?? args["input-file"],
            outputVariables: args.outputVariable ?? args["output-variable"],
            initialStateFile: args.initialFmuStateFile ?? args["initial-fmu-state-file"],
            finalStateFile: args.finalFmuStateFile ?? args["final-fmu-state-file"],
            logFmiCalls: Boolean(args.logFmiCalls ?? args["log-fmi-calls"]),
          });
          const formatted = formatFmuSimulateResult(simRes, args.format ?? "csv");
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

      if (args.name === "record") {
        try {
          const simRes = await simulateFmuArchive(absPath, {
            startTime: args.startTime ?? args["start-time"],
            stopTime: args.stopTime ?? args["stop-time"],
            stepSize: args.stepSize ?? args["step-size"] ?? args.outputInterval ?? args["output-interval"],
            inputFile: args.inputFile ?? args["input-file"],
            outputVariables: args.outputVariable ?? args["output-variable"],
          });
          const formatted = formatFmuSimulateResult(simRes, "csv");
          const defaultOut = `${path.basename(absPath, ".fmu")}_golden.csv`;
          const targetOut = args.output ? path.resolve(args.output) : path.resolve(path.dirname(absPath), defaultOut);
          fs.writeFileSync(targetOut, formatted, "utf-8");
          console.log(`Recorded golden trajectory (${simRes.t.length} steps) -> ${targetOut}`);
        } catch (err) {
          console.error(`FMU golden recording failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
        }
        return;
      }

      if (args.name === "verify") {
        try {
          const goldenPath = args.golden ?? args.inputFile ?? args["input-file"];
          if (!goldenPath || !fs.existsSync(path.resolve(goldenPath))) {
            console.error(`Error: Golden CSV file not found. Provide --golden <path.csv>`);
            process.exitCode = 1;
            return;
          }
          const goldenRaw = fs.readFileSync(path.resolve(goldenPath), "utf-8");
          const goldenLines = goldenRaw.split(/\r?\n/).filter((l) => l.trim().length > 0);
          if (goldenLines.length < 2) {
            console.error(`Error: Golden CSV file is empty or missing headers`);
            process.exitCode = 1;
            return;
          }

          const simRes = await simulateFmuArchive(absPath, {
            startTime: args.startTime ?? args["start-time"],
            stopTime: args.stopTime ?? args["stop-time"],
            stepSize: args.stepSize ?? args["step-size"] ?? args.outputInterval ?? args["output-interval"],
          });

          // Build variable column index map
          const varIdxMap = new Map<string, number>();
          simRes.varNames.forEach((name, idx) => varIdxMap.set(name, idx));

          // Verify RMSE against golden lines
          const tol = args.tolerance ?? 1e-3;
          let maxError = 0.0;
          let sumSqErr = 0.0;
          let count = 0;

          const headers = (goldenLines[0] ?? "").split(",").map((h) => h.trim());
          const numSteps = Math.min(goldenLines.length - 1, simRes.t.length);

          for (let i = 1; i <= numSteps; i++) {
            const vals = (goldenLines[i] ?? "").split(",").map((v) => parseFloat(v.trim()));
            const simIdx = i - 1;
            const simRow = simRes.values[simIdx];
            for (let c = 1; c < headers.length; c++) {
              const colName = headers[c];
              if (!colName) continue;
              const goldenVal = vals[c] ?? 0.0;
              const colIdx = varIdxMap.get(colName);
              const simVal = colIdx !== undefined && simRow ? Number(simRow[colIdx] ?? 0.0) : 0.0;
              const diff = Math.abs(simVal - goldenVal);
              sumSqErr += diff * diff;
              if (diff > maxError) maxError = diff;
              count++;
            }
          }

          const rmse = count > 0 ? Math.sqrt(sumSqErr / count) : 0.0;
          if (rmse <= tol) {
            console.log(`Golden Parity Verification PASSED:`);
            console.log(`  RMSE: ${rmse.toExponential(4)} (tolerance: ${tol})`);
            console.log(`  Max Absolute Error: ${maxError.toExponential(4)}`);
            console.log(`  Steps Verified: ${numSteps}`);
          } else {
            console.error(`Golden Parity Verification FAILED:`);
            console.error(`  RMSE: ${rmse.toExponential(4)} exceeds tolerance: ${tol}`);
            console.error(`  Max Absolute Error: ${maxError.toExponential(4)}`);
            process.exitCode = 1;
          }
        } catch (err) {
          console.error(`FMU verification failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
        }
        return;
      }
    }

    if (!args.paths || args.paths.length === 0) {
      console.error("Error: Please provide at least one Modelica file or library path.");
      process.exitCode = 1;
      return;
    }

    const profiler = new Profiler();
    const { parser } = await createWasmParser(modelicaWasmPath);

    Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
    const context = Context.createBatch(new NodeFileSystem());

    profiler.start("parsing");
    for (const p of args.paths) await context.addLibrary(p);
    profiler.end("parsing");

    // Flatten the model
    profiler.start("flattening");
    let arena = context.flattenArena(args.name, undefined, undefined, {
      arrayMode: "scalarize",
      backend: args.flattener,
    });
    profiler.end("flattening");

    if (!arena) {
      console.error(`'${args.name}' not found or had flattening errors.`);
      process.exitCode = 1;
      return;
    }

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

    await initBltWasm();

    // Identify state variables from der() expressions
    const stateVars = new Set<string>();
    for (let i = 0; i < arena.exprCount; i++) {
      if (arena.getExprKind(i) === ExprKind.Der) {
        const argId = arena.getExprData1(i);
        if (arena.getExprKind(argId) === ExprKind.Name) {
          const name = arena.interner.resolve(arena.getExprData1(argId));
          if (name) stateVars.add(name);
        }
      }
    }

    // Extract experiment annotation from the DAE as fallback for CLI flags
    const exp = arena.experiment;
    const startTime = args.startTime ?? args["start-time"] ?? exp.startTime;
    const stopTime = args.stopTime ?? args["stop-time"] ?? exp.stopTime;
    const stepSize = args.stepSize ?? args["step-size"] ?? exp.interval;

    // FMU type flags
    const fmuType = {
      modelExchange: args.type === "me" || args.type === "both",
      coSimulation: args.type === "cs" || args.type === "both",
    };

    const modelIdentifier = args.name.replace(/\./g, "_");

    if (args.xmlOnly || args["xml-only"]) {
      // ── XML-only mode ──
      profiler.start("codegen");
      const result = generateFmu(
        arena,
        {
          modelIdentifier,
          description: args.description,
          generationTool: "ModelScript CLI",
          startTime,
          stopTime,
          stepSize,
          fmuType,
        },
        stateVars,
      );
      profiler.end("codegen");

      const outputPath = args.output ?? `${modelIdentifier}.fmu.xml`;
      fs.writeFileSync(outputPath, result.modelDescriptionXml, "utf-8");

      console.log(`FMU model description written to: ${outputPath}`);
      console.log(`  Variables: ${result.scalarVariables.length}`);
      console.log(`  Outputs: ${result.modelStructure.outputs.length}`);
      console.log(`  Derivatives: ${result.modelStructure.derivatives.length}`);
      console.log(`  Initial unknowns: ${result.modelStructure.initialUnknowns.length}`);
      if (args.timing) profiler.report();
      return;
    }

    // ── Full FMU archive mode ──
    const fmiVersionStr =
      String(args["fmi-version"]) === "3" ? "3" : String(args["fmi-version"]) === "2" ? "2" : "both";
    const target = args.target ?? (args.wasm ? "wasm" : "all");
    const archiveOptions: FmuArchiveOptions = {
      modelIdentifier,
      description: args.description,
      generationTool: "ModelScript CLI",
      startTime,
      stopTime,
      stepSize,
      fmuType,
      target,
      includeSources:
        target === "c" || target === "all" || (args.source !== false && target !== "wasm" && target !== "js"),
      includeModelJson: true,
      fmiVersion: fmiVersionStr,
    };

    profiler.start("codegen");
    let result = buildFmuArchive(arena, archiveOptions, stateVars);
    profiler.end("codegen");

    const outputPath = args.output ?? `${modelIdentifier}.fmu`;

    // ── Compile WASM ──
    if (args.wasm || target === "wasm" || target === "all") {
      profiler.start("compilation_wasm");
      const asSource = generateFmuAsSources(arena, result.fmuResult, archiveOptions);
      const asCompileResult = await compileAsToWasm(asSource, modelIdentifier, { optimize: true });

      if (asCompileResult.success && asCompileResult.wasm) {
        archiveOptions.includeWasm = true;
        archiveOptions.wasmBinary = asCompileResult.wasm;
        profiler.start("codegen");
        result = buildFmuArchive(arena, archiveOptions, stateVars);
        profiler.end("codegen");
        console.log(`  Compiled WebAssembly module via native AssemblyScript (${asCompileResult.wasm.length} bytes).`);
      } else {
        // Fallback to C / Emscripten if AssemblyScript failed
        const wasmSource = generateFmuWasmSource(arena, result.fmuResult, archiveOptions);
        const compileResult = await compileToWasm(wasmSource.wasmC, modelIdentifier, wasmSource.exportedFunctions);
        if (compileResult.success && compileResult.wasm && compileResult.jsGlue) {
          archiveOptions.includeWasm = true;
          archiveOptions.wasmBinary = compileResult.wasm;
          archiveOptions.wasmJsGlue = compileResult.jsGlue;
          profiler.start("codegen");
          result = buildFmuArchive(arena, archiveOptions, stateVars);
          profiler.end("codegen");
          console.log(`  Compiled WebAssembly module via Emscripten.`);
        }
      }
      profiler.end("compilation_wasm");
    }

    // ── Compile Native C ──
    if (args.compile) {
      profiler.start("compilation_c");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-fmu-"));
      try {
        // Generate C sources to temp dir
        const sources = generateFmuCSources(arena, result.fmuResult, archiveOptions);
        const srcDir = path.join(tmpDir, "sources");
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, `${modelIdentifier}_model.h`), sources.modelH);
        fs.writeFileSync(path.join(srcDir, `${modelIdentifier}_model.c`), sources.modelC);
        const fmi2c = path.join(srcDir, "fmi2Functions.c");
        const fmi3c = path.join(srcDir, "fmi3Functions.c");
        if (archiveOptions.fmiVersion === "2" || archiveOptions.fmiVersion === "both") {
          fs.writeFileSync(fmi2c, sources.fmi2FunctionsC);
        }
        if (archiveOptions.fmiVersion === "3" || archiveOptions.fmiVersion === "both") {
          fs.writeFileSync(fmi3c, sources.fmi3FunctionsC);
        }

        // Write FMI headers from archive
        const encoder = new TextEncoder();
        for (const [name, content] of Object.entries(FMI_HEADERS)) {
          fs.writeFileSync(path.join(srcDir, name), encoder.encode(content));
        }

        const arch2 = os.arch() === "x64" ? "64" : "32";
        const plat2 =
          process.platform === "win32"
            ? `win${arch2}`
            : process.platform === "darwin"
              ? `darwin${arch2}`
              : `linux${arch2}`;
        const arch3 = os.arch() === "x64" ? "x86_64" : os.arch() === "arm64" ? "aarch64" : "x86";
        const plat3 =
          process.platform === "win32"
            ? `${arch3}-windows`
            : process.platform === "darwin"
              ? `${arch3}-darwin`
              : `${arch3}-linux`;
        const ext = process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so";

        // Compile
        const cc = process.env["CC"] ?? "gcc";
        // Just build to temp dir first
        const sharedLib = path.join(tmpDir, `${modelIdentifier}${ext}`);

        const ccCmd = [
          cc,
          "-shared",
          "-fPIC",
          "-O2",
          "-Wall",
          "-Wextra",
          `-I${srcDir}`,
          path.join(srcDir, `${modelIdentifier}_model.c`),
          archiveOptions.fmiVersion === "2" || archiveOptions.fmiVersion === "both" ? fmi2c : "",
          archiveOptions.fmiVersion === "3" || archiveOptions.fmiVersion === "both" ? fmi3c : "",
          "-o",
          sharedLib,
          "-lm",
          "-pthread",
        ]
          .filter(Boolean)
          .join(" ");

        console.log(`Compiling with: ${ccCmd}`);
        try {
          execSync(ccCmd, { stdio: "pipe", timeout: 60000 });
          console.log(`  Compiled native binary`);
        } catch (compileErr) {
          const msg =
            compileErr instanceof Error && "stderr" in compileErr
              ? (compileErr as { stderr: Buffer }).stderr.toString()
              : String(compileErr);
          console.error(`Compilation failed:\n${msg}`);
          process.exitCode = 1;
          profiler.end("compilation_c");
          if (args.timing) profiler.report();
          return;
        }

        const binData = fs.readFileSync(sharedLib);
        archiveOptions.nativeBinaries = [];
        if (archiveOptions.fmiVersion === "2" || archiveOptions.fmiVersion === "both") {
          archiveOptions.nativeBinaries.push({ platform: plat2, ext, binary: binData });
        }
        if (archiveOptions.fmiVersion === "3" || archiveOptions.fmiVersion === "both") {
          archiveOptions.nativeBinaries.push({ platform: plat3, ext, binary: binData });
        }

        console.log("FMI VERSION: ", archiveOptions.fmiVersion);
        console.log(
          "NATIVE BINARIES: ",
          archiveOptions.nativeBinaries.map((b) => b.platform),
        );

        // Re-build archive to include native binaries properly
        profiler.start("codegen");
        result = buildFmuArchive(arena, archiveOptions, stateVars);
        profiler.end("codegen");

        fs.writeFileSync(outputPath, result.archive);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        profiler.end("compilation_c");
      }
    } else {
      fs.writeFileSync(outputPath, result.archive);
    }

    const types: string[] = [];
    if (fmuType.modelExchange) types.push("Model Exchange");
    if (fmuType.coSimulation) types.push("Co-Simulation");

    console.log(`FMU archive written to: ${outputPath}`);
    console.log(`  Type: ${types.join(" + ")}`);
    console.log(`  Version: ${args["fmi-version"] === "both" ? "2.0 and 3.0" : args["fmi-version"] + ".0"}`);
    console.log(`  GUID: ${result.fmuResult.guid}`);
    console.log(`  Variables: ${result.fmuResult.scalarVariables.length}`);
    console.log(`  States: ${result.fmuResult.modelStructure.derivatives.length}`);

    if (args.timing) profiler.report();
  },
};

/** FMI 2.0 header file map for compilation. */
const FMI_HEADERS: Record<string, string> = {
  "fmi2Functions.h": FMI2_FUNCTIONS_H,
  "fmi2TypesPlatform.h": FMI2_TYPES_PLATFORM_H,
  "fmi2FunctionTypes.h": FMI2_FUNCTION_TYPES_H,
};
