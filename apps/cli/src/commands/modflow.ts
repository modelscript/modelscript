// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: USGS MODFLOW Subcommand.
 *
 * Provides headless CLI operations for USGS MODFLOW 6 groundwater models (.dis/.dis6/.npf/.wel):
 * - `msx modflow inspect <file>`
 * - `msx modflow lint <file>`
 * - `msx modflow balance <file>`
 * - `msx modflow to-dae <file>`
 */

import {
  lintModflow,
  lowerModflowToDae,
  parseModflow,
  solveAquiferBalance,
} from "@modelscript/modflow";
import { printArenaDAE } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const ModflowCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "modflow <action> [files...]",
  describe:
    "Inspect, lint, solve 3D Darcy groundwater balances, and lower USGS MODFLOW 6 aquifer packages (.dis, .dis6, .npf, .wel, .riv)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, summary, lint, balance, heads, solve, to-dae)",
        type: "string",
        choices: ["inspect", "summary", "lint", "balance", "heads", "solve", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "MODFLOW input file(s) (.dis, .dis6, .npf, .wel) to process",
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
      console.error("[modflow] No MODFLOW groundwater model file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[modflow] File not found: ${absPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(absPath, "utf-8");
      const model = parseModflow(text);

      switch (action) {
        case "lint": {
          console.log(`[modflow] Linting ${path.basename(file)}...`);
          const diags = lintModflow(model);
          if (diags.length === 0) {
            console.log("  ✔ No discretization, conductivity, or boundary condition diagnostics found.");
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
          console.log(`=== USGS MODFLOW 6 Groundwater Model: ${model.name || path.basename(file)} ===`);
          console.log(
            `  Grid Discretization: ${model.dis.nlay} layers x ${model.dis.nrow} rows x ${model.dis.ncol} cols`,
          );
          console.log(
            `  Cell Dimensions:     delr=${model.dis.delr[0] ?? 100} m, delc=${model.dis.delc[0] ?? 100} m`,
          );
          console.log(`  Top Elevation:       ${model.dis.top} m`);
          console.log(`  Conductivity (NPF):  K=${model.npf.k} m/d (k33=${model.npf.k33 ?? model.npf.k} m/d)`);
          console.log(`  Pumping Wells (WEL): ${model.wells.length}`);
          for (const w of model.wells) {
            console.log(`    - Cell (${w.cell.layer}, ${w.cell.row}, ${w.cell.col}): Q=${w.q} m³/d`);
          }
          console.log(`  River Reaches (RIV): ${model.rivers.length}`);
          console.log(`  Constant Heads (CHD):${model.chds.length}`);
          break;
        }

        case "balance":
        case "heads":
        case "solve": {
          const balance = solveAquiferBalance(model);
          console.log(`=== USGS MODFLOW 6 Aquifer Water Budget & Drawdown ===`);
          console.log(`  Total Pumping Rate:     ${balance.totalPumpingRate.toFixed(1)} m³/d`);
          console.log(`  Total Injection Rate:   ${balance.totalInjectionRate.toFixed(1)} m³/d`);
          console.log(`  River Infiltration/Gain:${balance.totalRiverLeakage.toFixed(1)} m³/d`);
          console.log(`  Constant-Head Flux:     ${balance.totalChdExchange.toFixed(1)} m³/d`);
          console.log(`  Mean Water Table Elev:  ${balance.meanAquiferHead.toFixed(2)} m`);
          console.log(`  Max Water Drawdown:     ${balance.maxDrawdown.toFixed(2)} m`);
          break;
        }

        case "to-dae": {
          const arena = lowerModflowToDae(model);
          console.log(`[modflow] Lowered groundwater model to DAE arena:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          if (out) {
            const daeText = printArenaDAE(arena);
            fs.writeFileSync(path.resolve(process.cwd(), out), daeText, "utf-8");
            console.log(`[modflow] Saved DAE representation to ${out}`);
          }
          break;
        }

        default:
          console.error(`[modflow] Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
