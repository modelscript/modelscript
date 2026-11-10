// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: US EPA SWMM Subcommand.
 *
 * Provides headless CLI operations for SWMM stormwater and wastewater networks (.inp):
 * - `msx swmm inspect <file>`
 * - `msx swmm lint <file>`
 * - `msx swmm to-dae <file>`
 * - `msx swmm to-modelica <file>`
 * - `msx swmm route-flow <file>`
 */

import { diffSwmmNetworks } from "@modelscript/diagram/water-network-diff";
import {
  buildSwmmFromGis,
  computeSwmmWaterQuality,
  createRegularGrid2DMesh,
  lintSwmm,
  lowerSwmmToDae,
  parseInfoWorksDatabase,
  parseSwmm,
  routeNetworkFlow,
  serializeSwmm,
  simulateSwmmRtc,
  solveSwmmCoupled1D2D,
  swmmToModelica,
} from "@modelscript/swmm";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const SwmmCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "swmm <action> [files...]",
  describe: "Inspect, lint, route, and lower US EPA SWMM 5.x stormwater networks (.inp)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description:
          "Action to perform (inspect, lint, to-dae, to-modelica, route-flow, rtc, quality, diff, from-gis, convert, inundate-2d)",
        type: "string",
        choices: [
          "inspect",
          "summary",
          "lint",
          "to-dae",
          "to-modelica",
          "route-flow",
          "rtc",
          "quality",
          "diff",
          "from-gis",
          "convert",
          "inundate-2d",
        ],
        demandOption: true,
      })
      .positional("files", {
        description: "SWMM input deck (.inp) file(s) or conduits GeoJSON for from-gis",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for Modelica export or compiled network .inp)",
        type: "string",
      })
      .option("manholes", {
        type: "string",
        describe: "Optional GeoJSON file containing manholes / outfalls",
      })
      .option("subcatchments", {
        type: "string",
        describe: "Optional GeoJSON file containing catchment polygon boundaries",
      })
      .option("dem", {
        type: "string",
        describe: "Optional digital elevation model raster (.asc, .grd)",
      })
      .option("snap", {
        type: "number",
        describe: "Topological manhole snap tolerance in meters (default: 2.0m)",
      })
      .option("diameter", {
        type: "number",
        describe: "Default conduit diameter in meters (default: 0.6m)",
      })
      .option("manning", {
        type: "number",
        describe: "Default Manning's roughness n (default: 0.013)",
      })
      .option("depth", {
        type: "number",
        describe: "Default manhole depth in meters (default: 2.5m)",
      })
      .option("imperv", {
        type: "number",
        describe: "Default subcatchment imperviousness % (default: 40.0%)",
      })
      .option("title", {
        type: "string",
        describe: "Model deck title",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;

    if (files.length === 0) {
      console.error("[swmm] No SWMM network file(s) specified.");
      process.exit(1);
    }

    if (action === "convert") {
      const dbInput = files[0]!;
      const dbPath = path.resolve(process.cwd(), dbInput);
      if (!fs.existsSync(dbPath)) {
        console.error(`Error: InfoWorks ICM file not found: ${dbInput}`);
        process.exit(1);
      }

      console.log(`Converting InfoWorks ICM / InfoWater database: ${dbInput}...`);
      let deck;
      if (dbInput.endsWith(".json")) {
        const jsonContent = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
        deck = parseInfoWorksDatabase(jsonContent);
      } else {
        deck = parseInfoWorksDatabase(dbPath);
      }

      const inp = serializeSwmm(deck);
      if (out) {
        fs.writeFileSync(path.resolve(process.cwd(), out), inp, "utf-8");
        console.log(`Successfully converted and exported SWMM .inp to ${out}`);
      } else {
        console.log(inp);
      }
      console.log(`\nConversion Summary:`);
      console.log(`  Junctions:     ${deck.junctions.size}`);
      console.log(`  Outfalls:      ${deck.outfalls.size}`);
      console.log(`  Conduits:      ${deck.conduits.size}`);
      console.log(`  Subcatchments: ${deck.subcatchments.size}`);
      console.log(`  Weirs:         ${deck.weirs.size}`);
      console.log(`  Pumps:         ${deck.pumps.size}`);
      return;
    }

    if (action === "from-gis") {
      const conduitsInput = files[0]!;
      const conduitsPath = path.resolve(process.cwd(), conduitsInput);
      if (!fs.existsSync(conduitsPath)) {
        console.error(`Error: Conduits GeoJSON file not found: ${conduitsInput}`);
        process.exit(1);
      }
      const conduitsGeoJson = fs.readFileSync(conduitsPath, "utf-8");

      let manholesGeoJson: string | undefined;
      const manholesOpt = argv["manholes"] as string | undefined;
      if (manholesOpt) {
        const mhPath = path.resolve(process.cwd(), manholesOpt);
        if (fs.existsSync(mhPath)) {
          manholesGeoJson = fs.readFileSync(mhPath, "utf-8");
        } else {
          console.warn(`Warning: Manholes file not found: ${manholesOpt}`);
        }
      }

      let subcatchmentsGeoJson: string | undefined;
      const subOpt = argv["subcatchments"] as string | undefined;
      if (subOpt) {
        const scPath = path.resolve(process.cwd(), subOpt);
        if (fs.existsSync(scPath)) {
          subcatchmentsGeoJson = fs.readFileSync(scPath, "utf-8");
        } else {
          console.warn(`Warning: Subcatchments file not found: ${subOpt}`);
        }
      }

      let demContent: string | undefined;
      const demOpt = argv["dem"] as string | undefined;
      if (demOpt) {
        const demPath = path.resolve(process.cwd(), demOpt);
        if (fs.existsSync(demPath)) {
          demContent = fs.readFileSync(demPath, "utf-8");
        } else {
          console.warn(`Warning: DEM file not found: ${demOpt}`);
        }
      }

      const snapTol = argv["snap"] !== undefined ? Number(argv["snap"]) : 2.0;
      const diam = argv["diameter"] !== undefined ? Number(argv["diameter"]) : 0.6;
      const manningN = argv["manning"] !== undefined ? Number(argv["manning"]) : 0.013;
      const depth = argv["depth"] !== undefined ? Number(argv["depth"]) : 2.5;
      const imperv = argv["imperv"] !== undefined ? Number(argv["imperv"]) : 40.0;
      const title = argv["title"] as string | undefined;

      const deck = buildSwmmFromGis({
        conduitsGeoJson,
        manholesGeoJson,
        subcatchmentsGeoJson,
        dem: demContent,
        snapToleranceM: snapTol,
        defaultDiameterM: diam,
        defaultManningN: manningN,
        defaultManholeDepthM: depth,
        defaultImpervPct: imperv,
        title: title ?? `GIS Ingested: ${path.basename(conduitsInput)}`,
      });

      const serialized = serializeSwmm(deck);
      if (out) {
        fs.writeFileSync(path.resolve(process.cwd(), out), serialized, "utf-8");
        console.log(`\n=== SWMM GIS Ingestion Succeeded ===`);
        console.log(`Saved compiled network deck to: ${out}`);
        console.log(`  Junctions:     ${deck.junctions.size}`);
        console.log(`  Outfalls:      ${deck.outfalls.size}`);
        console.log(`  Conduits:      ${deck.conduits.size}`);
        console.log(`  Subcatchments: ${deck.subcatchments.size}`);
      } else {
        console.log(serialized);
      }
      return;
    }

    if (action === "diff") {
      if (files.length < 2) {
        console.error("Error: Diff requires two SWMM network files: msx swmm diff <base.inp> <target.inp>");
        process.exit(1);
      }
      const baseInput = files[0]!;
      const targetInput = files[1]!;
      const baseFile = path.resolve(process.cwd(), baseInput);
      const targetFile = path.resolve(process.cwd(), targetInput);
      if (!fs.existsSync(baseFile)) {
        console.error(`Error: Base file not found: ${baseInput}`);
        process.exit(1);
      }
      if (!fs.existsSync(targetFile)) {
        console.error(`Error: Target file not found: ${targetInput}`);
        process.exit(1);
      }

      const baseNet = parseSwmm(fs.readFileSync(baseFile, "utf-8"));
      const targetNet = parseSwmm(fs.readFileSync(targetFile, "utf-8"));
      const diff = diffSwmmNetworks(baseNet, targetNet);

      console.log(`\n=== Visual PR Diff: SWMM Drainage Network ===`);
      console.log(`Base:   ${baseInput}`);
      console.log(`Target: ${targetInput}`);
      console.log(`\nDelta Summary:`);
      console.log(
        `  Nodes: +${diff.stats.addedNodes} added, -${diff.stats.deletedNodes} deleted, ~${diff.stats.modifiedNodes} modified, ${diff.stats.unchangedNodes} unchanged`,
      );
      console.log(
        `  Links: +${diff.stats.addedLinks} added, -${diff.stats.deletedLinks} deleted, ~${diff.stats.modifiedLinks} modified, ${diff.stats.unchangedLinks} unchanged`,
      );

      if (diff.stats.modifiedLinks > 0) {
        console.log(`\nModified Conduits:`);
        for (const [id, link] of diff.links) {
          if (link.status === "modified") {
            const deltas = link.propertyDeltas
              .map(
                (d) =>
                  `${d.property}: ${d.baseValue} -> ${d.targetValue} (${(d.delta ?? 0) >= 0 ? "+" : ""}${d.delta})`,
              )
              .join(", ");
            console.log(`  - Conduit '${id}': ${deltas}`);
          }
        }
      }

      if (out) {
        const outPath = path.resolve(process.cwd(), out);
        if (out.endsWith(".json")) {
          fs.writeFileSync(outPath, JSON.stringify(diff, null, 2), "utf-8");
          console.log(`\nSaved semantic diff JSON report to ${out}`);
        }
      }
      return;
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[swmm] File not found: ${absPath}`);
        process.exit(1);
      }

      const text = fs.readFileSync(absPath, "utf-8");
      const deck = parseSwmm(text);

      switch (action) {
        case "lint": {
          console.log(`[swmm] Linting ${path.basename(file)}...`);
          const diags = lintSwmm(deck);
          if (diags.length === 0) {
            console.log("  ✔ No hydraulic network or slope diagnostics found.");
          } else {
            for (const d of diags) {
              const tag = d.severity === "error" ? "✖ ERROR" : d.severity === "warning" ? "▲ WARN" : "ℹ INFO";
              console.log(`  ${tag} [${d.code}] Line ${d.range.startLine}: ${d.message}`);
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
          console.log(`=== SWMM Network: ${deck.title || path.basename(file)} ===`);
          console.log(`  Flow Units:       ${deck.flowUnits}`);
          console.log(`  Routing Model:    ${deck.routingModel}`);
          console.log(`  Junctions:        ${deck.junctions.size}`);
          console.log(`  Outfalls:         ${deck.outfalls.size}`);
          console.log(`  Conduits:         ${deck.conduits.size}`);
          console.log(`  Pumps:            ${deck.pumps.size}`);
          console.log(`  Weirs:            ${deck.weirs.size}`);
          console.log(`  Cross-Sections:   ${deck.crossSections.size}`);
          console.log(`  Subcatchments:    ${deck.subcatchments.size}`);
          break;
        }

        case "to-dae": {
          const dae = lowerSwmmToDae(deck);
          console.log(`[swmm] Lowered network to DAE arena:`);
          console.log(`  Variables: ${dae.variables().length}`);
          console.log(`  Equations: ${dae.equations().length}`);
          break;
        }

        case "to-modelica": {
          const moCode = swmmToModelica(deck);
          if (out) {
            fs.writeFileSync(path.resolve(process.cwd(), out), moCode, "utf-8");
            console.log(`[swmm] Exported Modelica model to ${out}`);
          } else {
            console.log(moCode);
          }
          break;
        }

        case "route-flow": {
          const result = routeNetworkFlow(deck);
          console.log(`=== SWMM Hydraulic Routing Summary ===`);
          console.log(`  Total Inflow:     ${result.totalInflow.toFixed(3)} ${deck.flowUnits}`);
          console.log(`  Total Outflow:    ${result.totalOutflow.toFixed(3)} ${deck.flowUnits}`);
          console.log(`  Flooding Active:  ${result.isFlooding ? "YES" : "NO"}`);
          console.log(`  Conduit Discharges:`);
          for (const [id, res] of result.conduits) {
            console.log(
              `    - ${id.padEnd(12, " ")} Q=${res.flowRate.toFixed(3).padEnd(8, " ")} V=${res.velocity.toFixed(2).padEnd(6, " ")} Depth=${res.depth.toFixed(2).padEnd(6, " ")} Status=${res.status}`,
            );
          }
          break;
        }

        case "rtc": {
          const rtc = simulateSwmmRtc(deck);
          console.log(`=== SWMM Real-Time Control (RTC) Dynamic Wave Routing ===`);
          console.log(`  Rules Executed:       ${rtc.ruleExecutions.length}`);
          console.log(`  Active Rules Count:   ${rtc.activeRulesCount}`);
          console.log(`  CSO Spill Volume:     ${rtc.csoSpillVolumeM3.toFixed(2)} m³`);
          console.log(`  Baseline Spill:       ${rtc.baselineSpillVolumeM3.toFixed(2)} m³`);
          console.log(`  Spill Reduction:      ${rtc.spillReductionPct.toFixed(1)}%`);
          console.log(`  Flooding Active:      ${rtc.isFlooding ? "YES" : "NO"}`);
          console.log(`  Total Inflow:         ${rtc.totalInflow.toFixed(3)} ${deck.flowUnits}`);
          console.log(`  Total Outflow:        ${rtc.totalOutflow.toFixed(3)} ${deck.flowUnits}`);
          break;
        }

        case "quality": {
          const runoffMap = new Map<string, number>();
          for (const [subId, sub] of deck.subcatchments) {
            runoffMap.set(subId, sub.area * 100.0);
          }
          const qual = computeSwmmWaterQuality(deck, runoffMap);
          console.log(`=== SWMM Water Quality Washoff & Pollutant Buildup ===`);
          console.log(`  Dominant Pollutant:   ${qual.dominantPollutant}`);
          console.log(`  Subcatchments Modeled: ${qual.subcatchments.size}`);
          console.log(`  Total Exported Pollutant Mass:`);
          for (const [pol, mass] of Object.entries(qual.totalExportedMassKg)) {
            console.log(`    - ${pol.padEnd(8, " ")}: ${mass.toFixed(2)} kg`);
          }
          break;
        }

        case "inundate-2d": {
          console.log(`\n=== 2D Surface Inundation & Overland Flood Simulation for ${file} (InfoWorks ICM Parity) ===`);
          const mesh = createRegularGrid2DMesh(10, 10, 20.0, 20.0);
          const result = solveSwmmCoupled1D2D(deck, mesh, {
            simulationDurationSeconds: 300.0,
            rainfallIntensityMmPerHr: 45.0,
          });
          console.log(`Peak Inundated Surface Area: ${result.peakFloodedAreaM2.toFixed(1)} m²`);
          console.log(`Peak Surface Ponded Volume:   ${result.peakSurfaceVolumeM3.toFixed(1)} m³`);
          console.log(`Cumulative Manhole Overflow:  ${result.cumulativeSpillVolumeM3.toFixed(2)} m³`);
          console.log(`Cumulative Reverse Drainage:  ${result.cumulativeDrainVolumeM3.toFixed(2)} m³`);
          console.log(`Mass Balance Continuity Error: ${result.massConservationErrorPct.toFixed(2)}%`);
          break;
        }
      }
    }
  },
};
