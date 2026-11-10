// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: OCPP EV Charging Subcommand.
 *
 * Provides headless CLI operations for OCPP 2.0.1 / 1.6J smart charging network configurations (.ocpp):
 * - `msx ocpp inspect <file>`
 * - `msx ocpp lint <file>`
 * - `msx ocpp schedule <file>`
 * - `msx ocpp to-dae <file>`
 */

import {
  lintOcpp,
  lowerOcppToDae,
  parseOcpp,
  scheduleSmartCharging,
} from "@modelscript/ocpp";
import { printArenaDAE } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const OcppCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "ocpp <action> [files...]",
  describe:
    "Inspect, lint, solve priority smart charging schedules, and lower OCPP 2.0.1/1.6J EV charging networks (.ocpp)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, summary, lint, schedule, solve, to-dae)",
        type: "string",
        choices: ["inspect", "summary", "lint", "schedule", "solve", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "OCPP configuration file(s) (.ocpp) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for DAE dump)",
        type: "string",
      })
      .option("min-power", {
        description: "Minimum session charging power in kW",
        type: "number",
        default: 6.0,
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const minPower = (argv["min-power"] as number) ?? 6.0;

    if (files.length === 0) {
      console.error("[ocpp] No OCPP charging network file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[ocpp] File not found: ${absPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(absPath, "utf-8");
      const deck = parseOcpp(text);

      switch (action) {
        case "lint": {
          console.log(`[ocpp] Linting ${path.basename(file)}...`);
          const diags = lintOcpp(deck);
          if (diags.length === 0) {
            console.log("  ✔ No charging limit or connector diagnostics found.");
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
          console.log(`=== OCPP EV Charging Network: ${path.basename(file)} ===`);
          console.log(`  Charging Stations:    ${deck.stations.length}`);
          for (const s of deck.stations) {
            console.log(
              `    - Station '${s.id}' (${s.vendor ?? "Generic"} ${s.model ?? ""}): Limit=${s.gridLimitKW} kW, EVSEs=${s.evses.length}`,
            );
            for (const e of s.evses) {
              for (const c of e.connectors) {
                const sess = c.currentSession;
                console.log(
                  `        EVSE ${e.id} / Conn ${c.id}: ${c.type} max=${c.maxPowerKW} kW [${c.status}]${sess ? ` Tx=${sess.transactionId} SOC=${(sess.currentSoC * 100).toFixed(0)}%->${(sess.targetSoC * 100).toFixed(0)}%` : ""}`,
                );
              }
            }
          }
          break;
        }

        case "schedule":
        case "solve": {
          const results = scheduleSmartCharging(deck, { minSessionPowerKW: minPower });
          const totalAllocated = results.reduce((acc, r) => acc + r.allocatedPowerKW, 0);
          console.log(`=== OCPP Smart Charging Schedule Optimization ===`);
          console.log(`  Total Active Allocations: ${results.length}`);
          console.log(`  Total Power Allocated:    ${totalAllocated.toFixed(1)} kW`);
          for (const r of results) {
            console.log(
              `    - Station ${r.stationId} EVSE ${r.evseId} Conn ${r.connectorId} (Tx: ${r.transactionId}): Power=${r.allocatedPowerKW.toFixed(1)} kW, Needed=${r.energyRequiredKWh.toFixed(1)} kWh, EstTime=${r.estimatedTimeToTargetMinutes.toFixed(0)} min`,
            );
          }
          break;
        }

        case "to-dae": {
          const arena = lowerOcppToDae(deck);
          console.log(`[ocpp] Lowered charging network to DAE arena:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          if (out) {
            const daeText = printArenaDAE(arena);
            fs.writeFileSync(path.resolve(process.cwd(), out), daeText, "utf-8");
            console.log(`[ocpp] Saved DAE representation to ${out}`);
          }
          break;
        }

        default:
          console.error(`[ocpp] Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
