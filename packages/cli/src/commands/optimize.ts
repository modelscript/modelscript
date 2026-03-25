// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context, ModelicaDAE, ModelicaFlattener, ModelicaOptimizer } from "@modelscript/core";
import Modelica from "@modelscript/tree-sitter-modelica";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

interface OptimizeArgs {
  name: string;
  paths: string[];
  objective: string;
  controls: string;
  "control-bounds"?: string;
  controlBounds?: string;
  "start-time"?: number;
  startTime?: number;
  "stop-time"?: number;
  stopTime?: number;
  "num-intervals"?: number;
  numIntervals?: number;
  tolerance?: number;
  "max-iterations"?: number;
  maxIterations?: number;
  format: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Optimize: CommandModule<{}, OptimizeArgs> = {
  command: "optimize <name> <paths..>",
  describe: "Solve an optimal control problem for a Modelica model",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: ((yargs: any) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "name of class to optimize",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "paths of libraries and modules to load",
        type: "string",
      })
      .option("objective", {
        demandOption: true,
        description: 'cost integrand expression (e.g. "u^2")',
        type: "string",
      })
      .option("controls", {
        demandOption: true,
        description: "control variable names (comma-separated)",
        type: "string",
      })
      .option("control-bounds", {
        description: "control bounds as var:min:max (comma-separated)",
        type: "string",
      })
      .option("start-time", {
        description: "override start time",
        type: "number",
      })
      .option("stop-time", {
        description: "override stop time",
        type: "number",
      })
      .option("num-intervals", {
        description: "number of collocation intervals",
        type: "number",
        default: 50,
      })
      .option("tolerance", {
        description: "NLP convergence tolerance",
        type: "number",
        default: 1e-6,
      })
      .option("max-iterations", {
        description: "maximum SQP iterations",
        type: "number",
        default: 200,
      })
      .option("format", {
        description: "output format",
        type: "string",
        choices: ["csv", "json"],
        default: "csv",
      });
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  }) as CommandModule<{}, OptimizeArgs>["builder"],
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

    // Parse control names
    const controlNames = args.controls.split(",").map((s) => s.trim());

    // Parse control bounds
    const controlBounds = new Map<string, { min: number; max: number }>();
    if (args.controlBounds) {
      for (const part of args.controlBounds.split(",")) {
        const pieces = part.trim().split(":");
        if (pieces.length === 3 && pieces[0] && pieces[1] && pieces[2]) {
          controlBounds.set(pieces[0].trim(), {
            min: parseFloat(pieces[1]),
            max: parseFloat(pieces[2]),
          });
        }
      }
    }
    // Default bounds for controls without explicit bounds
    for (const name of controlNames) {
      if (!controlBounds.has(name)) {
        controlBounds.set(name, { min: -1e6, max: 1e6 });
      }
    }

    // Resolve experiment parameters
    const exp = dae.experiment;
    const startTime = args.startTime ?? exp.startTime ?? 0;
    const stopTime = args.stopTime ?? exp.stopTime ?? 10;
    const numIntervals = args.numIntervals ?? 50;

    // Run optimization
    const optimizer = new ModelicaOptimizer(dae, {
      objective: args.objective,
      controls: controlNames,
      controlBounds,
      startTime,
      stopTime,
      numIntervals,
      tolerance: args.tolerance,
      maxIterations: args.maxIterations,
    });
    const result = optimizer.optimize();

    // Print status
    console.error(result.messages);
    if (!result.success) {
      console.error("Optimization did not converge.");
    }

    // Output results
    if (args.format === "json") {
      const rows = result.t.map((t: number, i: number) => {
        const row: Record<string, number> = { time: t };
        for (const [name, vals] of result.states) row[name] = vals[i] ?? 0;
        for (const [name, vals] of result.controls) row[name] = vals[i] ?? 0;
        return row;
      });
      process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    } else {
      // CSV format
      const stateNames = Array.from(result.states.keys());
      const controlVarNames = Array.from(result.controls.keys());
      const header = ["time", ...stateNames, ...controlVarNames].join(",");
      process.stdout.write(header + "\n");
      for (let i = 0; i < result.t.length; i++) {
        const values = [
          result.t[i],
          ...stateNames.map((name) => result.states.get(name)?.[i] ?? 0),
          ...controlVarNames.map((name) => result.controls.get(name)?.[i] ?? 0),
        ];
        process.stdout.write(values.join(",") + "\n");
      }
    }
  },
};
