// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FmuOptions } from "@modelscript/core";
import {
  Context,
  ModelicaDAE,
  ModelicaFlattener,
  ModelicaLinter,
  ModelicaSimulator,
  generateFmu,
} from "@modelscript/core";
import Modelica from "@modelscript/tree-sitter-modelica";
import fs from "node:fs";
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
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const ExportFmu: CommandModule<{}, ExportFmuArgs> = {
  command: "export-fmu <name> <paths..>",
  describe: "Export a Modelica model as an FMI 2.0 Co-Simulation FMU model description",
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
        description: "output file path (default: <name>.fmu.xml)",
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

    // Generate FMU model description
    const fmuOptions: FmuOptions = {
      modelIdentifier: args.name.replace(/\./g, "_"),
      description: args.description,
      generationTool: "ModelScript CLI",
      startTime: args.startTime ?? args["start-time"],
      stopTime: args.stopTime ?? args["stop-time"],
      stepSize: args.stepSize ?? args["step-size"],
    };

    const result = generateFmu(dae, fmuOptions, simulator.stateVars);

    // Write output
    const outputPath = args.output ?? `${args.name.replace(/\./g, "_")}.fmu.xml`;
    fs.writeFileSync(outputPath, result.modelDescriptionXml, "utf-8");

    console.log(`FMU model description written to: ${outputPath}`);
    console.log(`  Variables: ${result.scalarVariables.length}`);
    console.log(`  Outputs: ${result.modelStructure.outputs.length}`);
    console.log(`  Derivatives: ${result.modelStructure.derivatives.length}`);
    console.log(`  Initial unknowns: ${result.modelStructure.initialUnknowns.length}`);
  },
};
