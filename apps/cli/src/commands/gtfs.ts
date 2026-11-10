// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: GTFS Transit Electrification Subcommand.
 *
 * Provides headless CLI operations for GTFS transit schedule feeds & electric bus fleets (.gtfs/.zip/.csv):
 * - `msx gtfs inspect <file>`
 * - `msx gtfs lint <file>`
 * - `msx gtfs traction <file>`
 * - `msx gtfs depot <file>`
 * - `msx gtfs to-dae <file>`
 */

import {
  lintGtfs,
  lowerGtfsToDae,
  parseGtfs,
  solveDepotCharging,
  solveTractionProfiles,
} from "@modelscript/gtfs";
import { printArenaDAE } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const GtfsCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "gtfs <action> [files...]",
  describe:
    "Inspect, lint, solve electric transit kinematic traction power, depot charging, and lower GTFS feeds (.gtfs, .zip)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (inspect, summary, lint, traction, depot, solve, to-dae)",
        type: "string",
        choices: ["inspect", "summary", "lint", "traction", "depot", "solve", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "GTFS feed directory, archive, or manifest file(s) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for DAE dump)",
        type: "string",
      })
      .option("depot-limit", {
        description: "Depot transformer capacity limit in kW",
        type: "number",
        default: 1500.0,
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;
    const depotLimit = (argv["depot-limit"] as number) ?? 1500.0;

    if (files.length === 0) {
      console.error("[gtfs] No GTFS transit feed file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[gtfs] File not found: ${absPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(absPath, "utf-8");
      const feed = parseGtfs(text);

      switch (action) {
        case "lint": {
          console.log(`[gtfs] Linting ${path.basename(file)}...`);
          const diags = lintGtfs(feed);
          if (diags.length === 0) {
            console.log("  ✔ No route, stop sequence, or timetable diagnostics found.");
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
          console.log(`=== GTFS Transit Feed: ${path.basename(file)} ===`);
          console.log(`  Routes:       ${feed.routes.length}`);
          for (const r of feed.routes) {
            console.log(`    - Route '${r.route_id}' (${r.route_short_name}): ${r.route_long_name}`);
          }
          console.log(`  Stops:        ${feed.stops.length}`);
          console.log(`  Trips:        ${feed.trips.length}`);
          console.log(`  Stop Times:   ${feed.stopTimes.length}`);
          if (feed.vehicle) {
            console.log(
              `  Vehicle Spec: Mass=${feed.vehicle.massKg} kg, Battery=${feed.vehicle.batteryKWh} kWh, Aux=${feed.vehicle.auxPowerKW} kW`,
            );
          }
          break;
        }

        case "traction":
        case "solve": {
          const profiles = solveTractionProfiles(feed);
          console.log(`=== Electric Transit Kinematic Traction Power & SOC ===`);
          console.log(`  Evaluated Trips: ${profiles.length}`);
          for (const p of profiles) {
            console.log(
              `    - Trip '${p.tripId}': Dist=${(p.totalDistanceM / 1000).toFixed(2)} km, Energy=${p.totalEnergyKWh.toFixed(2)} kWh, Peak=${p.peakTractionKW.toFixed(1)} kW, Final SOC=${(p.finalSoc * 100).toFixed(1)}%`,
            );
          }
          break;
        }

        case "depot": {
          const depot = solveDepotCharging(feed);
          console.log(`=== Transit Depot Charging & Transformer Optimization ===`);
          console.log(`  Depot Name:              ${depot.depotName}`);
          console.log(`  Total Fleet Count:       ${depot.totalFleetCount}`);
          console.log(`  Depot Transformer Limit: ${depotLimit.toFixed(1)} kW`);
          console.log(`  Peak Depot Load:         ${depot.peakDemandKW.toFixed(1)} kW`);
          console.log(`  Total Daily Energy:      ${depot.totalDailyEnergyKWh.toFixed(1)} kWh`);
          console.log(
            `  Transformer Overload:    ${depot.peakDemandKW > depotLimit ? "YES (Exceeds capacity)" : "NO (Within headroom)"}`,
          );
          break;
        }

        case "to-dae": {
          const arena = lowerGtfsToDae(feed);
          console.log(`[gtfs] Lowered transit electrification model to DAE arena:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          if (out) {
            const daeText = printArenaDAE(arena);
            fs.writeFileSync(path.resolve(process.cwd(), out), daeText, "utf-8");
            console.log(`[gtfs] Saved DAE representation to ${out}`);
          }
          break;
        }

        default:
          console.error(`[gtfs] Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
