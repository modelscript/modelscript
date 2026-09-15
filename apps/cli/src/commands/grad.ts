// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/modelica/context";
import { createWasmParser } from "@modelscript/modelica/parser";
import { initBltWasm } from "@modelscript/runtime";
import { simulateGrad } from "@modelscript/simulate";
import { createRequire } from "node:module";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

interface GradArgs {
  name: string;
  paths: string[];
  params: string;
  target?: string;
  "start-time"?: number;
  startTime?: number;
  "stop-time"?: number;
  stopTime?: number;
  step?: number;
  json?: boolean;
}

export const Grad: CommandModule<{}, GradArgs> = {
  command: "grad <name> <paths..>",
  describe: "Compute exact parameter sensitivities through simulation using continuous adjoints",

  builder: ((yargs: any) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "name of model to differentiate",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "paths of libraries and modules to load",
        type: "string",
      })
      .option("params", {
        demandOption: true,
        description: "comma-separated list of parameter names to differentiate",
        type: "string",
      })
      .option("target", {
        description: "target state variable name to compute terminal sensitivity for (default: first state)",
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
      .option("step", {
        description: "communication step size",
        type: "number",
      })
      .option("json", {
        description: "output results as JSON",
        type: "boolean",
        default: false,
      });
  }) as CommandModule<{}, GradArgs>["builder"],

  handler: async (args) => {
    await initBltWasm();
    const { parser } = await createWasmParser(modelicaWasmPath);
    Context.registerParser(".mo", parser as any);

    const context = Context.createBatch(new NodeFileSystem());
    for (const p of args.paths) await context.addLibrary(p);

    const arena = context.flattenArena(args.name, undefined, undefined, { omcCompatibility: true });
    if (!arena) {
      console.error(`Error: '${args.name}' could not be flattened.`);
      process.exit(1);
    }

    const paramList = args.params.split(",").map((s) => s.trim());
    const exp = arena.experiment;
    const startTime = args.startTime ?? exp.startTime ?? 0;
    const stopTime = args.stopTime ?? exp.stopTime ?? 1;
    const step = args.step ?? exp.interval ?? (stopTime - startTime) / 200;

    const targetVar = args.target;

    const result = simulateGrad(arena, {
      startTime,
      stopTime,
      step,
      parametersToDifferentiate: paramList,
      terminalLoss: (states) => {
        const stateKey = targetVar ?? states.keys().next().value ?? "";
        const val = states.get(stateKey) ?? 0;
        return {
          loss: val,
          gradState: new Map([[stateKey, 1.0]]),
        };
      },
    });

    if (args.json) {
      const outObj = {
        model: args.name,
        loss: result.loss,
        gradients: Object.fromEntries(result.gradients.entries()),
      };
      console.log(JSON.stringify(outObj, null, 2));
    } else {
      console.log(`=== Continuous Adjoint Sensitivity for ${args.name} ===`);
      console.log(`Time Span: [${startTime}, ${stopTime}], Step: ${step}`);
      console.log(`Objective: terminal value of '${targetVar ?? "default state"}' = ${result.loss.toFixed(6)}\n`);
      console.log(`Gradients (dL/dp):`);
      for (const [param, grad] of result.gradients) {
        console.log(`  d(loss)/d(${param}) = ${grad >= 0 ? "+" : ""}${grad.toFixed(6)}`);
      }
    }
  },
};
