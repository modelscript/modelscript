// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: JSBSim Subcommand.
 *
 * Provides headless CLI operations for JSBSim 6-DOF Flight Dynamics models (.xml):
 * - `msx jsbsim inspect <file>`
 * - `msx jsbsim lint <file>`
 * - `msx jsbsim simulate <file>`
 * - `msx jsbsim to-dae <file>`
 * - `msx jsbsim to-modelica <file>`
 */

import { jsbsimToModelica, lintJsbsim, lowerJsbsimToDae, parseJsbsim, solveFlightDynamics } from "@modelscript/jsbsim";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const JsbsimCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "jsbsim <action> [files...]",
  describe: "Inspect, lint, simulate 6-DOF flight dynamics, and lower JSBSim models (.xml)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, lint, simulate, to-dae, to-modelica)",
        type: "string",
        choices: ["inspect", "summary", "lint", "simulate", "to-dae", "to-modelica"],
        demandOption: true,
      })
      .positional("files", {
        description: "JSBSim XML file(s) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for Modelica export)",
        type: "string",
      })
      .option("duration", {
        alias: "d",
        description: "Simulation duration in seconds (default: 10.0)",
        type: "number",
      })
      .option("speed", {
        alias: "s",
        description: "Initial airspeed in ft/s (default: 180.0)",
        type: "number",
      })
      .option("altitude", {
        alias: "a",
        description: "Initial altitude in ft (default: 5000.0)",
        type: "number",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const duration = argv["duration"] as number | undefined;
    const speed = argv["speed"] as number | undefined;
    const altitude = argv["altitude"] as number | undefined;

    if (files.length === 0) {
      console.error("[jsbsim] No JSBSim file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[jsbsim] File not found: ${absPath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(absPath, "utf-8");
      const doc = parseJsbsim(content, path.basename(absPath));
      const model = doc.model;

      switch (action) {
        case "inspect":
        case "summary": {
          console.log(`\n=== JSBSim Aircraft Summary: ${path.basename(file)} ===`);
          console.log(`Aircraft Name:    ${model.name}`);
          console.log(`Version:          ${model.version || "2.0"}`);
          if (model.fileHeader) {
            console.log(`Header:           ${model.fileHeader.slice(0, 80)}...`);
          }
          console.log(`Metrics:`);
          console.log(`  - Wing Area:    ${model.metrics.wingArea} ft²`);
          console.log(`  - Wingspan:     ${model.metrics.wingspan} ft`);
          console.log(`  - Chord:        ${model.metrics.chord} ft`);
          console.log(`  - H-Tail Area:  ${model.metrics.htailArea} ft²`);
          console.log(`  - V-Tail Area:  ${model.metrics.vtailArea} ft²`);
          console.log(`Mass & Inertia:`);
          console.log(`  - Empty Weight: ${model.massBalance.emptyWeight} lbs`);
          console.log(`  - Ixx:          ${model.massBalance.ixx} slug*ft²`);
          console.log(`  - Iyy:          ${model.massBalance.iyy} slug*ft²`);
          console.log(`  - Izz:          ${model.massBalance.izz} slug*ft²`);
          console.log(`Ground Gears:     ${model.groundReactions.length}`);
          console.log(`Engines:          ${model.engines.length}`);
          console.log(`Aero Axes:        ${model.aeroCoefficients.length}`);
          for (const c of model.aeroCoefficients) {
            console.log(`  - [${c.axis}] ${c.name} (val=${c.baseValue})`);
          }
          break;
        }

        case "lint": {
          const diagnostics = lintJsbsim(doc);
          if (diagnostics.length === 0) {
            console.log(`[jsbsim] ✓ ${path.basename(file)} passed all pre-flight checks (0 diagnostics).`);
          } else {
            console.log(`[jsbsim] Found ${diagnostics.length} diagnostic(s) in ${path.basename(file)}:`);
            for (const d of diagnostics) {
              const prefix = d.severity === "error" ? "ERROR" : d.severity === "warning" ? "WARN" : "INFO";
              console.log(`  [M${d.code}] ${prefix} (${d.rule}): ${d.message}`);
            }
          }
          break;
        }

        case "simulate": {
          const res = solveFlightDynamics(doc, {
            duration: duration ?? 10.0,
            initialSpeedFps: speed ?? 180.0,
            initialAltitudeFt: altitude ?? 5000.0,
          });
          console.log(`\n=== 6-DOF Flight Dynamics Simulation: ${path.basename(file)} ===`);
          console.log(`Aircraft:            ${res.aircraftName}`);
          console.log(`Time Steps Solved:   ${res.stepsCount}`);
          console.log(`Initial Altitude:    ${res.initialAltitude.toFixed(1)} ft`);
          console.log(`Final Altitude:      ${res.finalAltitude.toFixed(1)} ft`);
          console.log(`Initial Speed:       ${res.initialSpeed.toFixed(1)} ft/s`);
          console.log(`Final Speed:         ${res.finalSpeed.toFixed(1)} ft/s`);
          if (res.trajectory.length > 0) {
            const last = res.trajectory[res.trajectory.length - 1]!;
            console.log(`Final Attitude:      pitch=${last.pitchDeg.toFixed(2)}°, roll=${last.rollDeg.toFixed(2)}°`);
          }
          break;
        }

        case "to-dae": {
          const dae = lowerJsbsimToDae(doc);
          console.log(`\n=== Lowered DAE Summary: ${path.basename(file)} ===`);
          console.log(`Variables:           ${dae.variables().length}`);
          console.log(`Equations:           ${dae.equations().length}`);
          break;
        }

        case "to-modelica": {
          const modelName = path.basename(file, path.extname(file)).replace(/[^a-zA-Z0-9_]/g, "_");
          const moCode = jsbsimToModelica(doc, modelName);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.writeFileSync(outPath, moCode, "utf-8");
            console.log(`[jsbsim] Modelica flight mechanics model written to: ${outPath}`);
          } else {
            console.log(moCode);
          }
          break;
        }

        default:
          console.error(`[jsbsim] Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
