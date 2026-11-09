// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: OpenDSS Subcommand.
 *
 * Provides headless CLI operations for EPRI OpenDSS distribution network circuits (.dss):
 * - `msx opendss inspect <file>`
 * - `msx opendss lint <file>`
 * - `msx opendss powerflow <file>`
 * - `msx opendss to-dae <file>`
 * - `msx opendss to-modelica <file>`
 */

import {
  evaluateProtection,
  lintOpenDss,
  lowerOpenDssToDae,
  openDssToModelica,
  parseOpenDss,
  solveAdmittancePowerFlow,
  solveDistributionOpf,
  solveDistributionPowerFlow,
  solveFaultStudy,
  solveFlisr,
  solveGic,
  solveHarmonics,
  solveHostingCapacity,
  solveReliability,
} from "@modelscript/opendss";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const OpenDssCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "opendss <action> [files...]",
  describe:
    "Inspect, lint, solve sparse Ybus, faults, harmonics, reliability, GIC, hosting capacity, and FLISR on OpenDSS circuits (.dss)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description:
          "Action to perform (inspect, lint, powerflow, ybus, opf, fault, harmonics, protection, reliability, gic, hca, flisr, to-dae, to-modelica)",
        type: "string",
        choices: [
          "inspect",
          "summary",
          "lint",
          "powerflow",
          "ybus",
          "opf",
          "d-opf",
          "fault",
          "harmonics",
          "protection",
          "reliability",
          "gic",
          "hca",
          "hosting-capacity",
          "flisr",
          "to-dae",
          "to-modelica",
        ],
        demandOption: true,
      })
      .positional("files", {
        description: "OpenDSS circuit script(s) (.dss) to process",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for Modelica export)",
        type: "string",
      })
      .option("bus", {
        description: "Target bus for fault study or hosting capacity",
        type: "string",
      })
      .option("tie", {
        description: "Tie line name for FLISR back-feed restoration",
        type: "string",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const out = argv["out"] as string | undefined;

    if (files.length === 0) {
      console.error("[opendss] No OpenDSS circuit file(s) specified.");
      process.exit(1);
    }

    for (const file of files) {
      const absPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(absPath)) {
        console.error(`[opendss] File not found: ${absPath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(absPath, "utf-8");
      const deck = parseOpenDss(content, path.basename(absPath));

      switch (action) {
        case "inspect":
        case "summary": {
          console.log(`\n=== OpenDSS Circuit Summary: ${path.basename(file)} ===`);
          if (deck.circuit) {
            console.log(
              `Substation Circuit: ${deck.circuit.name} (${deck.circuit.baseKv} kV, ${deck.circuit.pu} pu, Bus: ${deck.circuit.bus1})`,
            );
          } else {
            console.log(`Substation Circuit: [No Circuit source defined]`);
          }
          console.log(`Transformers: ${deck.transformers.size}`);
          console.log(`Lines:        ${deck.lines.size}`);
          console.log(`Loads:        ${deck.loads.size}`);
          console.log(`PV Systems:   ${deck.pvSystems.size}`);
          console.log(`Storage BESS: ${deck.storages.size}`);
          console.log(`Capacitors:   ${deck.capacitors.size}`);
          break;
        }

        case "lint": {
          const diags = lintOpenDss(deck);
          console.log(`\n=== OpenDSS Lint Results: ${path.basename(file)} ===`);
          if (diags.length === 0) {
            console.log("✓ No issues detected (0 diagnostics).");
          } else {
            for (const d of diags) {
              const prefix = d.severity === "error" ? "ERROR" : "WARNING";
              console.log(`[${prefix}] [M${d.code}] Line ${d.range.startLine}: ${d.message}`);
            }
          }
          break;
        }

        case "powerflow": {
          const pf = solveDistributionPowerFlow(deck);
          console.log(`\n=== OpenDSS Power Flow Results: ${path.basename(file)} ===`);
          console.log(`Status:       ${pf.converged ? "✓ CONVERGED" : "⚠ DID NOT CONVERGE"}`);
          console.log(`Iterations:   ${pf.iterations}`);
          console.log(`Total Load:   ${pf.totalLoadKw.toFixed(1)} kW + j${pf.totalLoadKvar.toFixed(1)} kvar`);
          console.log(`Total Gen:    ${pf.totalGenKw.toFixed(1)} kW`);
          console.log(`Losses:       ${pf.lossesKw.toFixed(2)} kW`);
          console.log(`Bus Voltages:`);
          for (const [bName, bRes] of pf.buses) {
            console.log(`  Bus '${bName}': ${bRes.voltagePu.toFixed(4)} pu (${bRes.voltageKv.toFixed(2)} kV)`);
          }
          break;
        }

        case "ybus": {
          const pf = solveAdmittancePowerFlow(deck);
          console.log(`\n=== OpenDSS Sparse [Ybus] Power Flow: ${path.basename(file)} ===`);
          console.log(`Status:       ${pf.converged ? "✓ CONVERGED" : "⚠ DID NOT CONVERGE"}`);
          console.log(`Iterations:   ${pf.iterations}`);
          console.log(`Total Load:   ${pf.totalLoadKw.toFixed(1)} kW + j${pf.totalLoadKvar.toFixed(1)} kvar`);
          console.log(`Total Gen:    ${pf.totalGenKw.toFixed(1)} kW`);
          console.log(`Losses:       ${pf.lossesKw.toFixed(2)} kW`);
          if (pf.controlActions && pf.controlActions.length > 0) {
            console.log(`Controls:     ${pf.controlActions.length} actions executed`);
            for (const act of pf.controlActions) console.log(`  - ${act}`);
          }
          console.log(`Bus Voltages:`);
          for (const [bName, bRes] of pf.buses) {
            console.log(
              `  Bus '${bName}': ${bRes.vMagPu.toFixed(4)} pu (${bRes.voltageKv.toFixed(2)} kV, ${bRes.vAngleDeg.toFixed(1)}°) VUF: ${(bRes.voltageUnbalanceFactor * 100).toFixed(2)}%`,
            );
          }
          break;
        }

        case "fault": {
          const faultRes = solveFaultStudy(deck);
          console.log(`\n=== OpenDSS Short-Circuit Fault Study: ${path.basename(file)} ===`);
          const targetBuses = argv["bus"] ? [argv["bus"] as string] : Array.from(faultRes.buses.keys());
          for (const bName of targetBuses) {
            const b = faultRes.buses.get(bName);
            if (!b) continue;
            console.log(`Bus '${bName}' (Zthev: ${b.theveninR.toFixed(3)} + j${b.theveninX.toFixed(3)} Ω):`);
            console.log(`  3-Phase Fault: ${b.iFault3PhaseAmps.toFixed(1)} A (${b.shortCircuitMva.toFixed(2)} MVA)`);
            console.log(`  SLG Fault:     ${b.iFaultSlgAmps.toFixed(1)} A`);
            console.log(`  L-L Fault:     ${b.iFaultLlAmps.toFixed(1)} A`);
          }
          break;
        }

        case "harmonics": {
          const harm = solveHarmonics(deck);
          console.log(`\n=== OpenDSS Frequency Harmonics Study: ${path.basename(file)} ===`);
          console.log(`Evaluated Orders: ${harm.harmonicOrders.join(", ")}`);
          console.log(`Max Feeder THD:   ${harm.maxThdPercent.toFixed(2)}% at Bus '${harm.maxThdBus}'`);
          console.log(`Bus THD Summary:`);
          for (const [bName, bRes] of harm.buses) {
            console.log(
              `  Bus '${bName}': V_fund = ${bRes.fundamentalV.toFixed(1)} V, THD = ${bRes.thdPercent.toFixed(2)}%`,
            );
          }
          break;
        }

        case "protection": {
          const currents = new Map<string, number>();
          for (const [lName] of deck.lines) currents.set(`Line.${lName}`, 1200);
          const prot = evaluateProtection(deck, currents);
          console.log(`\n=== OpenDSS Protection TCC Evaluation: ${path.basename(file)} ===`);
          console.log(`All Coordinated: ${prot.allCoordinated ? "✓ YES" : "⚠ NO"}`);
          for (const [dName, dRes] of prot.devices) {
            console.log(
              `  Device '${dName}': ${dRes.tripped ? "TRIPPED" : "HELD"} at ${dRes.tripTimeSeconds.toFixed(3)} s`,
            );
          }
          break;
        }

        case "reliability": {
          const rel = solveReliability(deck);
          console.log(`\n=== OpenDSS Predictive Reliability (IEEE 1366): ${path.basename(file)} ===`);
          console.log(`Total Customers: ${rel.system.totalCustomers}`);
          console.log(`SAIFI:           ${rel.system.saifi.toFixed(4)} interruptions/cust/yr`);
          console.log(`SAIDI:           ${rel.system.saidi.toFixed(2)} hours/cust/yr`);
          console.log(`CAIDI:           ${rel.system.caidi.toFixed(2)} hours/interruption`);
          console.log(`ASAI:            ${(rel.system.asai * 100).toFixed(4)}%`);
          console.log(`EEN:             ${rel.system.eenKwh.toFixed(1)} kWh/yr`);
          console.log(`Top Critical Branches:`);
          for (const br of rel.criticalBranches.slice(0, 3)) {
            console.log(
              `  - Line '${br.lineName}': ${br.annualFailures.toFixed(2)} fails/yr, ${br.customersAffected} cust affected`,
            );
          }
          break;
        }

        case "gic": {
          const gic = solveGic(deck);
          console.log(`\n=== OpenDSS Space Weather / GIC Analysis: ${path.basename(file)} ===`);
          console.log(
            `Max Neutral DC Current: ${gic.maxNeutralCurrentAmps.toFixed(2)} A at Bus '${gic.maxNeutralBus}'`,
          );
          console.log(`Total GIC Q Loss:       ${gic.totalGicLossMvar.toFixed(2)} Mvar`);
          if (gic.atRiskTransformers.length > 0) {
            console.log(`⚠ Transformers at Saturation Risk: ${gic.atRiskTransformers.join(", ")}`);
          } else {
            console.log(`✓ No transformers exceed 10A DC half-cycle saturation limit.`);
          }
          break;
        }

        case "hca":
        case "hosting-capacity": {
          const targetBus = argv["bus"] as string | undefined;
          const hc = solveHostingCapacity(deck, targetBus ? { targetBus } : undefined);
          console.log(`\n=== OpenDSS DER Hosting Capacity: ${path.basename(file)} ===`);
          console.log(`Target Bus:          ${hc.targetBus}`);
          console.log(
            `Hosting Capacity:    ${hc.hostingCapacityKw.toFixed(1)} kW (${(hc.hostingCapacityKw / 1000).toFixed(2)} MW)`,
          );
          console.log(`Limiting Criterion:  ${hc.limitingCriterion.toUpperCase()}`);
          console.log(`Limiting Element:    ${hc.limitingElement} (${hc.limitingValue.toFixed(4)})`);
          console.log(
            `Baseline Voltage:    ${hc.baselineMinVoltagePu.toFixed(4)} to ${hc.baselineMaxVoltagePu.toFixed(4)} pu`,
          );
          break;
        }

        case "flisr": {
          const tieLine = argv["tie"] as string | undefined;
          const faulted = (argv["bus"] as string | undefined) ?? deck.lines.keys().next().value ?? "Line1";
          const flisr = solveFlisr(deck, faulted, tieLine ? { tieLineName: tieLine } : undefined);
          console.log(`\n=== OpenDSS Automated FLISR Feeder Reconfiguration: ${path.basename(file)} ===`);
          console.log(`Faulted Segment:     ${flisr.faultedLine}`);
          console.log(`Restoration Success: ${flisr.restorationSuccess ? "✓ SUCCESS" : "⚠ INCOMPLETE"}`);
          console.log(`Upstream Restored:   ${flisr.customersRestoredUpstream} customers`);
          console.log(
            `Downstream Restored: ${flisr.customersRestoredDownstream} customers (via ${flisr.tieSwitchOperated || "none"})`,
          );
          console.log(`Remaining Unserved:  ${flisr.customersRemainingUnserved} customers`);
          console.log(`Outage Hours Saved:  ${flisr.customerInterruptionHoursSaved.toFixed(1)} cust-hours`);
          break;
        }

        case "opf":
        case "d-opf": {
          const dopf = solveDistributionOpf(deck);
          console.log(dopf.reportText);
          break;
        }

        case "to-dae": {
          const dae = lowerOpenDssToDae(deck);
          console.log(`\n=== OpenDSS DAE Lowering: ${path.basename(file)} ===`);
          console.log(`Model Name:    ${deck.circuit?.name || "DistributionGrid"}`);
          console.log(`DAE Variables: ${dae.variables().length}`);
          console.log(`DAE Equations: ${dae.equations().length}`);
          break;
        }

        case "to-modelica": {
          const moCode = openDssToModelica(deck);
          if (out) {
            const outPath = path.resolve(process.cwd(), out);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, moCode, "utf-8");
            console.log(`[opendss] Exported Modelica model to ${outPath}`);
          } else {
            console.log(moCode);
          }
          break;
        }

        default:
          console.error(`[opendss] Unknown action: ${action}`);
          process.exit(1);
      }
    }
  },
};
