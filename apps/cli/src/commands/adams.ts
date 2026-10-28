// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  adamsToModelica,
  adamsToSimpack,
  analyzeAdamsMobility,
  lintAdamsModel,
  lowerAdamsToDae,
  parseAdams,
} from "@modelscript/adams";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

import { normalizeDomainAction, resolveOutputPath } from "../util/cli-options.js";

const ADAMS_ACTIONS = [
  "inspect",
  "summary",
  "lint",
  "mobility",
  "to-modelica",
  "to-simpack",
  "to-dae",
  "simulate",
] as const;

export const AdamsCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "adams <action> [files...]",
  describe: "Inspect, analyze, solve, and project MSC Adams multibody models (.adm, .cmd, .acf)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe:
          "Action to perform: inspect | summary | lint | mobility | to-modelica | to-simpack | to-dae | simulate",
        choices: ADAMS_ACTIONS,
        demandOption: true,
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input MSC Adams files (.adm, .cmd, .acf)",
      })
      .option("out", {
        alias: ["o", "output"],
        type: "string",
        describe: "Output file path",
      })
      .option("stop-time", {
        alias: ["tstop", "duration"],
        type: "number",
        default: 5.0,
        describe: "Simulation stop time [s]",
      })
      .option("step", {
        alias: ["step-size", "dt"],
        type: "number",
        default: 0.005,
        describe: "Simulation time step [s]",
      })
      .option("stabilization", {
        type: "string",
        choices: ["baumgarte", "algebraic"],
        default: "baumgarte",
        describe: "Constraint stabilization method",
      });
  },
  handler: async (argv) => {
    const action = normalizeDomainAction(String(argv["action"] ?? "inspect"), ADAMS_ACTIONS);
    const files = (argv["files"] as string[]) ?? [];
    const outFile = resolveOutputPath(argv);

    if (files.length === 0) {
      console.error("Error: No input files provided.");
      process.exit(1);
    }

    for (const file of files) {
      if (!fs.existsSync(file)) {
        console.error(`Error: File not found: ${file}`);
        continue;
      }

      const content = fs.readFileSync(file, "utf-8");
      const modelTitle = path.basename(file, path.extname(file));
      const dataset = parseAdams(content, modelTitle);

      if (action === "inspect" || action === "summary") {
        console.log(`=== MSC Adams Model Summary: ${dataset.title || modelTitle} ===`);
        console.log(`  Parts (Bodies) : ${dataset.parts.size}`);
        console.log(`  Markers        : ${dataset.markers.size}`);
        console.log(`  Joints         : ${dataset.joints.size}`);
        console.log(`  Forces         : ${dataset.forces.size}`);
        console.log(`  Motions        : ${dataset.motions.size}`);
      } else if (action === "lint") {
        const diagnostics = lintAdamsModel(dataset);
        if (diagnostics.length === 0) {
          console.log(`[PASS] ${file}: 0 issues found (${dataset.parts.size} parts, ${dataset.joints.size} joints).`);
        } else {
          console.log(`[DIAGNOSTICS] ${file}: ${diagnostics.length} item(s):`);
          for (const d of diagnostics) {
            console.log(`  - [${d.code}] ${d.severity.toUpperCase()}: ${d.message}`);
          }
          if (diagnostics.some((d) => d.severity === "error")) {
            process.exitCode = 1;
          }
        }
      } else if (action === "mobility") {
        const mobility = analyzeAdamsMobility(dataset);
        console.log(`--- Grübler-Kutzbach Mobility Analysis: ${file} ---`);
        console.log(`Moving Rigid Bodies:         ${mobility.numBodies}`);
        console.log(`Kinematic Joints:            ${mobility.numJoints}`);
        console.log(`Total Joint Constraints:     ${mobility.totalConstraintEquations}`);
        console.log(`Degrees of Freedom:          ${mobility.calculatedMobility}`);
        console.log(`Overconstrained Status:      ${mobility.isOverconstrained ? "YES (M < 0)" : "NO"}`);
      } else if (action === "to-modelica") {
        const mo = adamsToModelica(dataset);
        if (outFile) {
          fs.writeFileSync(outFile, mo, "utf-8");
          console.log(`Exported Modelica model to ${outFile}`);
        } else {
          console.log(mo);
        }
      } else if (action === "to-simpack") {
        const simpack = adamsToSimpack(dataset);
        console.log(`--- Projected SIMPACK Model: ${file} ---`);
        console.log(`Bodies:  ${simpack.bodies.size}`);
        console.log(`Markers: ${simpack.markers.size}`);
        console.log(`Joints:  ${simpack.joints.size}`);
        console.log(`Forces:  ${simpack.forces.size}`);
        if (outFile) {
          fs.writeFileSync(outFile, JSON.stringify(simpack, null, 2), "utf-8");
          console.log(`Saved SIMPACK model to ${outFile}`);
        }
      } else if (action === "to-dae") {
        const dae = lowerAdamsToDae(dataset, undefined, {
          stabilization: (argv["stabilization"] as "baumgarte" | "algebraic") ?? "baumgarte",
        });
        console.log(`=== MSC Adams DAE Lowering: ${modelTitle} ===`);
        console.log(`  DAE Variables: ${dae.varCount}`);
        console.log(`  DAE Equations: ${dae.eqCount}`);
        if (outFile) {
          fs.writeFileSync(
            outFile,
            JSON.stringify({ model: modelTitle, variables: dae.varCount, equations: dae.eqCount }, null, 2),
            "utf-8",
          );
        }
      } else if (action === "simulate") {
        const { initBltWasm } = await import("@modelscript/runtime");
        const { simulateArena } = await import("@modelscript/simulate");
        await initBltWasm();

        const dae = lowerAdamsToDae(dataset, undefined, {
          stabilization: argv["stabilization"] as "baumgarte" | "algebraic",
        });

        console.log(`--- Dynamic DAE Simulation: ${file} ---`);
        console.log(`DAE Variables: ${dae.varCount}`);
        console.log(`DAE Equations: ${dae.eqCount}`);

        const result = simulateArena(dae, {
          startTime: 0,
          stopTime: (argv["stop-time"] as number) ?? dataset.simulation?.endTime ?? 5.0,
          step: (argv["step"] as number) ?? dataset.simulation?.dtOut ?? 0.005,
        });

        console.log(`Simulation finished successfully.`);
        console.log(`Time points evaluated: ${result.t.length}`);

        if (outFile) {
          const header = ["time", ...result.states].join(",");
          const lines = [header];
          for (let i = 0; i < result.t.length; i++) {
            const row = [result.t[i], ...result.y[i]!].join(",");
            lines.push(row);
          }
          fs.writeFileSync(outFile, lines.join("\n"), "utf-8");
          console.log(`Wrote trajectory data to ${outFile}`);
        }
      }
    }
  },
};
