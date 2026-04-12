// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaDAE, ModelicaFlattener, ModelicaLinter } from "@modelscript/core";
import {
  type FmuArchiveOptions,
  FMI2_FUNCTIONS_H,
  FMI2_FUNCTION_TYPES_H,
  FMI2_TYPES_PLATFORM_H,
  buildFmuArchive,
  createZip,
  generateFmu,
  generateFmuCSources,
} from "@modelscript/fmi";
import { ModelicaSimulator } from "@modelscript/simulator";
import Modelica from "@modelscript/tree-sitter-modelica";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Parser, { type Range } from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

interface ExportFmuArgs {
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
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const ExportFmu: CommandModule<{}, ExportFmuArgs> = {
  command: "export-fmu <name> <paths..>",
  describe: "Export a Modelica model as an FMI 2.0 FMU (Model Exchange & Co-Simulation)",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any,

  handler: (args) => {
    const parser = new Parser();
    parser.setLanguage(Modelica);
    Context.registerParser(".mo", parser);
    const context = new Context(new NodeFileSystem());

    for (const p of args.paths) context.addLibrary(p);
    const instance = context.query(args.name);
    if (!instance) {
      console.error(`'${args.name}' not found`);
      return;
    }

    // Flatten the model
    const dae = new ModelicaDAE(instance.name ?? "DAE", instance.description);
    instance.accept(new ModelicaFlattener(), ["", dae]);

    // Run the linter
    const diagnostics: { type: string; code: number; message: string; resource: string | null; range: Range | null }[] =
      [];
    const linter = new ModelicaLinter(
      (
        type: string,
        code: number,
        message: string,
        resource: string | null | undefined,
        range: Range | null | undefined,
      ) => {
        diagnostics.push({ type, code, message, resource: resource ?? null, range: range ?? null });
      },
    );
    linter.lint(instance);

    // Build mapping for diagnostic paths
    const pathMap = new Map<string, string>();
    for (const p of args.paths) {
      pathMap.set(path.resolve(p), p);
    }
    const toUserPath = (absPath: string | null) => {
      if (!absPath) return "";
      for (const [resolved, userProvided] of pathMap) {
        if (absPath === resolved) return userProvided;
        if (absPath.startsWith(resolved + path.sep)) {
          return userProvided + absPath.slice(resolved.length);
        }
      }
      return absPath;
    };

    // Print diagnostics
    for (const d of diagnostics) {
      const severity = d.type.charAt(0).toUpperCase() + d.type.slice(1);
      const codeStr = d.code > 0 ? `[M${d.code}] ` : "";
      if (d.range) {
        const startPos = `${d.range.startPosition.row + 1}:${d.range.startPosition.column + 1}`;
        const endPos = `${d.range.endPosition.row + 1}:${d.range.endPosition.column + 1}`;
        const resource = toUserPath(d.resource);
        console.error(`[${resource}:${startPos}-${endPos}] ${severity}: ${codeStr}${d.message}`);
      } else {
        console.error(`${severity}: ${codeStr}${d.message}`);
      }
    }

    // Prepare simulator to get state variable info
    const simulator = new ModelicaSimulator(dae);
    simulator.prepare();

    // Extract experiment annotation from the DAE as fallback for CLI flags
    const exp = dae.experiment;
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
      // ── XML-only mode (original behavior) ──
      const result = generateFmu(
        dae,
        {
          modelIdentifier,
          description: args.description,
          generationTool: "ModelScript CLI",
          startTime,
          stopTime,
          stepSize,
          fmuType,
        },
        simulator.stateVars,
      );

      const outputPath = args.output ?? `${modelIdentifier}.fmu.xml`;
      fs.writeFileSync(outputPath, result.modelDescriptionXml, "utf-8");

      console.log(`FMU model description written to: ${outputPath}`);
      console.log(`  Variables: ${result.scalarVariables.length}`);
      console.log(`  Outputs: ${result.modelStructure.outputs.length}`);
      console.log(`  Derivatives: ${result.modelStructure.derivatives.length}`);
      console.log(`  Initial unknowns: ${result.modelStructure.initialUnknowns.length}`);
    } else {
      // ── Full FMU archive mode ──
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
      };

      const result = buildFmuArchive(dae, archiveOptions, simulator.stateVars);
      const outputPath = args.output ?? `${modelIdentifier}.fmu`;

      // ── Optional compilation ──
      if (args.compile) {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "msc-fmu-"));
        try {
          // Generate C sources to temp dir
          const sources = generateFmuCSources(dae, result.fmuResult, archiveOptions);
          const srcDir = path.join(tmpDir, "sources");
          fs.mkdirSync(srcDir, { recursive: true });
          fs.writeFileSync(path.join(srcDir, `${modelIdentifier}_model.h`), sources.modelH);
          fs.writeFileSync(path.join(srcDir, `${modelIdentifier}_model.c`), sources.modelC);
          fs.writeFileSync(path.join(srcDir, "fmi2Functions.c"), sources.fmi2FunctionsC);

          // Write FMI headers from archive
          const encoder = new TextEncoder();
          for (const [name, content] of Object.entries(FMI_HEADERS)) {
            fs.writeFileSync(path.join(srcDir, name), encoder.encode(content));
          }

          // Detect platform
          const arch = os.arch() === "x64" ? "64" : "32";
          const plat =
            process.platform === "win32"
              ? `win${arch}`
              : process.platform === "darwin"
                ? `darwin${arch}`
                : `linux${arch}`;
          const ext = process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so";

          // Compile
          const cc = process.env.CC ?? "gcc";
          const binDir = path.join(tmpDir, "binaries", plat);
          fs.mkdirSync(binDir, { recursive: true });
          const sharedLib = path.join(binDir, `${modelIdentifier}${ext}`);

          const ccCmd = [
            cc,
            "-shared",
            "-fPIC",
            "-O2",
            "-Wall",
            "-Wextra",
            `-I${srcDir}`,
            path.join(srcDir, `${modelIdentifier}_model.c`),
            path.join(srcDir, "fmi2Functions.c"),
            "-o",
            sharedLib,
            "-lm",
          ].join(" ");

          console.log(`Compiling with: ${cc}`);
          try {
            execSync(ccCmd, { stdio: "pipe" });
            console.log(`  Compiled: binaries/${plat}/${modelIdentifier}${ext}`);
          } catch (compileErr) {
            const msg =
              compileErr instanceof Error && "stderr" in compileErr
                ? (compileErr as { stderr: Buffer }).stderr.toString()
                : String(compileErr);
            console.error(`Compilation failed:\n${msg}`);
            fs.writeFileSync(outputPath, result.archive);
            return;
          }

          // Rebuild archive with the compiled binary
          const finalEntries = new Map<string, Uint8Array>();
          // Copy all original entries by reconstructing from the result
          finalEntries.set("modelDescription.xml", encoder.encode(result.fmuResult.modelDescriptionXml));
          if (archiveOptions.includeSources !== false) {
            finalEntries.set(`sources/${modelIdentifier}_model.h`, encoder.encode(sources.modelH));
            finalEntries.set(`sources/${modelIdentifier}_model.c`, encoder.encode(sources.modelC));
            finalEntries.set("sources/fmi2Functions.c", encoder.encode(sources.fmi2FunctionsC));
            finalEntries.set("sources/CMakeLists.txt", encoder.encode(sources.cmakeLists));
            for (const [name, content] of Object.entries(FMI_HEADERS)) {
              finalEntries.set(`sources/${name}`, encoder.encode(content));
            }
          }
          if (archiveOptions.includeModelJson !== false) {
            finalEntries.set("resources/model.json", encoder.encode(JSON.stringify(dae.toJSON, null, 2)));
          }
          finalEntries.set(`binaries/${plat}/${modelIdentifier}${ext}`, fs.readFileSync(sharedLib));

          fs.writeFileSync(outputPath, createZip(finalEntries));
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } else {
        fs.writeFileSync(outputPath, result.archive);
      }

      const types: string[] = [];
      if (fmuType.modelExchange) types.push("Model Exchange");
      if (fmuType.coSimulation) types.push("Co-Simulation");

      console.log(`FMU archive written to: ${outputPath}`);
      console.log(`  Type: ${types.join(" + ")}`);
      console.log(`  GUID: ${result.fmuResult.guid}`);
      console.log(`  Variables: ${result.fmuResult.scalarVariables.length}`);
      console.log(`  States: ${result.fmuResult.modelStructure.derivatives.length}`);
      const fileList = args.compile
        ? result.files.concat([
            `binaries/.../${modelIdentifier}${process.platform === "win32" ? ".dll" : process.platform === "darwin" ? ".dylib" : ".so"}`,
          ])
        : result.files;
      console.log(`  Files: ${fileList.length}`);
      for (const f of fileList) {
        console.log(`    ${f}`);
      }
    }
  },
};

/** FMI 2.0 header file map for compilation. */
const FMI_HEADERS: Record<string, string> = {
  "fmi2Functions.h": FMI2_FUNCTIONS_H,
  "fmi2TypesPlatform.h": FMI2_TYPES_PLATFORM_H,
  "fmi2FunctionTypes.h": FMI2_FUNCTION_TYPES_H,
};
