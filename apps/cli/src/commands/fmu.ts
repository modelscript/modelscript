// SPDX-License-Identifier: AGPL-3.0-or-later

import { initBltWasm } from "@modelscript/compiler";
import { ArenaSimulator } from "@modelscript/compiler/simulator";
import { Context } from "@modelscript/core";
import {
  type FmuArchiveOptions,
  FMI2_FUNCTIONS_H,
  FMI2_FUNCTION_TYPES_H,
  FMI2_TYPES_PLATFORM_H,
  buildFmuArchive,
  compileToWasm,
  generateFmu,
  generateFmuCSources,
  generateFmuWasmSource,
} from "@modelscript/fmi";
import Modelica from "@modelscript/modelica/parser";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";
import { Profiler } from "../util/timing.js";

interface FmuArgs {
  name: string;
  paths: string[];
  output?: string;
  description?: string;
  "start-time"?: number;
  startTime?: number;
  "stop-time"?: number;
  stopTime?: number;
  "step-size"?: number;
  stepSize?: number;
  "xml-only"?: boolean;
  xmlOnly?: boolean;
  type?: string;
  source?: boolean;
  compile?: boolean;
  "fmi-version": string;
  wasm: boolean;
  timing: boolean;
}

export const Fmu: CommandModule<{}, FmuArgs> = {
  command: "fmu <name> <paths..>",
  aliases: ["export-fmu"], // Keep old name for backward compatibility
  describe: "Export a Modelica model as an FMU archive",

  builder: ((yargs: any) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "name of class to export",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "paths of libraries and modules to load",
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
        description: "default experiment step size",
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
      .option("timing", {
        description: "report timing information for each stage as JSON to stderr",
        type: "boolean",
        default: false,
      });
  }) as any,

  handler: async (args) => {
    const profiler = new Profiler();
    const parser = new Parser();
    parser.setLanguage(Modelica);

    Context.registerParser(".mo", parser as any);
    const context = Context.createBatch(new NodeFileSystem());

    profiler.start("parsing");
    for (const p of args.paths) await context.addLibrary(p);
    profiler.end("parsing");

    // Flatten the model
    profiler.start("flattening");
    const arena = context.flattenArena(args.name);
    profiler.end("flattening");

    if (!arena) {
      console.error(`'${args.name}' not found or had flattening errors.`);
      return;
    }

    await initBltWasm();

    // Prepare simulator to get state variable info
    const simulator = new ArenaSimulator(arena);
    simulator.prepare();

    const stateVars = new Set<string>();
    for (const varIdx of simulator.stateVars) {
      stateVars.add(arena.getVarName(varIdx));
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
    const archiveOptions: FmuArchiveOptions = {
      modelIdentifier,
      description: args.description,
      generationTool: "ModelScript CLI",
      startTime,
      stopTime,
      stepSize,
      fmuType,
      includeSources: args.source !== false,
      includeModelJson: true,
      fmiVersion: fmiVersionStr,
    };

    profiler.start("codegen");
    let result = buildFmuArchive(arena, archiveOptions, stateVars);
    profiler.end("codegen");

    const outputPath = args.output ?? `${modelIdentifier}.fmu`;

    // ── Compile WASM ──
    if (args.wasm) {
      profiler.start("compilation_wasm");
      const wasmSource = generateFmuWasmSource(arena, result.fmuResult, archiveOptions);
      const compileResult = await compileToWasm(wasmSource.wasmC, modelIdentifier, wasmSource.exportedFunctions);
      profiler.end("compilation_wasm");

      if (compileResult.success && compileResult.wasm && compileResult.jsGlue) {
        archiveOptions.includeWasm = true;
        archiveOptions.wasmBinary = compileResult.wasm;
        archiveOptions.wasmJsGlue = compileResult.jsGlue;
        // Re-build archive to include WASM files
        profiler.start("codegen");
        result = buildFmuArchive(arena, archiveOptions, stateVars);
        profiler.end("codegen");
        console.log(`  Compiled WebAssembly module.`);
      } else {
        console.error(`WASM compilation failed: ${compileResult.message}`);
      }
    }

    // ── Compile Native C ──
    if (args.compile) {
      profiler.start("compilation_c");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-fmu-"));
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
        const cc = process.env.CC ?? "gcc";
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
          fs.writeFileSync(outputPath, result.archive);
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
