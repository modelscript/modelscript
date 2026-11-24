// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: 20-sim Bond Graph & SIDOPS Subcommand.
 *
 * Provides headless CLI operations for 20-sim models (`.emx`, `.emxz`, `.sid`):
 * - `msx twentysim inspect <file>`
 * - `msx twentysim lint <file>`
 * - `msx twentysim simulate <file>`
 * - `msx twentysim render <file>`
 * - `msx twentysim to-dae <file>`
 * - `msx twentysim to-modelica <file>`
 */

import { printArenaDAE } from "@modelscript/runtime";
import {
  lintTwentySim,
  parseTwentySim,
  renderBondGraphSvg,
  simulateTwentySim,
  twentySimToDae,
  twentySimToModelica,
} from "@modelscript/twentysim";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const TwentySimCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "twentysim <action> [files...]",
  describe:
    "Inspect, lint (SCAP causality), simulate, render SVG, and lower 20-sim Bond Graph & SIDOPS models (.emx, .emxz, .sid)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, lint, simulate, render, to-dae, to-modelica)",
        type: "string",
        choices: ["inspect", "lint", "simulate", "render", "to-dae", "to-modelica"],
        demandOption: true,
      })
      .positional("files", {
        description: "20-sim model file(s) (.emx, .emxz, .sid) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (SVG, Modelica, DAE, or JSON trajectory)",
        type: "string",
      })
      .option("stop", {
        description: "Simulation finish time (s)",
        type: "number",
      })
      .option("step", {
        description: "Simulation RK4 step size (s)",
        type: "number",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const finishTime = argv["stop"] as number | undefined;
    const stepSize = argv["step"] as number | undefined;

    if (files.length === 0) {
      console.error("[twentysim] No 20-sim model file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[twentysim] File not found: ${absPath}`);
        process.exit(1);
      }

      const raw = file.toLowerCase().endsWith(".emxz") ? fs.readFileSync(absPath) : fs.readFileSync(absPath, "utf-8");
      const model = parseTwentySim(raw, path.basename(file, path.extname(file)));

      switch (action) {
        case "inspect": {
          console.log(
            JSON.stringify(
              {
                name: model.name,
                sourceKind: model.sourceKind,
                version: model.version,
                submodels: model.root.submodels.length,
                connections: model.root.connections.length,
                equations: model.root.equations.length,
                experiment: model.experiment,
              },
              null,
              2,
            ),
          );
          break;
        }
        case "lint": {
          const diags = lintTwentySim(model);
          for (const d of diags) {
            console.log(`[${d.id}] (${d.severity}) ${d.message}`);
          }
          if (diags.some((d) => d.severity === "error")) {
            process.exitCode = 1;
          }
          break;
        }
        case "simulate": {
          const sim = simulateTwentySim(model, { finishTime, stepSize });
          const payload = JSON.stringify(
            {
              model: model.name,
              steps: sim.times.length,
              stateNames: sim.stateNames,
              maxPowerResidual: sim.maxPowerResidual,
              finalTime: sim.times[sim.times.length - 1],
              finalStates: Object.fromEntries(sim.stateNames.map((s) => [s, sim.variables[s]?.[sim.times.length - 1]])),
            },
            null,
            2,
          );
          if (out) fs.writeFileSync(path.resolve(process.cwd(), out), payload, "utf-8");
          else console.log(payload);
          break;
        }
        case "render": {
          const svg = renderBondGraphSvg(model);
          if (out) fs.writeFileSync(path.resolve(process.cwd(), out), svg, "utf-8");
          else console.log(svg);
          break;
        }
        case "to-dae": {
          const dae = twentySimToDae(model);
          const printed = printArenaDAE(dae);
          if (out) fs.writeFileSync(path.resolve(process.cwd(), out), printed, "utf-8");
          else console.log(printed);
          break;
        }
        case "to-modelica": {
          const mo = twentySimToModelica(model);
          if (out) fs.writeFileSync(path.resolve(process.cwd(), out), mo, "utf-8");
          else console.log(mo);
          break;
        }
      }
    }
  },
};
