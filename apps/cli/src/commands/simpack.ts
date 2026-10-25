// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  analyzeMobility,
  lintSimpackModel,
  lowerSimpackToDae,
  parseSimDeck,
  parseSpckXml,
  simpackToModelica,
} from "@modelscript/simpack";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const SimpackCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "simpack <action> [files...]",
  describe: "Inspect, analyze, and lower SIMPACK multibody models (.spck, .sim, .mbs)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe: "Action to perform: lint | mobility | to-modelica | simulate | to-fmu",
        choices: ["lint", "mobility", "to-modelica", "simulate", "to-fmu"],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input SIMPACK files (.spck, .sim, .mbs)",
      })
      .option("out", {
        type: "string",
        describe: "Output file path",
      })
      .option("stop-time", {
        type: "number",
        default: 5.0,
        describe: "Simulation stop time [s]",
      })
      .option("step", {
        type: "number",
        default: 0.005,
        describe: "Simulation time step [s]",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];

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
      const modelName = path.basename(file, path.extname(file));
      const isXml = content.trimStart().startsWith("<");
      const model = isXml ? parseSpckXml(content, modelName) : parseSimDeck(content, modelName);

      if (action === "lint") {
        const diagnostics = lintSimpackModel(model);
        if (diagnostics.length === 0) {
          console.log(`[PASS] ${file}: 0 issues found (${model.bodies.size} bodies, ${model.joints.size} joints).`);
        } else {
          console.log(`[DIAGNOSTICS] ${file}: ${diagnostics.length} item(s):`);
          for (const d of diagnostics) {
            console.log(`  - [${d.code}] ${d.severity.toUpperCase()}: ${d.message}`);
          }
        }
      } else if (action === "mobility") {
        const mobility = analyzeMobility(model);
        console.log(`--- Grübler-Kutzbach Mobility Analysis: ${file} ---`);
        console.log(`Moving Bodies:               ${mobility.numBodies}`);
        console.log(`Joints:                      ${mobility.numJoints}`);
        console.log(`Total Joint Constraints:     ${mobility.totalConstraintEquations}`);
        console.log(`System Degrees of Freedom:   ${mobility.calculatedMobility}`);
        console.log(`Overconstrained Status:      ${mobility.isOverconstrained ? "YES (M < 0)" : "NO"}`);
      } else if (action === "to-modelica") {
        const mo = simpackToModelica(model);
        if (argv["out"]) {
          fs.writeFileSync(argv["out"] as string, mo, "utf-8");
          console.log(`Exported Modelica model to ${argv["out"]}`);
        } else {
          console.log(mo);
        }
      } else if (action === "simulate") {
        const { initBltWasm } = await import("@modelscript/runtime");
        const { simulateArena } = await import("@modelscript/simulate");

        await initBltWasm();
        const dae = lowerSimpackToDae(model);
        const stopTime = (argv["stop-time"] as number) ?? 5.0;
        const step = (argv["step"] as number) ?? 0.005;

        console.log(
          `Simulating SIMPACK multibody model '${model.name}' (${dae.varCount} vars, ${dae.eqCount} eqs) to t=${stopTime}s...`,
        );
        const result = simulateArena(dae, { startTime: 0, stopTime, step });
        console.log(
          `Simulation complete: ${result.t.length} steps computed across states [${result.states.slice(0, 6).join(", ")}${result.states.length > 6 ? ", ..." : ""}].`,
        );

        if (argv["out"]) {
          const outPath = argv["out"] as string;
          const header = ["time", ...result.states].join(",");
          const lines = [header];
          for (let i = 0; i < result.t.length; i++) {
            const row = [result.t[i], ...result.y[i]!].join(",");
            lines.push(row);
          }
          fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
          console.log(`Wrote trajectory data to ${outPath}`);
        }
      } else if (action === "to-fmu") {
        const { exportSimpackFmu } = await import("@modelscript/exchange");
        const fmuResult = exportSimpackFmu(model);
        const outPath = (argv["out"] as string) ?? `${modelName}.fmu`;
        fs.writeFileSync(outPath, fmuResult.archive);
        console.log(
          `Exported FMI 2.0 Co-Simulation FMU (${fmuResult.archive.byteLength} bytes, ${fmuResult.variableCount} vars) to ${outPath}`,
        );
      }
    }
  },
};
