// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: HEC-HMS Subcommand (`msx hec-hms <action> [files...]`).
 *
 * Provides headless CLI operations for US Army Corps of Engineers HEC-HMS hydrologic models:
 * - `msx hec-hms lint <files...>`: Pre-flight CN, curve numbers, Muskingum parameters, and topology checks (HMS1001-HMS3003)
 * - `msx hec-hms summary <files...>`: Subbasins, routing reaches, junctions, and drainage areas
 * - `msx hec-hms simulate-runoff <files...>`: SCS-CN precipitation excess and Muskingum hydrologic channel routing
 * - `msx hec-hms to-ras <files...>`: Project peak flows to HEC-RAS unsteady flow (.u01) boundary conditions
 * - `msx hec-hms to-dae <files...>`: Lower into zero-GC WebAssembly DAE linear memory arena
 */

import {
  hmsHydrographToHecRasU01,
  lintHmsBasin,
  lowerHmsToDae,
  parseHmsBasin,
  simulateSubbasinRunoff,
} from "@modelscript/hec-hms";
import { printArenaDAE } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const HecHmsCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "hec-hms <action> [files...]",
  describe: "Inspect, lint, simulate runoff, and convert HEC-HMS hydrologic basin models (.basin, .hms)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (lint, summary, simulate-runoff, to-ras, to-dae)",
        type: "string",
        choices: ["lint", "summary", "simulate-runoff", "to-ras", "to-dae"],
        demandOption: true,
      })
      .positional("files", {
        description: "HEC-HMS basin file(s) (.basin, .hms)",
        type: "string",
        array: true,
      })
      .option("rain", {
        type: "number",
        default: 50.0,
        describe: "Design storm precipitation depth in millimeters",
      })
      .option("out", {
        alias: "o",
        type: "string",
        describe: "Output destination path",
      });
  },
  handler: async (argv) => {
    const action = String(argv["action"] ?? "summary");
    const rawFiles = (argv["files"] as string[]) ?? [];

    if (rawFiles.length === 0) {
      console.error("Error: At least one HEC-HMS basin file (.basin) is required.");
      process.exit(1);
    }

    for (const rawFile of rawFiles) {
      const filePath = path.resolve(process.cwd(), rawFile);
      if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const baseName = path.basename(filePath, path.extname(filePath));
      const model = parseHmsBasin(content);

      if (action === "lint") {
        const diagnostics = lintHmsBasin(model);
        if (diagnostics.length === 0) {
          console.log(`[PASS] ${rawFile}: No HEC-HMS basin violations found.`);
        } else {
          console.log(`\nDiagnostics for ${rawFile}:`);
          for (const d of diagnostics) {
            const sev = d.severity === "error" ? "ERROR" : "WARN";
            console.log(`  [${sev}] [${d.code}] ${d.message}`);
          }
        }
        continue;
      }

      if (action === "summary") {
        let totalArea = 0;
        for (const sub of model.subbasins.values()) totalArea += sub.area;

        console.log(`\n================================================================================`);
        console.log(`               HEC-HMS HYDROLOGIC BASIN SUMMARY: ${baseName}`);
        console.log(`================================================================================`);
        console.log(` Basin Name:           ${model.name}`);
        console.log(` Unit System:          ${model.unitSystem}`);
        console.log(` Total Drainage Area:  ${totalArea.toFixed(2)} km²`);
        console.log(` Subbasins:            ${model.subbasins.size}`);
        console.log(` Reaches:              ${model.reaches.size}`);
        console.log(` Junctions:            ${model.junctions.size}`);
        console.log(` Reservoirs:           ${model.reservoirs.size}`);
        console.log(` Sinks:                ${model.sinks.size}`);
        console.log(`================================================================================\n`);
        continue;
      }

      if (action === "simulate-runoff") {
        const firstSub = model.subbasins.values().next().value;
        if (!firstSub) {
          console.error("Error: No subbasins found in model to simulate runoff.");
          process.exit(1);
        }
        const rainMm = Number(argv["rain"] ?? 50.0);
        const hydrograph = simulateSubbasinRunoff(firstSub, {
          precipitationTotal: rainMm,
          durationHours: 24.0,
          unitSystem: model.unitSystem,
        });

        let peakQ = 0;
        let peakT = 0;
        let totalVolM3 = 0;
        for (const pt of hydrograph) {
          if (pt.flow > peakQ) {
            peakQ = pt.flow;
            peakT = pt.timeHours;
          }
          totalVolM3 += pt.flow * 3600 * 0.25;
        }

        console.log(`\nRunoff Simulation for ${rainMm}mm Precipitation Event (${firstSub.name}):`);
        console.log(`  Peak Basin Outflow:  ${peakQ.toFixed(2)} m³/s`);
        console.log(`  Time to Peak:        ${peakT.toFixed(2)} hours`);
        console.log(`  Total Runoff Volume: ${(totalVolM3 * 1e-3).toFixed(1)} thousand m³`);
        console.log(`  Hydrograph Points:   ${hydrograph.length}\n`);
        continue;
      }

      if (action === "to-ras") {
        const firstSub = model.subbasins.values().next().value;
        if (!firstSub) {
          console.error("Error: No subbasins found in model to project to HEC-RAS.");
          process.exit(1);
        }
        const rainMm = Number(argv["rain"] ?? 50.0);
        const hydrograph = simulateSubbasinRunoff(firstSub, {
          precipitationTotal: rainMm,
          durationHours: 24.0,
          unitSystem: model.unitSystem,
        });
        const rasText = hmsHydrographToHecRasU01(hydrograph);
        const outPath = argv["out"]
          ? path.resolve(process.cwd(), String(argv["out"]))
          : path.join(path.dirname(filePath), `${baseName}.u01`);
        fs.writeFileSync(outPath, rasText, "utf-8");
        console.log(`Successfully exported HEC-RAS unsteady flow boundary hydrograph:\n  ${outPath}`);
        continue;
      }

      if (action === "to-dae") {
        const arena = lowerHmsToDae(model);
        const printed = printArenaDAE(arena);
        if (argv["out"]) {
          const outPath = path.resolve(process.cwd(), String(argv["out"]));
          fs.writeFileSync(outPath, printed, "utf-8");
          console.log(`Successfully lowered HEC-HMS basin to DAE arena:\n  ${outPath}`);
        } else {
          console.log(printed.slice(0, 500) + "\n... (truncated)");
        }
        continue;
      }
    }
  },
};
