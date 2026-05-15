// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaDAE, ModelicaFlattener } from "@modelscript/core";
import { generateRomWasmSource } from "@modelscript/fmi";
import Modelica from "@modelscript/modelica/parser";
import type { DoEInputRange } from "@modelscript/simulator";
import { ModelicaSimulator, buildSurrogate } from "@modelscript/simulator";
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

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Surrogate: CommandModule<{}, SurrogateArgs> = {
  command: "surrogate <name> <paths..>",
  describe: "Train an AI surrogate model (ROM) and generate WebAssembly C source",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  }) as CommandModule<{}, SurrogateArgs>["builder"],
  handler: async (args) => {
    const parser = new Parser();
    parser.setLanguage(Modelica);

    Context.registerParser(".mo", parser);
    const context = new Context(new NodeFileSystem());

    for (const p of args.paths) await context.addLibrary(p);
    const instance = context.query(args.name);
    if (!instance) {
      console.error(`'${args.name}' not found`);
      process.exit(1);
    }

    // Flatten the model
    const dae = new ModelicaDAE(instance.name ?? "DAE", instance.description);
    // @ts-expect-error - visitor type mismatch
    instance.accept(new ModelicaFlattener(), ["", dae]);

    const simulator = new ModelicaSimulator(dae);
    simulator.prepare();

    const inputNames = args.inputs.split(",").map((s) => s.trim());
    const outputNames = args.outputs.split(",").map((s) => s.trim());

    // Parse input bounds
    const inputRanges = new Map<string, DoEInputRange>();
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

    const exp = dae.experiment;
    const startTime = args.startTime ?? exp.startTime ?? 0;
    const stopTime = args.stopTime ?? exp.stopTime ?? 1;
    const stepSize = exp.interval ?? (stopTime - startTime) / 100;

    // FmuSubsystem adapter
    const fmuAdapter = {
      modelName: args.name,
      inputNames: Array.from(inputRanges.keys()),
      outputNames,
      parameterNames: [] as string[],
      _inputs: new Map<string, number>(),
      _outputs: new Map<string, number>(),
      initialize() {
        this._inputs.clear();
        this._outputs.clear();
      },
      setInputs(inputs: Map<string, number>) {
        for (const [k, v] of inputs) this._inputs.set(k, v);
      },
      doStep() {
        const overrides = new Map(this._inputs);
        const result = simulator.simulate(startTime, stopTime, stepSize, {
          solver: "dopri5" as const,
          equidistantOutput: false,
          parameterOverrides: overrides,
        });
        const lastY = result.y[result.y.length - 1];
        if (lastY) {
          for (let i = 0; i < result.states.length; i++) {
            this._outputs.set(result.states[i] ?? "", lastY[i] ?? 0);
          }
        }
      },
      getOutputs() {
        return new Map(this._outputs);
      },
      terminate() {
        this._inputs.clear();
        this._outputs.clear();
      },
    };

    console.error(`Training ${args.architecture.toUpperCase()} surrogate for ${args.name}...`);
    const surrogateResult = buildSurrogate(
      fmuAdapter,
      {
        doe: {
          inputs: inputRanges,
          outputs: outputNames,
          strategy: args.strategy,
          numSamples: args.numSamples,
          startTime,
          stopTime,
          stepSize,
        },
        rom: {
          architecture: args.architecture,
        },
      },
      (phase, progress, detail) => {
        console.error(`[${Math.round(progress)}%] ${phase}: ${detail}`);
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
