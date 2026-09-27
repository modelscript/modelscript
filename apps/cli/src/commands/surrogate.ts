import { generateRomWasmSource } from "@modelscript/exchange/fmu";
import { Context } from "@modelscript/modelica/context";
import { createWasmParser } from "@modelscript/modelica/parser";
import type { ArenaDoEInputRange, TrainedROM } from "@modelscript/simulate";
import { buildArenaSurrogate, emitModelicaROM, exportROMToONNX, importONNXToROM } from "@modelscript/simulate";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

interface SurrogateArgs {
  name: string;
  paths?: string[];
  inputs?: string;
  "input-bounds"?: string;
  inputBounds?: string;
  outputs?: string;
  strategy: "full-factorial" | "latin-hypercube" | "sobol" | "central-composite";
  "num-samples": number;
  numSamples: number;
  architecture: "mlp" | "polynomial" | "rbf";
  "start-time"?: number;
  startTime?: number;
  "stop-time"?: number;
  stopTime?: number;
  format: "c" | "onnx" | "mo" | "all";
  "from-onnx"?: string;
  fromOnnx?: string;
  "extrapolation-guardrails"?: boolean;
  extrapolationGuardrails?: boolean;
  "extrapolation-level"?: "warning" | "error";
  extrapolationLevel?: "warning" | "error";
  "extrapolation-flag"?: boolean;
  extrapolationFlag?: boolean;
  "out-file"?: string;
  outFile?: string;
  "replace-component"?: string;
  replaceComponent?: string;
  "replace-out"?: string;
  replaceOut?: string;
  report?: string;
}

export const Surrogate: CommandModule<{}, SurrogateArgs> = {
  command: "surrogate <name> [paths..]",
  describe: "Train or import an AI surrogate model (ROM) and generate C, ONNX, or Modelica code",

  builder: ((yargs: any) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "name of class or model for surrogate",
        type: "string",
      })
      .positional("paths", {
        array: true,
        description: "paths of libraries and modules to load",
        type: "string",
      })
      .option("inputs", {
        description: "input parameter names (comma-separated)",
        type: "string",
      })
      .option("input-bounds", {
        description: "input bounds as var:min:max (comma-separated)",
        type: "string",
      })
      .option("outputs", {
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
      .option("format", {
        description: "target export format: C/WASM ('c'), ONNX graph ('onnx'), Modelica block ('mo'), or all ('all')",
        choices: ["c", "onnx", "mo", "all"],
        default: "c",
      })
      .option("from-onnx", {
        description: "path to external ONNX JSON model file to import instead of training from Modelica source",
        type: "string",
      })
      .option("extrapolation-guardrails", {
        description: "embed Modelica assertion guardrails for input bounds",
        type: "boolean",
        default: true,
      })
      .option("extrapolation-level", {
        description: "severity level of Modelica extrapolation assertions",
        choices: ["warning", "error"],
        default: "warning",
      })
      .option("extrapolation-flag", {
        description: "emit Boolean isExtrapolating output variable in Modelica",
        type: "boolean",
        default: true,
      })
      .option("out-file", {
        description: "output file name (defaults to <model>_surrogate.<ext>)",
        type: "string",
      })
      .option("replace-component", {
        description: "name of component declaration in Modelica model to replace with surrogate",
        type: "string",
      })
      .option("replace-out", {
        description: "output path for modified Modelica model with replaced component",
        type: "string",
      })
      .option("report", {
        description: "output report JSON file",
        type: "string",
        default: "report.json",
      });
  }) as CommandModule<{}, SurrogateArgs>["builder"],
  handler: async (args) => {
    const modelId = args.name.replace(/\./g, "_");
    const inputBoundsMap: Record<string, { min: number; max: number }> = {};
    const inputRanges = new Map<string, ArenaDoEInputRange>();

    if (args.inputBounds) {
      for (const part of args.inputBounds.split(",")) {
        const pieces = part.trim().split(":");
        if (pieces.length >= 3 && pieces[0] && pieces[1] && pieces[2]) {
          const varName = pieces[0].trim();
          const min = parseFloat(pieces[1]);
          const max = parseFloat(pieces[2]);
          inputBoundsMap[varName] = { min, max };
          inputRanges.set(varName, { min, max });
        }
      }
    }

    let trainedROM: TrainedROM;
    let metrics: any;
    let totalWallClockMs = 0;

    if (args.fromOnnx) {
      console.error(`Importing ONNX surrogate model from ${args.fromOnnx}...`);
      const onnxStr = await fs.readFile(args.fromOnnx, "utf-8");
      const inputNames = args.inputs ? args.inputs.split(",").map((s) => s.trim()) : undefined;
      const outputNames = args.outputs ? args.outputs.split(",").map((s) => s.trim()) : undefined;

      const importOpts: {
        inputNames?: string[];
        outputNames?: string[];
        parameterBounds?: Record<string, { min: number; max: number }>;
      } = { parameterBounds: inputBoundsMap };
      if (inputNames) importOpts.inputNames = inputNames;
      if (outputNames) importOpts.outputNames = outputNames;

      trainedROM = importONNXToROM(onnxStr, importOpts);
      metrics = trainedROM.metrics;
      console.error(
        `Imported ONNX model '${modelId}' (Inputs: [${trainedROM.inputNames.join(", ")}], Outputs: [${trainedROM.outputNames.join(", ")}]).`,
      );
    } else {
      if (!args.paths || args.paths.length === 0) {
        console.error("Error: Positional [paths..] must be specified when training from Modelica source.");
        process.exit(1);
      }
      if (!args.inputs || !args.outputs) {
        console.error("Error: --inputs and --outputs must be specified when training from Modelica source.");
        process.exit(1);
      }

      const { parser } = await createWasmParser(modelicaWasmPath);
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

      // Default bounds for inputs without explicit bounds
      for (const name of inputNames) {
        if (!inputRanges.has(name)) {
          inputRanges.set(name, { min: -100, max: 100 });
          inputBoundsMap[name] = { min: -100, max: 100 };
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

      trainedROM = surrogateResult.trainedROM;
      trainedROM.parameterBounds = { ...trainedROM.parameterBounds, ...inputBoundsMap };
      metrics = surrogateResult.metrics;
      totalWallClockMs = surrogateResult.totalWallClockMs;

      console.error(`Complete. R² = ${metrics.r2.toFixed(4)}, MSE = ${metrics.trainMSE.toExponential(4)}`);
    }

    const format = args.format ?? "c";

    if (format === "c" || format === "all") {
      const wasmResult = generateRomWasmSource(trainedROM, modelId);
      const cFile = format === "c" && args.outFile ? args.outFile : `${modelId}_surrogate.c`;
      await fs.writeFile(cFile, wasmResult.wasmC);
      console.error(`Generated C source saved to ${cFile}`);
    }

    if (format === "onnx" || format === "all") {
      const onnxExport = exportROMToONNX(trainedROM, modelId);
      const onnxFile = format === "onnx" && args.outFile ? args.outFile : `${modelId}_surrogate.onnx.json`;
      await fs.writeFile(onnxFile, JSON.stringify(onnxExport, null, 2));
      console.error(`Generated ONNX model saved to ${onnxFile}`);
    }

    if (format === "mo" || format === "all") {
      const moContent = emitModelicaROM(trainedROM, {
        modelName: `${modelId}_Surrogate`,
        parameterBounds: inputBoundsMap,
        enableExtrapolationWarnings: args.extrapolationGuardrails ?? true,
        extrapolationLevel: args.extrapolationLevel ?? "warning",
        emitExtrapolationFlag: args.extrapolationFlag ?? true,
      });
      const moFile = format === "mo" && args.outFile ? args.outFile : `${modelId}_Surrogate.mo`;
      await fs.writeFile(moFile, moContent);
      console.error(`Generated Modelica surrogate block saved to ${moFile}`);
    }

    if (args.replaceComponent && args.paths && args.paths.length > 0) {
      const sourceFile = args.paths[0]!;
      const surrogateClassName = `${modelId}_Surrogate`;
      try {
        const sourceText = await fs.readFile(sourceFile, "utf-8");
        const compName = args.replaceComponent.trim();
        const declRegex = new RegExp(`(\\b)([A-Za-z0-9_.]+)(\\s+)(${compName})(\\s*(?:\\([^;]*\\))?\\s*;)`, "g");
        if (declRegex.test(sourceText)) {
          const updatedText = sourceText.replace(declRegex, `$1${surrogateClassName}$3$4$5`);
          const targetFile = args.replaceOut ?? sourceFile.replace(/\.mo$/, "_surrogatized.mo");
          await fs.writeFile(targetFile, updatedText, "utf-8");
          console.error(
            `Successfully surrogatized component '${compName}' in ${sourceFile} -> ${targetFile} (new type: ${surrogateClassName})`,
          );
        } else {
          console.error(`Warning: Component declaration '${compName}' not found in ${sourceFile}.`);
        }
      } catch (err: any) {
        console.error(`Failed to replace component: ${err.message}`);
      }
    }

    const reportFile = args.report ?? "report.json";
    const reportData = {
      model: modelId,
      mse: metrics?.trainMSE,
      valMSE: metrics?.valMSE,
      r2: metrics?.r2,
      lossCurve: trainedROM.lossCurve ?? [],
      hyperparameters: {
        architecture: trainedROM.architecture,
        layers: trainedROM.weights.type === "mlp" ? trainedROM.weights.layers.length : undefined,
      },
      parameterBounds: trainedROM.parameterBounds ?? inputBoundsMap,
      numSamples: args.numSamples,
      wallClockMs: totalWallClockMs,
    };
    await fs.writeFile(reportFile, JSON.stringify(reportData, null, 2));
    console.error(`Generated report saved to ${reportFile}`);
  },
};
