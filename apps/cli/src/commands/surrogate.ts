// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ArenaDoEInputRange } from "@modelscript/compiler/simulator";
import { buildArenaSurrogate } from "@modelscript/compiler/simulator";
import { Context } from "@modelscript/core";
import { generateRomWasmSource } from "@modelscript/fmi";
import Modelica from "@modelscript/modelica/parser";
import fs from "node:fs/promises";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

interface SurrogateArgs {
  name: string;
  paths: string[];
  inputs: string;
  "input-bounds"?: string;
  inputBounds?: string;
  outputs: string;
  strategy: "full-factorial" | "latin-hypercube" | "sobol" | "central-composite";
  "num-samples": number;
  numSamples: number;
  architecture: "mlp" | "polynomial" | "rbf";
  "start-time"?: number;
  startTime?: number;
  "stop-time"?: number;
  stopTime?: number;
  "out-file"?: string;
  outFile?: string;
  report?: string;
}

export const Surrogate: CommandModule<{}, SurrogateArgs> = {
  command: "surrogate <name> <paths..>",
  describe: "Train an AI surrogate model (ROM) and generate WebAssembly C source",

  builder: ((yargs: any) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "name of class to train surrogate for",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "paths of libraries and modules to load",
        type: "string",
      })
      .option("inputs", {
        demandOption: true,
        description: "input parameter names (comma-separated)",
        type: "string",
      })
      .option("input-bounds", {
        description: "input bounds as var:min:max (comma-separated)",
        type: "string",
      })
      .option("outputs", {
        demandOption: true,
        description: "output variable names (comma-separated)",
        type: "string",
      })
      .option("strategy", {
        description: "Design of Experiments (DoE) sampling strategy",
        choices: ["full-factorial", "latin-hypercube", "sobol", "central-composite"],
        default: "latin-hypercube",
      })
      .option("num-samples", {
        description: "number of samples to generate",
        type: "number",
        default: 50,
      })
      .option("architecture", {
        description: "Reduced Order Model (ROM) architecture",
        choices: ["mlp", "polynomial", "rbf"],
        default: "mlp",
      })
      .option("start-time", {
        description: "override start time",
        type: "number",
      })
      .option("stop-time", {
        description: "override stop time",
        type: "number",
      })
      .option("out-file", {
        description: "output C file name",
        type: "string",
        default: "surrogate_wasm.c",
      })
      .option("report", {
        description: "output report JSON file",
        type: "string",
        default: "report.json",
      });
  }) as CommandModule<{}, SurrogateArgs>["builder"],
  handler: async (args) => {
    const parser = new Parser();
    parser.setLanguage(Modelica);

    Context.registerParser(".mo", parser as any);
    const context = Context.createBatch(new NodeFileSystem());

    for (const p of args.paths) await context.addLibrary(p);
    const arena = context.flattenArena(args.name);
    if (!arena) {
      console.error(`'${args.name}' not found or had flattening errors.`);
      process.exit(1);
    }

    const inputNames = args.inputs.split(",").map((s) => s.trim());
    const outputNames = args.outputs.split(",").map((s) => s.trim());

    // Parse input bounds
    const inputRanges = new Map<string, ArenaDoEInputRange>();
    if (args.inputBounds) {
      for (const part of args.inputBounds.split(",")) {
        const pieces = part.trim().split(":");
        if (pieces.length >= 3 && pieces[0] && pieces[1] && pieces[2]) {
          inputRanges.set(pieces[0].trim(), {
            min: parseFloat(pieces[1]),
            max: parseFloat(pieces[2]),
          });
        }
      }
    }
    // Default bounds for inputs without explicit bounds
    for (const name of inputNames) {
      if (!inputRanges.has(name)) {
        inputRanges.set(name, { min: -100, max: 100 });
      }
    }

    const exp = arena.experiment;
    const startTime = args.startTime ?? exp.startTime ?? 0;
    const stopTime = args.stopTime ?? exp.stopTime ?? 1;
    const stepSize = exp.interval ?? (stopTime - startTime) / 100;

    console.error(`Training ${args.architecture.toUpperCase()} surrogate for ${args.name}...`);
    const surrogateResult = buildArenaSurrogate(
      arena,
      {
        doe: {
          inputs: inputRanges,
          outputs: outputNames,
          strategy: args.strategy,
          numSamples: args.numSamples,
          simulateOptions: {
            startTime,
            stopTime,
            step: stepSize,
            solver: "dopri5",
          },
        },
        rom: {
          architecture: args.architecture,
        },
      },
      (phase, progress, detail) => {
        console.error(`[${Math.round(progress * 100)}%] ${phase}: ${detail}`);
      },
    );

    console.error(
      `Complete. R² = ${surrogateResult.metrics.r2.toFixed(4)}, MSE = ${surrogateResult.metrics.trainMSE.toExponential(4)}`,
    );

    const modelId = args.name.replace(/\./g, "_");
    const wasmResult = generateRomWasmSource(surrogateResult.trainedROM, modelId);

    const outFile = args.outFile ?? "surrogate_wasm.c";
    await fs.writeFile(outFile, wasmResult.wasmC);
    console.error(`Generated C source saved to ${outFile}`);

    const reportFile = args.report ?? "report.json";
    const reportData = {
      mse: surrogateResult.metrics.trainMSE,
      valMSE: surrogateResult.metrics.valMSE,
      r2: surrogateResult.metrics.r2,
      lossCurve: surrogateResult.trainedROM.lossCurve ?? [],
      hyperparameters: {
        architecture: args.architecture,
        layers:
          surrogateResult.trainedROM.weights.type === "mlp"
            ? surrogateResult.trainedROM.weights.layers.length
            : undefined,
      },
      numSamples: args.numSamples,
      wallClockMs: surrogateResult.totalWallClockMs,
    };
    await fs.writeFile(reportFile, JSON.stringify(reportData, null, 2));
    console.error(`Generated report saved to ${reportFile}`);
  },
};
