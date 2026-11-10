// SPDX-License-Identifier: AGPL-3.0-or-later
import { diffEpanetNetworks, renderEpanetDiffSvg } from "@modelscript/diagram/water-network-diff";
import {
  buildEpanetFromGis,
  epanetToModelica,
  extractEpanetScreeningModel,
  lintEpanet,
  lowerEpanetToDae,
  parseInp,
  parseWaterGemsDatabase,
  performAwwaM36WaterAudit,
  serializeInp,
  solveExtendedPeriod,
  solveHydraulics,
  solveOptimalPumpScheduling,
  solvePddHydraulics,
  solveWaterHammerMoc,
  solveWaterQuality,
} from "@modelscript/epanet";
import { calculateWaterNetworkSensitivities, WebGpuWaterScreener } from "@modelscript/simulate";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const EpanetCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "epanet <action> [files...]",
  describe: "Inspect, validate, solve hydraulics, lower to DAE, and project US EPA EPANET water networks (.inp)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        type: "string",
        describe:
          "Action to perform: inspect | lint | solve | eps | pdd | surge | audit | ops | quality | diff | from-gis | convert | screen-contingencies | to-modelica | to-dae",
        choices: [
          "inspect",
          "lint",
          "solve",
          "eps",
          "pdd",
          "surge",
          "audit",
          "ops",
          "quality",
          "diff",
          "from-gis",
          "convert",
          "screen-contingencies",
          "to-modelica",
          "to-dae",
        ],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input EPANET network files (.inp) or GeoJSON pipes for from-gis",
      })
      .option("screening-mode", {
        type: "string",
        choices: ["ALL_N1_OUTAGES", "ALL_FIRE_HYDRANTS", "COMBINED"],
        default: "COMBINED",
        describe: "Parallel screening mode: ALL_N1_OUTAGES | ALL_FIRE_HYDRANTS | COMBINED",
      })
      .option("residual-pressure", {
        type: "number",
        default: 14.06,
        describe: "Minimum residual pressure in meters (default: 14.06m = 20 psi)",
      })
      .option("max-velocity", {
        type: "number",
        default: 2.5,
        describe: "Maximum pipe velocity limit in m/s (default: 2.5)",
      })
      .option("fire-flow", {
        type: "number",
        default: 63.09,
        describe: "Standard test fire flow in L/s (default: 63.09 L/s = 1000 gpm)",
      })
      .option("prefer-cpu", {
        type: "boolean",
        default: true,
        describe: "Prefer CPU SIMD execution over WebGPU (default: true)",
      })

      .option("out", {
        alias: ["o", "output"],
        type: "string",
        describe: "Output file path for generated Modelica code or compiled network .inp",
      })
      .option("nodes", {
        type: "string",
        describe: "Optional GeoJSON file containing node/junction/reservoir assets",
      })
      .option("dem", {
        type: "string",
        describe: "Optional digital elevation model raster (.asc, .grd)",
      })
      .option("snap", {
        type: "number",
        describe: "Topological node snap tolerance in meters (default: 1.5m)",
      })
      .option("diameter", {
        type: "number",
        describe: "Default pipe diameter in mm (default: 200mm)",
      })
      .option("roughness", {
        type: "number",
        describe: "Default pipe Hazen-Williams C factor (default: 120)",
      })
      .option("demand", {
        type: "number",
        describe: "Default junction base demand in L/s (default: 0.0)",
      })
      .option("title", {
        type: "string",
        describe: "Network model title",
      })
      .option("max-iter", {
        type: "number",
        default: 40,
        describe: "Maximum Todini hydraulic iterations",
      })
      .option("tolerance", {
        type: "number",
        default: 0.001,
        describe: "Relative flow convergence tolerance",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const outFile = argv["out"] as string | undefined;

    if (files.length === 0) {
      console.error("Error: No input files provided.");
      process.exit(1);
    }

    if (action === "convert") {
      const dbInput = files[0]!;
      const dbPath = path.resolve(process.cwd(), dbInput);
      if (!fs.existsSync(dbPath)) {
        console.error(`Error: Database file not found: ${dbInput}`);
        process.exit(1);
      }

      console.log(`Converting Bentley WaterGEMS / HAMMER / InfoWater model: ${dbInput}...`);
      let net;
      if (dbInput.endsWith(".json")) {
        const jsonContent = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
        net = parseWaterGemsDatabase(jsonContent);
      } else {
        net = parseWaterGemsDatabase(dbPath);
      }

      const inp = serializeInp(net);
      if (outFile) {
        fs.writeFileSync(path.resolve(process.cwd(), outFile), inp, "utf-8");
        console.log(`Successfully converted and exported EPANET .inp to ${outFile}`);
      } else {
        console.log(inp);
      }
      console.log(`\nConversion Summary:`);
      console.log(`  Junctions:  ${net.junctions.length}`);
      console.log(`  Pipes:      ${net.pipes.length}`);
      console.log(`  Pumps:      ${net.pumps.length}`);
      console.log(`  Valves:     ${net.valves.length}`);
      console.log(`  Reservoirs: ${net.reservoirs.length}`);
      console.log(`  Tanks:      ${net.tanks.length}`);
      return;
    }

    if (action === "from-gis") {
      const pipesInput = files[0]!;
      const pipesPath = path.resolve(process.cwd(), pipesInput);
      if (!fs.existsSync(pipesPath)) {
        console.error(`Error: Pipes GeoJSON file not found: ${pipesInput}`);
        process.exit(1);
      }
      const pipesGeoJson = fs.readFileSync(pipesPath, "utf-8");

      let nodesGeoJson: string | undefined;
      const nodesOpt = argv["nodes"] as string | undefined;
      if (nodesOpt) {
        const nodesPath = path.resolve(process.cwd(), nodesOpt);
        if (fs.existsSync(nodesPath)) {
          nodesGeoJson = fs.readFileSync(nodesPath, "utf-8");
        } else {
          console.warn(`Warning: Nodes file not found: ${nodesOpt}`);
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

      const snapTol = argv["snap"] !== undefined ? Number(argv["snap"]) : 1.5;
      const diam = argv["diameter"] !== undefined ? Number(argv["diameter"]) : 200.0;
      const roughness = argv["roughness"] !== undefined ? Number(argv["roughness"]) : 120.0;
      const demand = argv["demand"] !== undefined ? Number(argv["demand"]) : 0.0;
      const title = argv["title"] as string | undefined;

      const net = buildEpanetFromGis({
        pipesGeoJson,
        nodesGeoJson,
        dem: demContent,
        snapToleranceM: snapTol,
        defaultDiameterMm: diam,
        defaultRoughness: roughness,
        defaultDemandLps: demand,
        networkTitle: title ?? `GIS Ingested: ${path.basename(pipesInput)}`,
      });

      const serialized = serializeInp(net);
      if (outFile) {
        fs.writeFileSync(path.resolve(process.cwd(), outFile), serialized, "utf-8");
        console.log(`\n=== EPANET GIS Ingestion Succeeded ===`);
        console.log(`Saved compiled network to: ${outFile}`);
        console.log(`  Junctions:  ${net.junctions.length}`);
        console.log(`  Reservoirs: ${net.reservoirs.length}`);
        console.log(`  Tanks:      ${net.tanks.length}`);
        console.log(`  Pipes:      ${net.pipes.length}`);
      } else {
        console.log(serialized);
      }
      return;
    }

    if (action === "diff") {
      if (files.length < 2) {
        console.error("Error: Diff requires two EPANET network files: msx epanet diff <base.inp> <target.inp>");
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

      const baseNet = parseInp(fs.readFileSync(baseFile, "utf-8"), baseInput);
      const targetNet = parseInp(fs.readFileSync(targetFile, "utf-8"), targetInput);
      const diff = diffEpanetNetworks(baseNet, targetNet);

      console.log(`\n=== Visual PR Diff: EPANET Drinking Water System ===`);
      console.log(`Base:   ${baseInput}`);
      console.log(`Target: ${targetInput}`);
      console.log(`\nDelta Summary:`);
      console.log(
        `  Nodes: +${diff.stats.addedNodes} added, -${diff.stats.deletedNodes} deleted, ~${diff.stats.modifiedNodes} modified, ${diff.stats.unchangedNodes} unchanged`,
      );
      console.log(
        `  Links: +${diff.stats.addedLinks} added, -${diff.stats.deletedLinks} deleted, ~${diff.stats.modifiedLinks} modified, ${diff.stats.unchangedLinks} unchanged`,
      );
      if (diff.stats.maxPressureDeltaM !== 0 || diff.stats.maxVelocityDeltaMs !== 0) {
        console.log(
          `  Hydraulic Impact: Max ΔP = ${diff.stats.maxPressureDeltaM.toFixed(2)} m, Max ΔV = ${diff.stats.maxVelocityDeltaMs.toFixed(2)} m/s`,
        );
      }

      if (diff.stats.modifiedLinks > 0) {
        console.log(`\nModified Links:`);
        for (const [id, link] of diff.links) {
          if (link.status === "modified") {
            const deltas = link.propertyDeltas
              .map(
                (d) =>
                  `${d.property}: ${d.baseValue} -> ${d.targetValue} (${(d.delta ?? 0) >= 0 ? "+" : ""}${d.delta})`,
              )
              .join(", ");
            console.log(`  - Pipe '${id}': ${deltas}`);
          }
        }
      }

      if (outFile) {
        const outPath = path.resolve(process.cwd(), outFile);
        if (outFile.endsWith(".svg")) {
          const svg = renderEpanetDiffSvg(diff, { theme: "dark" });
          fs.writeFileSync(outPath, svg, "utf-8");
          console.log(`\nSaved visual diff SVG schematic to ${outFile}`);
        } else if (outFile.endsWith(".html")) {
          const svg = renderEpanetDiffSvg(diff, { theme: "dark" });
          const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Water Network Diff</title><style>body{margin:0;padding:24px;background:#0d1117;display:flex;justify-content:center;align-items:center;min-height:100vh;}</style></head><body>${svg}</body></html>`;
          fs.writeFileSync(outPath, html, "utf-8");
          console.log(`\nSaved visual diff HTML review bundle to ${outFile}`);
        } else if (outFile.endsWith(".json")) {
          fs.writeFileSync(outPath, JSON.stringify(diff, null, 2), "utf-8");
          console.log(`\nSaved semantic diff JSON report to ${outFile}`);
        }
      }
      return;
    }

    for (const file of files) {
      const fullPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(fullPath)) {
        console.error(`Error: File not found: ${file}`);
        process.exit(1);
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      const net = parseInp(content, file);

      switch (action) {
        case "inspect": {
          console.log(`\n=== US EPA EPANET Network: ${net.title ?? path.basename(file)} ===`);
          console.log(`Junctions: ${net.junctions.length}`);
          for (const j of net.junctions) {
            console.log(`  - Junction '${j.id}' (elev=${j.elevation} m, baseDemand=${j.demand} LPS)`);
          }
          console.log(`Reservoirs: ${net.reservoirs.length}`);
          for (const r of net.reservoirs) {
            console.log(`  - Reservoir '${r.id}' (head=${r.totalHead} m)`);
          }
          console.log(`Tanks: ${net.tanks.length}`);
          for (const t of net.tanks) {
            console.log(`  - Tank '${t.id}' (elev=${t.elevation} m, initLevel=${t.initLevel} m)`);
          }
          console.log(`Pipes: ${net.pipes.length}`);
          for (const p of net.pipes) {
            console.log(
              `  - Pipe '${p.id}': ${p.node1} -> ${p.node2} (L=${p.length} m, D=${p.diameter} mm, C=${p.roughness})`,
            );
          }
          console.log(`Pumps: ${net.pumps.length}`);
          console.log(`Valves: ${net.valves.length}`);
          break;
        }

        case "lint": {
          const diags = lintEpanet(net);
          if (diags.length === 0) {
            console.log(`[PASS] ${file}: 0 diagnostics reported.`);
          } else {
            console.log(`Found ${diags.length} diagnostic(s) in ${file}:`);
            for (const d of diags) {
              const loc = `${file}:${d.range.startLine}:${d.range.startColumn}`;
              console.log(`  [${d.code}] [${d.severity.toUpperCase()}] ${loc} - ${d.message}`);
            }
          }
          break;
        }

        case "solve": {
          const maxIter = (argv["max-iter"] as number) ?? 40;
          const tol = (argv["tolerance"] as number) ?? 0.001;
          const res = solveHydraulics(net, { maxIterations: maxIter, tolerance: tol });
          console.log(`\n=== Todini Global Gradient Hydraulic Solution for ${net.title ?? path.basename(file)} ===`);
          console.log(
            `Status: ${res.converged ? "CONVERGED" : "FAILED"} in ${res.iterations} iterations (maxFlowDelta=${res.maxFlowChange.toExponential(4)})`,
          );
          console.log(`Nodal Heads & Pressures:`);
          for (const [nodeId, head] of res.nodeHeads) {
            const press = res.nodePressures.get(nodeId) ?? 0.0;
            console.log(`  Node '${nodeId}': Head = ${head.toFixed(2)} m, Pressure = ${press.toFixed(2)} m`);
          }
          console.log(`Link Flows:`);
          for (const [linkId, flow] of res.linkFlows) {
            console.log(`  Link '${linkId}': Flow = ${flow.toFixed(3)} LPS`);
          }
          break;
        }

        case "eps": {
          const eps = solveExtendedPeriod(net);
          console.log(`\n=== Extended Period Simulation (EPS) for ${net.title ?? path.basename(file)} ===`);
          console.log(`Duration: ${eps.steps.length} hydraulic steps`);
          console.log(`Min System Pressure: ${eps.minSystemPressure.toFixed(2)} m`);
          console.log(`Max System Pressure: ${eps.maxSystemPressure.toFixed(2)} m`);
          console.log(`Total Pumping Energy: ${eps.totalEnergyKwh.toFixed(2)} kWh`);
          if (eps.criticalJunctions.length > 0) {
            console.log(`Critical Low Pressure Nodes: ${eps.criticalJunctions.join(", ")}`);
          }
          break;
        }

        case "pdd": {
          const pdd = solvePddHydraulics(net);
          console.log(`\n=== Pressure-Dependent Demand (PDD) Evaluation for ${net.title ?? path.basename(file)} ===`);
          console.log(`Global Satisfaction: ${(pdd.satisfactionRatio * 100).toFixed(1)}%`);
          console.log(`Required Total Demand:  ${pdd.requiredDemandLps.toFixed(2)} LPS`);
          console.log(`Delivered Total Demand: ${pdd.deliveredDemandLps.toFixed(2)} LPS`);
          console.log(`Deficit / Shortfall:    ${pdd.unsuppliedDemandLps.toFixed(2)} LPS`);
          if (pdd.unservedNodes.length > 0) {
            console.log(`Unserved Nodes (${pdd.unservedNodes.length}): ${pdd.unservedNodes.slice(0, 10).join(", ")}`);
          } else {
            console.log(`✔ All nodes received 100% required demand.`);
          }
          break;
        }

        case "surge": {
          const pipe = net.pipes[0] ?? {
            id: "MAIN_TRANSMISSION",
            length: 1000.0,
            diameter: 300.0,
            roughness: 100,
            node1: "N1",
            node2: "N2",
          };
          const hyd = solveHydraulics(net);
          const flowLps = Math.abs(hyd.linkFlows.get(pipe.id) ?? 50.0);
          const surge = solveWaterHammerMoc(
            {
              id: pipe.id,
              lengthM: pipe.length,
              diameterM: pipe.diameter / 1000.0,
              waveSpeedMps: 1200.0,
            },
            {
              flowM3s: flowLps / 1000.0,
              headUpstreamM: hyd.nodeHeads.get(pipe.node1) ?? 50.0,
              headDownstreamM: hyd.nodeHeads.get(pipe.node2) ?? 45.0,
            },
            {
              type: "VALVE_CLOSURE",
              durationSeconds: 0.5,
            },
          );
          console.log(
            `\n=== Method of Characteristics (MOC) Water Hammer Surge for ${net.title ?? path.basename(file)} ===`,
          );
          console.log(`Pipe Evaluated:     ${pipe.id} (L=${pipe.length} m, D=${pipe.diameter} mm)`);
          console.log(
            `Max System Head:    ${surge.maxHeadM.toFixed(2)} m (Joukowsky Surge dH = ${surge.joukowskySurgeM.toFixed(2)} m)`,
          );
          console.log(`Min System Head:    ${surge.minHeadM.toFixed(2)} m`);
          console.log(`Max Pressure:       ${surge.maxPressurePsi.toFixed(2)} psi`);
          console.log(
            `Cavitation Risk:    ${surge.cavitationOccurred ? "YES (Vapor column separation detected)" : "NO"}`,
          );
          console.log(`Fundamental Period: ${surge.fundamentalPeriodSeconds.toFixed(3)} s`);
          break;
        }

        case "audit": {
          let totalBaseDemandLps = 0;
          for (const j of net.junctions) {
            totalBaseDemandLps += Math.max(0, j.demand);
          }
          const annualDemandM3 = totalBaseDemandLps * 0.001 * 86400 * 365;
          const inputVolume = Math.max(1000, annualDemandM3 * 1.15);
          const audit = performAwwaM36WaterAudit(net, {
            systemInputVolumeM3Year: inputVolume,
            billedMeteredM3Year: annualDemandM3 * 0.85,
            serviceConnectionsCount: Math.max(100, net.junctions.length * 50),
          });
          console.log(`\n=== AWWA M36 Water Audit & Loss Control for ${net.title ?? path.basename(file)} ===`);
          console.log(`Infrastructure Leakage Index (ILI): ${audit.ili.toFixed(2)} (Band ${audit.performanceBand})`);
          console.log(
            `Non-Revenue Water:                  ${audit.nonRevenueWaterPct.toFixed(1)}% (${(audit.nonRevenueWaterM3Year / 1e6).toFixed(3)} Mm³/yr)`,
          );
          console.log(
            `Real Losses:                        ${(audit.realLossesM3Year / 1e6).toFixed(3)} Mm³/yr (Cost: $${(audit.financialImpact.realLossCostUsd / 1e6).toFixed(2)}M/yr)`,
          );
          console.log(
            `Apparent Losses:                    ${(audit.apparentLossesM3Year / 1e6).toFixed(3)} Mm³/yr (Lost Revenue: $${(audit.financialImpact.apparentLossRevenueLostUsd / 1e6).toFixed(2)}M/yr)`,
          );
          break;
        }

        case "ops": {
          const ops = solveOptimalPumpScheduling(net);
          console.log(`\n=== Optimal Pump Scheduling (OPS) for ${net.title ?? path.basename(file)} ===`);
          console.log(
            `Total Energy:     ${ops.totalEnergyKwh.toFixed(1)} kWh (Baseline: ${ops.baselineEnergyKwh.toFixed(1)} kWh)`,
          );
          console.log(`Total Cost:       $${ops.totalCost.toFixed(2)} (Baseline: $${ops.baselineCost.toFixed(2)})`);
          console.log(`Cost Savings:     ${ops.costSavingsPct.toFixed(1)}%`);
          console.log(
            `Peak Power Draw:  ${ops.peakPowerKw.toFixed(1)} kW (Demand Charge: $${ops.demandChargeCost.toFixed(2)})`,
          );
          console.log(`Summary:          ${ops.summary}`);
          break;
        }

        case "quality": {
          const qual = solveWaterQuality(net);
          console.log(
            `\n=== Water Quality Simulation (Chlorine Residual & Decay) for ${net.title ?? path.basename(file)} ===`,
          );
          console.log(`Parameter:             ${qual.parameter}`);
          console.log(`System Average:        ${qual.systemAverageValue.toFixed(2)} mg/L`);
          console.log(`Min System Residual:   ${qual.minSystemResidual.toFixed(2)} mg/L`);
          if (qual.criticalNodes.length > 0) {
            console.log(`Critical Nodes Below 0.2 mg/L: ${qual.criticalNodes.join(", ")}`);
          }
          console.log(`Summary:               ${qual.summary}`);
          break;
        }

        case "screen-contingencies": {
          const model = extractEpanetScreeningModel(net);
          const sens = calculateWaterNetworkSensitivities(model.nodes, model.pipes);
          const screener = await WebGpuWaterScreener.create(null);
          const mode = (argv["screening-mode"] as string) ?? "COMBINED";
          const minResidualPressureM = Number(argv["residual-pressure"] ?? 14.06);
          const maxVelocityMps = Number(argv["max-velocity"] ?? 2.5);
          const fireFlowDrawLps = Number(argv["fire-flow"] ?? 63.09);
          const preferCpu = argv["prefer-cpu"] !== false;

          console.log(`\n=== Batched Hydraulic Screening for ${net.title ?? path.basename(file)} ===`);
          console.log(`Backend:           ${preferCpu ? "CPU SIMD Fallback" : "WebGPU Compute Shaders"}`);
          console.log(`Nodes Monitored:   ${sens.nodeCount}`);
          console.log(`Pipes Monitored:   ${sens.pipeCount}`);

          if (mode === "ALL_N1_OUTAGES" || mode === "COMBINED") {
            const outageRes = await screener.screenAllPipeOutages(sens, {
              minResidualPressureM,
              maxVelocityMps,
              preferCpu,
            });
            console.log(
              `\n--- N-1 Pipe Outage Screening (${outageRes.scenariosEvaluated} pipes evaluated in ${outageRes.executionTimeMs.toFixed(2)} ms) ---`,
            );
            console.log(
              `Vulnerable Scenarios: ${outageRes.vulnerableScenariosCount} / ${outageRes.scenariosEvaluated}`,
            );
            console.log(`Top Critical Pipes (Single Points of Failure):`);
            for (const p of outageRes.topCriticalPipes ?? []) {
              console.log(
                `  [Rank ${p.pipeIndex + 1}] Pipe ${p.pipeId}: Deficit ${p.unsuppliedDemandLps.toFixed(1)} L/s, Min P = ${p.minPressureM.toFixed(1)} m, Score = ${p.criticalityScore}`,
              );
            }
          }

          if (mode === "ALL_FIRE_HYDRANTS" || mode === "COMBINED") {
            const fireRes = await screener.screenAllFireHydrants(sens, {
              minResidualPressureM,
              fireFlowDrawLps,
              preferCpu,
            });
            console.log(
              `\n--- Fire Flow Capacity Screening (${fireRes.scenariosEvaluated} junctions evaluated in ${fireRes.executionTimeMs.toFixed(2)} ms) ---`,
            );
            console.log(`Deficient Hydrants: ${fireRes.vulnerableScenariosCount} / ${fireRes.scenariosEvaluated}`);
            for (const h of fireRes.fireFlowCapacities?.slice(0, 10) ?? []) {
              console.log(
                `  Junction ${h.nodeId}: Available Fire Flow = ${h.availableFireFlowLps.toFixed(1)} L/s, Res P = ${h.residualPressureM.toFixed(1)} m [${h.nfpaClass}]`,
              );
            }
          }
          break;
        }

        case "to-modelica": {
          const modelica = epanetToModelica(net);
          if (outFile) {
            fs.writeFileSync(path.resolve(process.cwd(), outFile), modelica, "utf-8");
            console.log(`Saved Modelica.Fluid water distribution model to ${outFile}`);
          } else {
            console.log(modelica);
          }
          break;
        }

        case "to-dae": {
          const arena = lowerEpanetToDae(net);
          console.log(`Lowered EPANET water distribution network into linear DAE arena:`);
          console.log(`  Variables: ${arena.getVarCount()}`);
          console.log(`  Equations: ${arena.getEqCount()}`);
          break;
        }

        default:
          console.error(`Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
