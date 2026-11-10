// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: USACE HEC-RAS Subcommand.
 *
 * Provides headless CLI operations for USACE HEC-RAS river geometry (.g01/.g02/.rasgeo) and flow files:
 * - `msx hec-ras inspect <file>`
 * - `msx hec-ras lint <file>`
 * - `msx hec-ras profile <file>`
 * - `msx hec-ras to-dae <file>`
 */

import {
  lintHecRas,
  lowerHecRasToDae,
  parseHecRasGeometry,
  solveWaterSurfaceProfile,
} from "@modelscript/hec-ras";
import { printArenaDAE } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const HecRasCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "hec-ras <action> [files...]",
  describe:
    "Inspect, lint, solve 1D backwater surface profiles, and lower USACE HEC-RAS river hydraulic geometry (.g01, .g02, .rasgeo)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, summary, lint, profile, solve, to-dae)",
        type: "string",
        choices: ["inspect", "summary", "lint", "profile", "solve", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "HEC-RAS geometry or flow file(s) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for DAE dump)",
        type: "string",
      })
      .option("discharge", {
        alias: ["q"],
        description: "Discharge rate (m³/s) for profile calculation",
        type: "number",
        default: 150.0,
      })
      .option("slope", {
        alias: ["s"],
        description: "Energy/bed friction slope S0 for profile calculation",
        type: "number",
        default: 0.001,
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const discharge = (argv["discharge"] as number) ?? 150.0;
    const slope = (argv["slope"] as number) ?? 0.001;

    if (files.length === 0) {
      console.error("[hec-ras] No HEC-RAS geometry file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[hec-ras] File not found: ${absPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(absPath, "utf-8");
      const geom = parseHecRasGeometry(text);

      switch (action) {
        case "lint": {
          console.log(`[hec-ras] Linting ${path.basename(file)}...`);
          const diags = lintHecRas(geom);
          if (diags.length === 0) {
            console.log("  ✔ No geometry or hydraulic diagnostics found.");
          } else {
            for (const d of diags) {
              const tag = d.severity === "error" ? "✖ ERROR" : d.severity === "warning" ? "▲ WARN" : "ℹ INFO";
              console.log(`  ${tag} [M${d.code}] Line ${d.line ?? 1}: ${d.message}`);
            }
            const errors = diags.filter((d) => d.severity === "error");
            if (errors.length > 0) {
              process.exitCode = 1;
            }
          }
          break;
        }

        case "inspect":
        case "summary": {
          console.log(`=== USACE HEC-RAS Geometry: ${geom.title || path.basename(file)} ===`);
          console.log(`  Reaches:            ${geom.reaches.length}`);
          console.log(`  Cross Sections:     ${geom.crossSections.length}`);
          for (const xs of geom.crossSections) {
            console.log(
              `    - RS ${xs.station} (${xs.river} - ${xs.reach}): Pts=${xs.stationElevations.length}, Bank=[${xs.bankStations.left}, ${xs.bankStations.right}], n=${xs.manning.channel}`,
            );
          }
          break;
        }

        case "profile":
        case "solve": {
          const profile = solveWaterSurfaceProfile(geom, {
            discharge,
            frictionSlope: slope,
          });
          console.log(`=== USACE HEC-RAS 1D Steady Backwater Profile ===`);
          console.log(`  Discharge:          ${discharge.toFixed(2)} m³/s`);
          console.log(`  Friction Slope S0:  ${slope.toExponential(3)}`);
          console.log(`  Cross-Section Solutions: ${profile.length}`);
          for (const r of profile) {
            console.log(
              `    - RS ${String(r.station).padEnd(8, " ")}: WSE=${r.waterSurfaceElevation.toFixed(3)} m, EGL=${r.energyGradeLine.toFixed(3)} m, V=${r.velocity.toFixed(2)} m/s, Fr=${r.froudeNumber.toFixed(3)}`,
            );
          }
          break;
        }

        case "to-dae": {
          const arena = lowerHecRasToDae(geom);
          console.log(`[hec-ras] Lowered hydraulic geometry to DAE arena:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          if (out) {
            const daeText = printArenaDAE(arena);
            fs.writeFileSync(path.resolve(process.cwd(), out), daeText, "utf-8");
            console.log(`[hec-ras] Saved DAE representation to ${out}`);
          }
          break;
        }

        default:
          console.error(`[hec-ras] Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
