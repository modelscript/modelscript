// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  epanetToModelica,
  lintEpanet,
  lowerEpanetToDae,
  parseInp,
  performAwwaM36WaterAudit,
  solveExtendedPeriod,
  solveHydraulics,
  solveOptimalPumpScheduling,
  solvePddHydraulics,
  solveWaterHammerMoc,
  solveWaterQuality,
} from "@modelscript/epanet";
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
          "Action to perform: inspect | lint | solve | eps | pdd | surge | audit | ops | quality | to-modelica | to-dae",
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
          "to-modelica",
          "to-dae",
        ],
      })
      .positional("files", {
        type: "string",
        array: true,
        describe: "Input EPANET network files (.inp)",
      })
      .option("out", {
        alias: ["o", "output"],
        type: "string",
        describe: "Output file path for generated Modelica code",
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
