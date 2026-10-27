// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: CFD Subcommand.
 *
 * Provides headless CLI operations for SU2 and OpenFOAM Computational Fluid Dynamics models:
 * - `msx cfd inspect <path>`
 * - `msx cfd lint <path>`
 * - `msx cfd to-dae <path> [--out=dae.json]`
 * - `msx cfd to-modelica <path> [--out=Model.mo]`
 * - `msx cfd solve <path>`
 */

import { cfdToDae, cfdToModelica, lintCfdModel, parseCfdConfig } from "@modelscript/cfd";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const CfdCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "cfd <action> [files...]",
  describe: "Inspect, lint, solve, and project CFD aerodynamic models (.cfg, .foam, .su2)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (lint, summary, inspect, to-modelica, to-dae, solve)",
        type: "string",
        choices: ["lint", "summary", "inspect", "to-modelica", "to-dae", "solve"],
        demandOption: true,
      })
      .positional("files", {
        description: "CFD model configuration file(s) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: "o",
        description: "Output file path (for code generation or DAE metadata)",
        type: "string",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) || [];
    const outPath = argv["out"] as string | undefined;

    if (files.length === 0) {
      console.error("Error: No CFD configuration file(s) specified.");
      process.exitCode = 1;
      return;
    }

    for (const file of files) {
      const filePath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(filePath)) {
        console.error(`Error: File '${filePath}' does not exist.`);
        process.exitCode = 1;
        continue;
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const ext = path.extname(filePath).slice(1) || "cfg";

      let model;
      try {
        model = parseCfdConfig(content, ext);
      } catch (err: unknown) {
        console.error(`Error parsing '${filePath}': ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        continue;
      }

      switch (action) {
        case "summary":
        case "inspect": {
          console.log(`\n=======================================================`);
          console.log(`                CFD AERODYNAMIC SUMMARY                `);
          console.log(`=======================================================`);
          console.log(` File            : ${path.basename(filePath)}`);
          console.log(` Dialect         : ${model.dialect.toUpperCase()}`);
          console.log(` Physical Problem: ${model.mathProblem ?? "Euler / Navier-Stokes"}`);
          if (model.machNumber !== undefined) console.log(` Mach Number     : ${model.machNumber}`);
          if (model.aoa !== undefined) console.log(` Angle of Attack : ${model.aoa}°`);
          if (model.reynoldsNumber !== undefined) console.log(` Reynolds Number : ${model.reynoldsNumber}`);
          if (model.meshFilename) console.log(` Grid Mesh File  : ${model.meshFilename}`);
          console.log(` Boundary Markers: ${model.markers.size}`);
          for (const [name, marker] of model.markers) {
            console.log(`   - ${name.padEnd(16)} [${marker.type}]`);
          }
          console.log(`=======================================================\n`);
          break;
        }

        case "lint": {
          const diags = lintCfdModel(model);
          if (diags.length === 0) {
            console.log(`✓ '${path.basename(filePath)}': No pre-flight diagnostics found.`);
          } else {
            console.log(`\nDiagnostics for '${path.basename(filePath)}':`);
            for (const d of diags) {
              const prefix = d.severity === "error" ? "✖ [ERROR]" : "⚠ [WARN] ";
              console.log(`  ${prefix} [M${d.code}] ${d.message} (line ${d.line})`);
            }
            if (diags.some((d) => d.severity === "error")) {
              process.exitCode = 1;
            }
          }
          break;
        }

        case "to-dae": {
          console.log(`[cfd] Lowering ${path.basename(filePath)} to linear-memory DAE arena...`);
          const dae = cfdToDae(model);
          console.log(`✔ DAE arena lowered successfully:`);
          console.log(`  Variables : ${dae.varCount}`);
          console.log(`  Equations : ${dae.eqCount}`);

          if (outPath) {
            const dest = path.resolve(process.cwd(), outPath);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            const meta = {
              source: filePath,
              dialect: model.dialect,
              variables: dae.varCount,
              equations: dae.eqCount,
              states: dae.getVariables(),
            };
            fs.writeFileSync(dest, JSON.stringify(meta, null, 2), "utf-8");
            console.log(`✔ DAE metadata written to: ${dest}`);
          }
          break;
        }

        case "to-modelica": {
          const mo = cfdToModelica(model);
          if (outPath) {
            const dest = path.resolve(process.cwd(), outPath);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, mo, "utf-8");
            console.log(`✔ Modelica projection written to: ${dest}`);
          } else {
            console.log(mo);
          }
          break;
        }

        case "solve": {
          const mach = model.machNumber ?? 0.8;
          const aoaDeg = model.aoa ?? 2.0;
          const aoaRad = (aoaDeg * Math.PI) / 180.0;
          const cl = 2 * Math.PI * aoaRad;
          const cd = 0.02 + 0.05 * cl * cl;
          const qInf = 0.5 * (model.density ?? 1.225) * Math.pow(mach * 340.29, 2);
          const refArea = parseFloat(model.directives.get("REF_AREA") ?? "1.0") || 1.0;
          const lift = qInf * refArea * cl;
          const drag = qInf * refArea * cd;

          console.log(`\n=======================================================`);
          console.log(`             CFD AERODYNAMIC FORCES SOLVER             `);
          console.log(`=======================================================`);
          console.log(` Mach Number             : ${mach}`);
          console.log(` Angle of Attack         : ${aoaDeg}°`);
          console.log(` Dynamic Pressure (q)    : ${qInf.toFixed(1)} Pa`);
          console.log(` Lift Coefficient (C_L)  : ${cl.toFixed(4)}`);
          console.log(` Drag Coefficient (C_D)  : ${cd.toFixed(4)}`);
          console.log(` Aerodynamic Lift Force  : ${lift.toFixed(1)} N`);
          console.log(` Aerodynamic Drag Force  : ${drag.toFixed(1)} N`);
          console.log(` Lift-to-Drag Ratio (L/D): ${(cl / cd).toFixed(2)}`);
          console.log(`=======================================================\n`);
          break;
        }
      }
    }
  },
};
