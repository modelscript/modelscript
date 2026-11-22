// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/modelica/context";
import { createWasmParser } from "@modelscript/modelica/parser";
import { PBox, propagatePBoxArena, type PBoxComparisonOp } from "@modelscript/runtime";
import {
  computeSobolIndicesArena,
  fitPCEArena,
  propagateFOSMArena,
  propagateUnscentedArena,
  runFORMArena,
  runSORMArena,
  runSubsetSimulationArena,
  type ArenaSimulationResult,
  type Distribution,
  type RandomVariable,
} from "@modelscript/simulate";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import type { CommandModule } from "yargs";
import { NodeFileSystem } from "../util/filesystem.js";

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

interface UqArgs {
  name: string;
  paths: string[];
  method: "fosm" | "unscented" | "sobol" | "pce" | "form" | "sorm" | "subset" | "pbox";
  params: string;
  limit?: string | undefined;
  degree: number;
  samples: number;
  isoprobabilistic: boolean;
  seed: number;
  format: "json" | "table";
  output?: string | undefined;
}

function parseRandomVariables(paramSpec: string): RandomVariable[] {
  const vars: RandomVariable[] = [];
  for (const token of paramSpec.split(",")) {
    const parts = token.trim().split(":");
    if (parts.length < 4) {
      throw new Error(`Invalid --params entry '${token}'. Expected name:dist:arg1:arg2[:arg3]`);
    }
    const [name, distKind, a1, a2, a3] = parts as [string, string, string, string, string | undefined];
    const v1 = parseFloat(a1);
    const v2 = parseFloat(a2);
    let distribution: Distribution;
    switch (distKind.toLowerCase()) {
      case "gaussian":
      case "normal":
        distribution = { type: "gaussian", mean: v1, stddev: v2 };
        break;
      case "uniform":
        distribution = { type: "uniform", lo: v1, hi: v2 };
        break;
      case "lognormal":
        distribution = { type: "lognormal", mu: v1, sigma: v2 };
        break;
      case "beta":
        distribution = { type: "beta", alpha: v1, beta: v2 };
        break;
      case "triangular":
        distribution = { type: "triangular", lo: v1, mode: v2, hi: parseFloat(a3 ?? String(v2)) };
        break;
      default:
        throw new Error(`Unsupported distribution '${distKind}' for parameter '${name}'`);
    }
    vars.push({ name, distribution });
  }
  return vars;
}

function parseLimitState(spec: string): (sim: ArenaSimulationResult) => number {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(<=|>=|<|>)\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*$/.exec(
    spec,
  );
  if (!match) {
    throw new Error(`Invalid --limit '${spec}'. Expected e.g. 'x<=0.25' or 'temp>100'.`);
  }
  const [, stateName, op, threshStr] = match as unknown as [string, string, string, string];
  const threshold = parseFloat(threshStr);
  return (sim: ArenaSimulationResult): number => {
    const idx = sim.states.indexOf(stateName);
    if (idx < 0) throw new Error(`State '${stateName}' not found in simulation outputs.`);
    const val = sim.y[sim.y.length - 1]?.[idx] ?? 0;
    // Failure when g <= 0
    return op === ">" || op === ">=" ? threshold - val : val - threshold;
  };
}

export const UQ: CommandModule<{}, UqArgs> = {
  command: "uq <name> <paths..>",
  describe:
    "Run analytical, spectral, or reliability Uncertainty Quantification (FOSM, UT, Sobol, gPCE, FORM, SORM, Subset)",
  builder: ((yargs: import("yargs").Argv) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "Name of class to analyze",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: true,
        description: "Paths of libraries and modules to load",
        type: "string",
      })
      .option("method", {
        alias: "m",
        description: "UQ propagation / reliability method",
        choices: ["fosm", "unscented", "sobol", "pce", "form", "sorm", "subset", "pbox"],
        default: "unscented",
      })
      .option("params", {
        alias: "p",
        description: "Random variables: name:dist:arg1:arg2 (comma-separated, e.g. k:gaussian:1:0.1)",
        type: "string",
        demandOption: true,
      })
      .option("limit", {
        alias: "l",
        description: "Failure limit-state for form/sorm/subset (e.g. 'x<=0.25' or 'T>350')",
        type: "string",
      })
      .option("degree", {
        description: "Polynomial degree for gPCE",
        type: "number",
        default: 3,
      })
      .option("samples", {
        alias: "n",
        description: "Base sample count for sobol/pce/subset",
        type: "number",
        default: 256,
      })
      .option("isoprobabilistic", {
        description: "Use standard-normal isoprobabilistic mapping for Unscented Transform",
        type: "boolean",
        default: false,
      })
      .option("seed", {
        description: "Deterministic PRNG seed",
        type: "number",
        default: 42,
      })
      .option("format", {
        description: "Output format",
        choices: ["json", "table"],
        default: "table",
      })
      .option("output", {
        alias: "o",
        description: "Write output to file instead of stdout",
        type: "string",
      });
  }) as CommandModule<{}, UqArgs>["builder"],
  handler: async (args) => {
    const { parser } = await createWasmParser(modelicaWasmPath);
    Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
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
    const step = exp.interval ?? (stopTime - startTime) / 100;
    const simulateOptions = { startTime, stopTime, step };
    const randomVars = parseRandomVariables(args.params);

    let payload: unknown;
    let tableText = "";

    switch (args.method) {
      case "fosm": {
        const res = propagateFOSMArena(arena, randomVars, { simulateOptions });
        const last = res.t.length - 1;
        const rows = res.states.map((state, i) => ({
          state,
          mean: res.mean[last]?.[i] ?? 0,
          stddev: res.stddev[last]?.[i] ?? 0,
          ciLo: res.ciLo[last]?.[i] ?? 0,
          ciHi: res.ciHi[last]?.[i] ?? 0,
        }));
        payload = {
          method: "fosm",
          rigor: res.rigor,
          numEvaluations: res.numEvaluations,
          finalTime: res.t[last],
          states: rows,
        };
        tableText = [
          `FOSM Uncertainty Propagation (${res.numEvaluations} evals, rigor=${res.rigor}) at t=${res.t[last]}`,
          ...rows.map(
            (r) =>
              `  ${r.state}: mean=${r.mean.toPrecision(6)} ± ${r.stddev.toPrecision(4)} (95% CI [${r.ciLo.toPrecision(5)}, ${r.ciHi.toPrecision(5)}])`,
          ),
        ].join("\n");
        break;
      }
      case "unscented": {
        const res = propagateUnscentedArena(arena, randomVars, {
          simulateOptions,
          isoprobabilistic: args.isoprobabilistic,
        });
        const last = res.t.length - 1;
        const rows = res.states.map((state, i) => ({
          state,
          mean: res.mean[last]?.[i] ?? 0,
          stddev: res.stddev[last]?.[i] ?? 0,
          ciLo: res.ciLo[last]?.[i] ?? 0,
          ciHi: res.ciHi[last]?.[i] ?? 0,
        }));
        payload = {
          method: "unscented",
          rigor: res.rigor,
          numEvaluations: res.numEvaluations,
          finalTime: res.t[last],
          states: rows,
        };
        tableText = [
          `Unscented Transform (${res.numEvaluations} evals, rigor=${res.rigor}) at t=${res.t[last]}`,
          ...rows.map(
            (r) =>
              `  ${r.state}: mean=${r.mean.toPrecision(6)} ± ${r.stddev.toPrecision(4)} (95% CI [${r.ciLo.toPrecision(5)}, ${r.ciHi.toPrecision(5)}])`,
          ),
        ].join("\n");
        break;
      }
      case "sobol": {
        const res = computeSobolIndicesArena(arena, randomVars, {
          baseSamples: args.samples,
          seed: args.seed,
          simulateOptions,
        });
        payload = {
          method: "sobol",
          rigor: res.rigor,
          numEvaluations: res.numEvaluations,
          outputs: Object.fromEntries(res.outputs),
        };
        const lines = [`Sobol' Global Sensitivity (${res.numEvaluations} evals, rigor=${res.rigor})`];
        for (const [name, out] of res.outputs) {
          lines.push(
            `  Output '${name}' (mean=${out.mean.toPrecision(5)}, std=${Math.sqrt(Math.max(0, out.variance)).toPrecision(4)}):`,
          );
          for (const idx of out.indices) {
            lines.push(
              `    ${idx.name}: S1=${idx.firstOrder.toFixed(4)}, ST=${idx.totalOrder.toFixed(4)}, interaction=${idx.interaction.toFixed(4)}`,
            );
          }
        }
        tableText = lines.join("\n");
        break;
      }
      case "pce": {
        const res = fitPCEArena(arena, randomVars, {
          degree: args.degree,
          numSamples: args.samples,
          simulateOptions,
        });
        const outputsObj: Record<string, unknown> = {};
        const lines = [
          `gPCE Expansion (degree=${res.degree}, basis=${res.numBasis}, evals=${res.numEvaluations}, rigor=${res.rigor})`,
        ];
        for (const [name, expOut] of res.outputs) {
          outputsObj[name] = {
            mean: expOut.mean,
            variance: expOut.variance,
            stddev: expOut.stddev,
            q2Loo: expOut.q2Loo,
            sobolIndices: expOut.sobolIndices,
          };
          lines.push(
            `  Output '${name}': mean=${expOut.mean.toPrecision(6)} ± ${expOut.stddev.toPrecision(4)} (Q2_LOO=${expOut.q2Loo?.toFixed(5) ?? "n/a"})`,
          );
        }
        payload = {
          method: "pce",
          rigor: res.rigor,
          degree: res.degree,
          numEvaluations: res.numEvaluations,
          outputs: outputsObj,
        };
        tableText = lines.join("\n");
        break;
      }
      case "form":
      case "sorm":
      case "subset": {
        if (!args.limit) {
          console.error(`--limit is required for method '${args.method}' (e.g. --limit 'x<=0.25').`);
          process.exit(1);
        }
        const limitFn = parseLimitState(args.limit);
        if (args.method === "form") {
          const res = runFORMArena(arena, randomVars, limitFn, { simulateOptions });
          payload = {
            ...res,
            mppX: Object.fromEntries(res.mppX),
            importanceFactors: Object.fromEntries(res.importanceFactors),
          };
          tableText = `FORM Reliability (converged=${res.converged}, evals=${res.numEvaluations}, rigor=${res.rigor}): beta=${res.beta.toFixed(4)}, Pf=${res.failureProbability.toExponential(4)}`;
        } else if (args.method === "sorm") {
          const res = runSORMArena(arena, randomVars, limitFn, { simulateOptions });
          payload = {
            ...res,
            mppX: Object.fromEntries(res.mppX),
            importanceFactors: Object.fromEntries(res.importanceFactors),
          };
          tableText = `SORM Reliability (converged=${res.converged}, evals=${res.numEvaluations}, rigor=${res.rigor}): beta=${res.beta.toFixed(4)}, Pf_FORM=${res.formFailureProbability.toExponential(4)}, Pf_SORM=${res.sormFailureProbability.toExponential(4)}`;
        } else {
          const res = runSubsetSimulationArena(arena, randomVars, limitFn, {
            samplesPerLevel: args.samples,
            seed: args.seed,
            simulateOptions,
          });
          payload = res;
          tableText = `Subset Simulation (${res.levels.length} levels, ${res.numEvaluations} evals, rigor=${res.rigor}): Pf=${res.failureProbability.toExponential(4)}, beta=${res.reliabilityIndex.toFixed(4)}, CoV=${res.covEstimate.toFixed(3)}`;
        }
        break;
      }
      case "pbox": {
        const paramPBoxes = new Map<string, PBox>();
        const bins = Math.min(32, Math.max(4, args.samples <= 32 ? args.samples : 12));
        for (const rv of randomVars) {
          if (rv.distribution.type === "uniform") {
            paramPBoxes.set(rv.name, PBox.fromUniform(rv.distribution.lo, rv.distribution.hi, bins));
          } else if (rv.distribution.type === "gaussian") {
            paramPBoxes.set(rv.name, PBox.fromNormal(rv.distribution.mean, rv.distribution.stddev, bins));
          } else {
            throw new Error(
              `--method pbox currently supports uniform and gaussian parameters (got '${rv.distribution.type}').`,
            );
          }
        }
        const pboxReqs: Array<{
          state: string;
          operator: PBoxComparisonOp;
          threshold: number;
          maxAllowedProbability: number;
        }> = [];
        if (args.limit) {
          const m = /^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(<=|>=|<|>)\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*$/.exec(
            args.limit,
          );
          if (!m) throw new Error(`Invalid --limit '${args.limit}'.`);
          pboxReqs.push({
            state: m[1]!,
            operator: m[2] as PBoxComparisonOp,
            threshold: parseFloat(m[3]!),
            maxAllowedProbability: 0.05,
          });
        }
        const res = propagatePBoxArena(arena, {
          parameterPBoxes: paramPBoxes,
          tSpan: [startTime, stopTime],
          dt: step,
          requirements: pboxReqs,
        });
        if (!res.ok) {
          console.error(`P-box arena propagation failed: ${res.reason}`);
          process.exit(1);
        }
        const finalSummary = Array.from(res.finalPBoxes.entries()).map(([state, pb]) => ({
          state,
          meanBounds: pb.meanBounds(),
          support: pb.support(),
        }));
        payload = {
          method: "pbox",
          rigor: res.rigor,
          allPicardValidated: res.allPicardValidated,
          numFocalTrajectories: res.numFocalTrajectories,
          finalStates: finalSummary,
          verdicts: Object.fromEntries(res.verdicts),
        };
        tableText = [
          `Rigorous P-Box Flowpipe (${res.numFocalTrajectories} focal trajectories, rigor=${res.rigor}) over [${startTime}, ${stopTime}]`,
          ...finalSummary.map(
            (r) =>
              `  ${r.state}: E[x] in [${r.meanBounds[0].toPrecision(5)}, ${r.meanBounds[1].toPrecision(5)}], support [${r.support[0].toPrecision(5)}, ${r.support[1].toPrecision(5)}]`,
          ),
          ...Array.from(res.verdicts.entries()).map(([k, v]) => `  Verdict [${k}]: ${v.kind} (${v.detail ?? ""})`),
        ].join("\n");
        break;
      }
    }

    const rendered = args.format === "json" ? JSON.stringify(payload, null, 2) : tableText;
    if (args.output) {
      await fs.writeFile(args.output, rendered + "\n", "utf8");
    } else {
      console.log(rendered);
    }
  },
};
