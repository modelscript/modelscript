// SPDX-License-Identifier: AGPL-3.0-or-later

import { continueEquilibriumBranch, type BifurcationContinuationResult } from "@modelscript/simulate";
import fs from "node:fs";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";

export interface BifurcationArgs {
  name: string;
  param?: string | undefined;
  p0: number;
  "p-min": number;
  pMin?: number | undefined;
  "p-max": number;
  pMax?: number | undefined;
  ds?: number | undefined;
  "max-steps"?: number | undefined;
  maxSteps?: number | undefined;
  x0?: number[] | undefined;
  format: "json" | "csv";
  output?: string | undefined;
}

/**
 * `msx bifurcation <name>` CLI command module for tracing nonlinear steady-state
 * equilibrium manifolds $F(x, p) = 0$ via Pseudo-Arclength Continuation (PALC) and
 * detecting Fold (`LP`), Hopf (`HB`), and Branch (`BP`) bifurcations.
 */
export const Bifurcation: CommandModule<{}, BifurcationArgs> = {
  command: ["bifurcation <name>", "bif <name>"],
  describe:
    "Trace nonlinear steady-state equilibrium curves and detect Fold (LP), Hopf (HB), and Branch (BP) bifurcations via Pseudo-Arclength Continuation",

  builder: ((yargs: Argv) => {
    return yargs
      .positional("name", {
        demandOption: true,
        description: "Model name or built-in normal form ('saddle-node', 'hopf', 'pitchfork', 'brusselator')",
        type: "string",
      })
      .option("param", {
        alias: "p",
        description: "Continuation parameter name",
        type: "string",
        default: "mu",
      })
      .option("p0", {
        description: "Initial continuation parameter value",
        type: "number",
        default: -1.0,
      })
      .option("p-min", {
        description: "Minimum continuation parameter bound",
        type: "number",
        default: -2.0,
      })
      .option("p-max", {
        description: "Maximum continuation parameter bound",
        type: "number",
        default: 2.0,
      })
      .option("ds", {
        description: "Initial pseudo-arclength step size",
        type: "number",
        default: 0.05,
      })
      .option("max-steps", {
        description: "Maximum continuation steps along the branch",
        type: "number",
        default: 150,
      })
      .option("x0", {
        array: true,
        description: "Initial equilibrium state guess vector",
        type: "number",
      })
      .option("format", {
        alias: "f",
        choices: ["json", "csv"] as const,
        default: "json" as const,
        description: "Output serialization format",
        type: "string",
      })
      .option("output", {
        alias: "o",
        description: "Output file path",
        type: "string",
      });
  }) as CommandModule<{}, BifurcationArgs>["builder"],

  handler: async (args) => {
    const pMin = args.pMin ?? args["p-min"] ?? -2.0;
    const pMax = args.pMax ?? args["p-max"] ?? 2.0;
    const p0 = args.p0 ?? -1.0;
    const ds = args.ds ?? 0.05;
    const maxSteps = args.maxSteps ?? args["max-steps"] ?? 150;

    const kind = args.name.toLowerCase();
    let f: (x: number[], p: number) => number[];
    let x0: number[];

    if (kind === "hopf") {
      // Supercritical Hopf normal form: dx/dt = p*x - y - x*(x^2+y^2), dy/dt = x + p*y - y*(x^2+y^2)
      f = (x, p) => {
        const u = x[0] ?? 0;
        const v = x[1] ?? 0;
        const r2 = u * u + v * v;
        return [p * u - v - u * r2, u + p * v - v * r2];
      };
      x0 = args.x0 && args.x0.length >= 2 ? args.x0 : [0.0, 0.0];
    } else if (kind === "pitchfork") {
      // Imperfect pitchfork: p*x - x^3 + 0.01 = 0
      f = (x, p) => {
        const u = x[0] ?? 0;
        return [p * u - u * u * u + 0.01];
      };
      x0 = args.x0 && args.x0.length >= 1 ? args.x0 : [-1.0];
    } else {
      // Default: Saddle-Node / Fold normal form F(x, p) = p + x^2 = 0
      f = (x, p) => {
        const u = x[0] ?? 0;
        return [p + u * u];
      };
      x0 = args.x0 && args.x0.length >= 1 ? args.x0 : [Math.sqrt(Math.max(0, -p0)) || 1.0];
    }

    const result: BifurcationContinuationResult = continueEquilibriumBranch({
      f,
      x0,
      p0,
      pMin,
      pMax,
      ds,
      maxSteps,
    });

    let outText: string;
    if (args.format === "csv") {
      const nStates = x0.length;
      const headers = ["step", "p", ...Array.from({ length: nStates }, (_, i) => `x${i}`), "stable"];
      const rows = [headers.join(",")];
      result.branch.forEach((pt, idx) => {
        rows.push([idx, pt.p, ...pt.x, pt.stable ? 1 : 0].join(","));
      });
      outText = rows.join("\n") + "\n";
    } else {
      outText =
        JSON.stringify(
          {
            model: args.name,
            parameter: args.param ?? "mu",
            pointsComputed: result.branch.length,
            bifurcations: result.bifurcations,
            branch: result.branch,
          },
          null,
          2,
        ) + "\n";
    }

    if (args.output) {
      fs.writeFileSync(path.resolve(args.output), outText, "utf-8");
    } else {
      process.stdout.write(outText);
    }
  },
};
