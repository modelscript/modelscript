// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: EPA LandGEM Biogas & Landfill Gas Subcommand.
 *
 * Provides headless CLI operations for EPA LandGEM and anaerobic digestion models (.landgem/.lfg/.biogas):
 * - `msx landgem inspect <file>`
 * - `msx landgem lint <file>`
 * - `msx landgem biogas <file>`
 * - `msx landgem to-dae <file>`
 */

import {
  lintLandgem,
  lowerLandgemToDae,
  parseLandgem,
  solveBiogas,
} from "@modelscript/landgem";
import { printArenaDAE } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const LandgemCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "landgem <action> [files...]",
  describe:
    "Inspect, lint, solve first-order methane decay kinetics & ADM1 digestion, and lower LandGEM biogas models (.landgem, .lfg, .biogas)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, summary, lint, biogas, solve, to-dae)",
        type: "string",
        choices: ["inspect", "summary", "lint", "biogas", "solve", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "LandGEM input file(s) (.landgem, .lfg, .biogas) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for DAE dump)",
        type: "string",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;

    if (files.length === 0) {
      console.error("[landgem] No LandGEM biogas model file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[landgem] File not found: ${absPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(absPath, "utf-8");
      const model = parseLandgem(text);

      switch (action) {
        case "lint": {
          console.log(`[landgem] Linting ${path.basename(file)}...`);
          const diags = lintLandgem(model);
          if (diags.length === 0) {
            console.log("  ✔ No decay kinetic, digester, or mass balance diagnostics found.");
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
          console.log(`=== EPA LandGEM Landfill & Biogas Model: ${path.basename(file)} ===`);
          console.log(`  Landfill Sites:     ${model.sites.length}`);
          for (const s of model.sites) {
            console.log(
              `    - Site '${s.name}' (${s.openYear}-${s.closeYear}): k=${s.params.k} yr⁻¹, L0=${s.params.l0} m³/Mg, Cohorts=${s.cohorts.length}`,
            );
          }
          console.log(`  Anaerobic Digesters:${model.digesters.length}`);
          for (const d of model.digesters) {
            console.log(
              `    - Digester '${d.name}': V=${d.volumeM3} m³, HRT=${d.hrtDays} d, Feed COD=${d.feedCodGL} g/L, pH=${d.ph}`,
            );
          }
          break;
        }

        case "biogas":
        case "solve": {
          const res = solveBiogas(model);
          console.log(`=== EPA LandGEM Methane Kinetics & Biogas Generation ===`);
          console.log(
            `  Peak Methane Rate:     ${(res.peakMethaneM3PerYear / 1e6).toFixed(2)} Mm³/yr (Year ${res.peakMethaneYear})`,
          );
          console.log(`  Cumulative Methane:    ${(res.cumulativeMethaneM3 / 1e6).toFixed(2)} Mm³`);
          if (res.digesters.length > 0) {
            console.log(`  Digester Operations:`);
            for (const d of res.digesters) {
              console.log(
                `    - '${d.name}': Q_biogas=${d.dailyBiogasM3.toFixed(1)} m³/d, CH4=${d.dailyMethaneM3.toFixed(1)} m³/d, Power=${d.electricalPowerKW.toFixed(1)} kWe / ${d.thermalPowerKW.toFixed(1)} kWth, Risk=${d.vfaRisk}`,
              );
            }
          }
          break;
        }

        case "to-dae": {
          const arena = lowerLandgemToDae(model);
          console.log(`[landgem] Lowered biogas model to DAE arena:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          if (out) {
            const daeText = printArenaDAE(arena);
            fs.writeFileSync(path.resolve(process.cwd(), out), daeText, "utf-8");
            console.log(`[landgem] Saved DAE representation to ${out}`);
          }
          break;
        }

        default:
          console.error(`[landgem] Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
