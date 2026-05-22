import { type Distribution, type RandomVariable, runMonteCarloArena } from "@modelscript/compiler/simulator";
import { Context } from "@modelscript/core";
import Modelica from "@modelscript/modelica/parser";
import fs from "node:fs/promises";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

interface McArgs {
  name: string;
  paths: string[];
  runs: number;
  threads: number;
  params: string;
  seed?: number;
  lhs: boolean;
  format: "csv" | "json";
  output?: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const MC: CommandModule<{}, McArgs> = {
  command: "mc <name> <paths..>",
  describe: "Run Monte Carlo simulation",
  builder: ((yargs: import("yargs").Argv) => {
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
      .option("runs", {
        description: "Number of Monte Carlo runs",
        type: "number",
        default: 1000,
      })
      .option("threads", {
        description: "Number of parallel threads",
        type: "number",
        default: 1,
      })
      .option("params", {
        description: "Random variables in format name:dist:arg1:arg2 (comma-separated)",
        type: "string",
        demandOption: true,
      })
      .option("seed", {
        description: "PRNG seed",
        type: "number",
      })
      .option("lhs", {
        description: "Use Latin Hypercube Sampling",
        type: "boolean",
        default: false,
      })
      .option("format", {
        description: "Output format",
        choices: ["csv", "json"],
        default: "json",
      })
      .option("output", {
        description: "Output file path (defaults to stdout if not provided)",
        type: "string",
      });
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  }) as CommandModule<{}, McArgs>["builder"],
  handler: async (args) => {
    const parser = new Parser();
    parser.setLanguage(Modelica);

    Context.registerParser(".mo", parser);
    const context = Context.createBatch(new NodeFileSystem());

    for (const p of args.paths) await context.addLibrary(p);
    const arena = context.flattenArena(args.name);
    if (!arena) {
      console.error(`'${args.name}' not found or had flattening errors.`);
      process.exit(1);
    }

    const exp = arena.experiment;
    const startTime = exp.startTime ?? 0;
    const stopTime = exp.stopTime ?? 10;
    const stepSize = exp.interval ?? (stopTime - startTime) / 100;

    // Parse params: e.g. e:gaussian:0.8:0.05
    const randomVars: RandomVariable[] = [];
    for (const part of args.params.split(",")) {
      const pieces = part.trim().split(":");
      if (pieces.length < 2) continue;
      const name = pieces[0] ?? "";
      const distStr = pieces[1] ?? "";
      let dist: Distribution | undefined;

      switch (distStr) {
        case "gaussian":
          dist = { type: "gaussian", mean: parseFloat(pieces[2] ?? "0"), stddev: parseFloat(pieces[3] ?? "1") };
          break;
        case "uniform":
          dist = { type: "uniform", lo: parseFloat(pieces[2] ?? "0"), hi: parseFloat(pieces[3] ?? "1") };
          break;
        case "lognormal":
          dist = { type: "lognormal", mu: parseFloat(pieces[2] ?? "0"), sigma: parseFloat(pieces[3] ?? "1") };
          break;
        case "beta":
          dist = { type: "beta", alpha: parseFloat(pieces[2] ?? "2"), beta: parseFloat(pieces[3] ?? "2") };
          break;
        case "triangular":
          dist = {
            type: "triangular",
            lo: parseFloat(pieces[2] ?? "0"),
            mode: parseFloat(pieces[3] ?? "0.5"),
            hi: parseFloat(pieces[4] ?? "1"),
          };
          break;
        default:
          throw new Error(`Unsupported distribution: ${distStr}`);
      }

      if (dist) {
        randomVars.push({ name, distribution: dist });
      }
    }

    if (args.threads > 1) {
      console.warn("Worker pool not yet implemented. Running synchronously on a single thread.");
    }

    const mcOpts: Parameters<typeof runMonteCarloArena>[2] = {
      numSamples: args.runs,
      latinHypercube: args.lhs,
      storeTrajectories: false, // Too much memory for CLI
      simulateOptions: {
        startTime,
        stopTime,
        step: stepSize,
        solver: "rk4",
      },
    };
    if (args.seed !== undefined) {
      mcOpts.seed = args.seed;
    }

    console.error(`Running Monte Carlo with ${args.runs} runs...`);
    const mcResult = runMonteCarloArena(arena, randomVars, mcOpts);

    console.error(`Finished ${mcResult.numSamples} valid runs.`);

    // Output stats
    let outputStr = "";
    if (args.format === "json") {
      const outStats: Record<string, unknown> = {};
      for (const [v, stat] of mcResult.statistics) {
        outStats[v] = {
          mean: stat.mean,
          stddev: stat.stddev,
          variance: stat.variance,
          ciLo: stat.ciLo,
          ciHi: stat.ciHi,
        };
      }
      outputStr = JSON.stringify(
        {
          convergence: mcResult.convergence,
          statistics: outStats,
        },
        null,
        2,
      );
    } else {
      // csv format
      const vars = Array.from(mcResult.statistics.keys());
      if (vars.length > 0) {
        const header = ["time", ...vars.flatMap((v) => [`${v}_mean`, `${v}_stddev`])].join(",");
        outputStr += header + "\n";

        const nT = mcResult.statistics.get(vars[0] ?? "")?.mean.length ?? 0;
        for (let i = 0; i < nT; i++) {
          const row = [startTime + i * stepSize];
          for (const v of vars) {
            const stat = mcResult.statistics.get(v);
            if (stat) {
              row.push(stat.mean[i] ?? 0);
              row.push(stat.stddev[i] ?? 0);
            } else {
              row.push(0);
              row.push(0);
            }
          }
          outputStr += row.join(",") + "\n";
        }
      }
    }

    if (args.output) {
      await fs.writeFile(args.output, outputStr);
      console.error(`Results saved to ${args.output}`);
    } else {
      process.stdout.write(outputStr + "\n");
    }
  },
};
