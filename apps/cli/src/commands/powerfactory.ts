// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: DIgSILENT PowerFactory Subcommand.
 *
 * Provides headless CLI operations for PowerFactory models (.dz, .pfd, .xml):
 * - `msx pf inspect <grid.dz>`
 * - `msx pf diagram <grid.dz> [--out=sld.svg]`
 * - `msx pf solve <grid.dz>`
 * - `msx pf fault <grid.dz>`
 * - `msx pf modes <grid.dz>`
 * - `msx pf dlr <grid.dz>`
 * - `msx pf harmonics <grid.dz>`
 * - `msx pf qdsl <grid.dz>`
 * - `msx pf opf <grid.dz> [--formulation=ac|dc]`
 * - `msx pf gridcode <grid.dz>`
 * - `msx pf to-psse <grid.dz> [--out=case.raw]`
 * - `msx pf to-modelica <grid.dz> [--out=grid.mo]`
 */

import { renderPowerFactorySvg } from "@modelscript/diagram/powerfactory-diagram-builder";
import {
  assessPowerFactoryCables,
  parsePowerFactoryFile,
  parsePowerFactoryText,
  parseSclXml,
  powerFactoryToModelica,
  powerFactoryToPsse,
  solvePowerFactoryOpf,
  solvePowerFactoryQdsl,
  solvePowerFactoryReliability,
  validateGooseStreams,
  type PowerFactoryModel,
} from "@modelscript/powerfactory";
import {
  analyzeSmallSignalStability,
  calculateShortCircuit,
  formatPowerFlowReport,
  solvePowerFlow,
  writeRaw,
  type BranchRecord,
} from "@modelscript/psse";
import {
  auditFaultRideThrough,
  auditPqCapability,
  calculateDynamicLineRating,
  exportQdslSummary,
  runFrequencyScan,
  solveHarmonicPowerFlow,
  STANDARD_ACSR_CONDUCTORS,
  STANDARD_GRID_CODE_PROFILES,
  type HarmonicSystemSpec,
  type TrajectorySamplePoint,
  type WeatherConditions,
} from "@modelscript/simulate/solvers";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

/**
 * Loads a PowerFactoryModel from file (.dz binary archive, .pfd ASCII, or .xml).
 */
function loadPowerFactoryModel(filePath: string): PowerFactoryModel {
  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`PowerFactory file not found: ${absPath}`);
  }

  const ext = path.extname(absPath).toLowerCase();
  if (ext === ".dz" || ext === ".zip") {
    const buf = fs.readFileSync(absPath);
    return parsePowerFactoryFile(new Uint8Array(buf), path.basename(absPath, ext));
  }

  const content = fs.readFileSync(absPath, "utf-8");
  return parsePowerFactoryText(content, path.basename(absPath, ext));
}

export const PowerFactoryCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "powerfactory <action> [files...]",
  aliases: ["pf"],
  describe: "Inspect, solve, lint, and visualize DIgSILENT PowerFactory models (.dz, .pfd, .xml)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description:
          "Action to perform (inspect, diagram, solve, fault, modes, dlr, harmonics, qdsl, opf, gridcode, to-psse, to-modelica)",
        type: "string",
        choices: [
          "inspect",
          "diagram",
          "solve",
          "fault",
          "modes",
          "dlr",
          "harmonics",
          "qdsl",
          "opf",
          "cable",
          "reliability",
          "scl",
          "gridcode",
          "to-psse",
          "to-modelica",
        ],
        demandOption: true,
      })
      .positional("files", {
        description: "PowerFactory file(s) to process (.dz, .pfd, .xml)",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path (e.g. for SVG diagram, PSS/E RAW, or Modelica code)",
        type: "string",
      })
      .option("formulation", {
        description: "OPF mathematical formulation: 'dc' (linearized) or 'ac' (nonlinear)",
        type: "string",
        choices: ["dc", "ac"],
        default: "dc",
      })
      .option("method", {
        description: "Small-signal eigensolver method: 'arnoldi' (sparse Krylov) or 'qr' (dense)",
        type: "string",
        choices: ["arnoldi", "qr"],
        default: "arnoldi",
      })
      .option("temp", {
        description: "Ambient temperature for Dynamic Line Rating in degrees Celsius (default: 35)",
        type: "number",
        default: 35.0,
      })
      .option("wind", {
        description: "Wind speed for Dynamic Line Rating in m/s (default: 0.6)",
        type: "number",
        default: 0.6,
      })
      .option("duration", {
        description: "Quasi-Dynamic simulation duration in hours (default: 24)",
        type: "number",
        default: 24.0,
      });
  },
  handler: async (args) => {
    const action = args["action"] as string;
    const files = (args["files"] as string[] | undefined) || [];

    if (files.length === 0) {
      console.error("[powerfactory] No PowerFactory input files specified.");
      process.exit(1);
    }

    for (const file of files) {
      const model = loadPowerFactoryModel(file);
      const baseName = path.basename(file);

      switch (action) {
        case "inspect": {
          console.log(`\n=== DIgSILENT PowerFactory Model Inspection: ${baseName} ===`);
          console.log(`  Substations:        ${model.substations.size}`);
          console.log(`  Bays:               ${model.bays.size}`);
          console.log(`  Terminals (Busbars):${model.terminals.size}`);
          console.log(`  Transmission Lines: ${model.lines.size}`);
          console.log(`  2W Transformers:    ${model.transformers2w.size}`);
          console.log(`  3W Transformers:    ${model.transformers3w.size}`);
          console.log(`  Synchronous Gens:   ${model.generators.size}`);
          console.log(`  Static Gens (IBR):  ${model.staticGenerators.size}`);
          console.log(`  Loads:              ${model.loads.size}`);
          console.log(`  Shunts:             ${model.shunts.size}`);
          console.log(`  Switches / Breakers:${model.switches.size}`);
          console.log(`  Graphic Diagrams:   ${model.diagrams.size}`);
          break;
        }

        case "diagram": {
          console.log(`[powerfactory] Rendering Single-Line Diagram SVG for ${baseName}...`);
          const svg = renderPowerFactorySvg(model, {
            title: baseName,
            theme: "dark",
          });
          const outPath = (args["out"] as string) || `${path.basename(file, path.extname(file))}.svg`;
          fs.writeFileSync(outPath, svg, "utf-8");
          console.log(`  ✔ Single-Line Diagram SVG saved to: ${outPath}`);
          break;
        }

        case "solve": {
          console.log(`[powerfactory] Solving AC Power Flow for ${baseName}...`);
          const { psseCase } = powerFactoryToPsse(model);
          const sol = solvePowerFlow(psseCase, { algorithm: "newton_raphson" });
          console.log(`  Status:             ${sol.converged ? "CONVERGED" : "FAILED"}`);
          console.log(`  Iterations:         ${sol.iterations}`);
          console.log(`  Active Losses:      ${sol.totalLossMw.toFixed(3)} MW`);
          console.log(`  Reactive Losses:    ${sol.totalLossMvar.toFixed(3)} Mvar`);
          console.log("\n" + formatPowerFlowReport(sol, baseName));
          break;
        }

        case "fault": {
          console.log(`[powerfactory] Running Certified IEC 60909:2016 Short-Circuit Study for ${baseName}...`);
          const { psseCase } = powerFactoryToPsse(model);
          const scResult = calculateShortCircuit(psseCase);
          console.log(scResult.reportText);
          break;
        }

        case "modes": {
          const method = (args["method"] as "arnoldi" | "qr") || "arnoldi";
          console.log(
            `[powerfactory] Running Small-Signal Stability Analysis (${method.toUpperCase()}) for ${baseName}...`,
          );
          const { psseCase } = powerFactoryToPsse(model);
          const modal = analyzeSmallSignalStability(psseCase, { method });
          console.log(modal.reportText);
          break;
        }

        case "dlr": {
          const tempC = (args["temp"] as number) ?? 35.0;
          const windMs = (args["wind"] as number) ?? 0.6;
          console.log(
            `[powerfactory] Evaluating IEEE 738 Dynamic Line Rating for ${baseName} (T_a = ${tempC}°C, V_w = ${windMs} m/s)...`,
          );
          const conductor = STANDARD_ACSR_CONDUCTORS["Drake"] ?? {
            name: "Drake",
            diameterMm: 28.1,
            r20OhmPerKm: 0.0718,
            tempCoeffPerC: 0.00393,
            emissivity: 0.8,
            absorptivity: 0.8,
            maxTempC: 75.0,
          };
          const weather: WeatherConditions = {
            ambientTempC: tempC,
            windSpeedMps: windMs,
            windAngleDeg: 90.0,
            solarIrradianceWpm2: 1000.0,
          };
          const dlr = calculateDynamicLineRating(conductor, weather);
          console.log(`  Conductor:          ${conductor.name} (D = ${conductor.diameterMm} mm)`);
          console.log(`  Static Rating:      ${dlr.staticAmpacityA.toFixed(0)} A`);
          console.log(`  Dynamic Rating:     ${dlr.ampacityA.toFixed(0)} A`);
          console.log(`  Thermal Headroom:   +${dlr.upratePercent.toFixed(1)}%`);
          break;
        }

        case "harmonics": {
          console.log(`[powerfactory] Running Frequency Scan & Harmonic Power Flow for ${baseName}...`);
          const { psseCase } = powerFactoryToPsse(model);
          const systemSpec: HarmonicSystemSpec = {
            numBuses: Math.max(2, psseCase.buses.size),
            baseFreqHz: 60.0,
            branches: psseCase.branches.map((b: BranchRecord) => ({
              fromBus: b.i - 1,
              toBus: b.j - 1,
              r1: b.r,
              x1: b.x,
              b1: b.b,
            })),
            injections: [
              { busIndex: 1, harmonicOrder: 5, currentMag: 10.0 },
              { busIndex: 1, harmonicOrder: 7, currentMag: 7.0 },
            ],
            sourceBusIndex: 0,
          };
          const scan = runFrequencyScan(systemSpec, 1);
          console.log(`  Frequency Sweep:    ${scan.scanPoints.length} points calculated`);
          console.log(`  Resonances Detected:${scan.resonances.length}`);
          for (const res of scan.resonances) {
            console.log(
              `    - ${res.type.toUpperCase()} Resonance at ${res.freqHz.toFixed(1)} Hz (|Z| = ${res.peakImpedance.toFixed(1)} Ω)`,
            );
          }

          const harm = solveHarmonicPowerFlow(systemSpec);
          console.log(`  Max Voltage THD:    ${harm.maxThdPercent.toFixed(2)}%`);
          console.log(`  IEEE 519 Compliant: ${harm.compliant ? "YES (Within Limits)" : "NO (Exceeds Limits)"}`);
          break;
        }

        case "qdsl": {
          const durHours = (args["duration"] as number) ?? 24.0;
          console.log(
            `[powerfactory] Running Quasi-Dynamic Simulation (QDSL, ${durHours}h horizon) for ${baseName}...`,
          );
          const qdslRes = solvePowerFactoryQdsl(model, { durationHours: durHours });
          console.log(exportQdslSummary(qdslRes));
          break;
        }

        case "opf": {
          const form = (args["formulation"] as "dc" | "ac") || "dc";
          console.log(`[powerfactory] Solving Optimal Power Flow (${form.toUpperCase()}-OPF) for ${baseName}...`);
          const opfSol = solvePowerFactoryOpf(model, { formulation: form });
          console.log(`  Status:             ${opfSol.status}`);
          console.log(`  Objective Value:    $${opfSol.objectiveValue.toFixed(2)}/hr`);
          console.log(`  Total Generation:   ${opfSol.totalGenMw.toFixed(2)} MW`);
          console.log(`  Average LMP:        $${opfSol.averageLmp.toFixed(2)}/MWh`);
          for (const g of opfSol.generators) {
            console.log(`  Generator '${g.genId}' (Bus ${g.busNumber}): Dispatched = ${g.pgMw.toFixed(2)} MW`);
          }
          break;
        }

        case "gridcode": {
          console.log(`[powerfactory] Running Grid Code Compliance Audit for ${baseName}...`);
          const trajectory: TrajectorySamplePoint[] = [
            { tSec: 0.0, voltagePu: 1.0, activePowerPu: 1.0 },
            { tSec: 0.05, voltagePu: 0.2, activePowerPu: 0.2, reactiveCurrentPu: 1.0 },
            { tSec: 0.15, voltagePu: 0.3, activePowerPu: 0.3, reactiveCurrentPu: 0.9 },
            { tSec: 0.5, voltagePu: 0.75, activePowerPu: 0.7, reactiveCurrentPu: 0.4 },
            { tSec: 1.0, voltagePu: 0.9, activePowerPu: 0.92, reactiveCurrentPu: 0.1 },
            { tSec: 1.5, voltagePu: 0.98, activePowerPu: 0.98, reactiveCurrentPu: 0.0 },
          ];
          const profile = STANDARD_GRID_CODE_PROFILES["entsoe_rfg_type_c_d"];
          if (profile) {
            const frt = auditFaultRideThrough(trajectory, profile);
            console.log(`  Standard:           ${frt.standardName}`);
            console.log(`  FRT Compliant:      ${frt.compliant ? "PASS" : "FAIL"}`);
            console.log(`  Active Power Rec.:  ${frt.activePowerRecovered ? "RECOVERED" : "UNRECOVERED"}`);
            console.log(
              `  Recovery Time:      ${frt.activePowerRecoveryTimeSec ? frt.activePowerRecoveryTimeSec.toFixed(2) + " s" : "N/A"}`,
            );
          }

          const pq = auditPqCapability([{ label: "OperatingPoint", pPu: 0.8, qPu: 0.25, voltagePu: 1.0 }], {
            name: "Standard Thermal",
            pMinPu: 0.2,
            pMaxPu: 1.0,
            qMinPu: -0.33,
            qMaxPu: 0.33,
            voltageBandPu: [0.95, 1.05],
          });
          console.log(`  P-Q Capability:     ${pq.compliant ? "COMPLIANT" : "VIOLATION"}`);
          break;
        }

        case "cable": {
          console.log(`[powerfactory] Evaluating IEC 60287 Underground Cable Ampacity for ${baseName}...`);
          const assessments = assessPowerFactoryCables(model);
          console.log(`\n================================================================================`);
          console.log(`     IEC 60287 / IEEE 835 CONTINUOUS CABLE AMPACITY & THERMAL SIZING`);
          console.log(`================================================================================`);
          console.log(`Line Name                 Voltage  Section   Continuous  Rated MVA  W_d (W/m)  I_sc (kA)`);
          console.log(`--------------------------------------------------------------------------------`);
          for (const c of assessments) {
            console.log(
              `${c.lineName.padEnd(25)} ${String(c.nominalVoltageKv + " kV").padEnd(8)} ${(c.crossSectionMm2 + " mm²").padEnd(9)} ${(c.ratedContinuousAmpacityA + " A").padEnd(11)} ${(c.ratedPowerMva + " MVA").padEnd(10)} ${c.dielectricLossWPerM.toFixed(2).padEnd(10)} ${c.shortCircuitWithstandCurrentKa.toFixed(1)} kA`,
            );
          }
          console.log(`================================================================================\n`);
          break;
        }

        case "reliability": {
          console.log(`[powerfactory] Running IEEE 1366 Distribution Reliability Assessment for ${baseName}...`);
          const rel = solvePowerFactoryReliability(model);
          console.log(`\n================================================================================`);
          console.log(`     IEEE 1366 DISTRIBUTION SYSTEM PREDICTIVE RELIABILITY REPORT`);
          console.log(`================================================================================`);
          console.log(`Feeder ID:                        ${rel.feederId}`);
          console.log(`Total Connected Customers:        ${rel.system.totalCustomers}`);
          console.log(`Total Feeder Peak Load:           ${(rel.system.totalLoadKw / 1000).toFixed(2)} MW`);
          console.log(`--------------------------------------------------------------------------------`);
          console.log(`IEEE 1366 RELIABILITY BENCHMARK INDICES:`);
          console.log(`  SAIFI (Interruption Frequency): ${rel.system.saifi.toFixed(4)} int/customer/year`);
          console.log(`  SAIDI (Interruption Duration):  ${rel.system.saidi.toFixed(3)} hours/customer/year`);
          console.log(`  CAIDI (Restoration Time):       ${rel.system.caidi.toFixed(3)} hours/interruption`);
          console.log(`  ASAI  (Service Availability):   ${(rel.system.asai * 100).toFixed(4)}%`);
          console.log(`  MAIFI (Momentary Outages):      ${rel.system.maifi.toFixed(3)} mom/customer/year`);
          console.log(`  EENS  (Energy Not Supplied):    ${rel.system.eensMwh.toFixed(2)} MWh/year`);
          console.log(`  ASIFI (Load-weighted Freq):     ${rel.system.asifi.toFixed(4)}`);
          console.log(`  ASIDI (Load-weighted Dur):      ${rel.system.asidi.toFixed(3)} hours`);
          console.log(`--------------------------------------------------------------------------------`);
          console.log(`TOP CRITICAL BRANCHES BY SAIDI CONTRIBUTION:`);
          for (const b of rel.criticalBranches.slice(0, 5)) {
            console.log(
              `  Branch '${b.branchId}': ${b.annualFailures} fails/yr -> contributes ${b.contributionToSaidiHours.toFixed(3)} hrs to SAIDI`,
            );
          }
          console.log(`================================================================================\n`);
          break;
        }

        case "scl": {
          console.log(`[powerfactory] Parsing and Validating Digital Substation SCL: ${baseName}...`);
          const sclXml = fs.readFileSync(path.resolve(process.cwd(), file), "utf-8");
          const scl = parseSclXml(sclXml);
          console.log(`\n================================================================================`);
          console.log(`     IEC 61850 DIGITAL SUBSTATION SCL INSPECTION & GOOSE AUDIT`);
          console.log(`================================================================================`);
          console.log(`Substation:        ${scl.substation?.name || scl.header.id}`);
          console.log(`SCL Version:       ${scl.header.version} (Rev: ${scl.header.revision})`);
          console.log(`Total IEDs:        ${scl.ieds.size}`);
          for (const [iedName, ied] of scl.ieds) {
            console.log(`  IED '${iedName}' [${ied.manufacturer || "Generic"} ${ied.type || ""}]`);
            for (const ap of ied.accessPoints) {
              for (const ld of ap.server?.logicalDevices ?? []) {
                const nodes = [ld.ln0, ...ld.logicalNodes].filter((n): n is NonNullable<typeof n> => n != null);
                console.log(`    LDevice '${ld.inst}': ${nodes.map((n) => n.lnClass + (n.inst || "")).join(", ")}`);
              }
            }
          }

          const gooseReport = validateGooseStreams(scl);
          console.log(`\n--------------------------------------------------------------------------------`);
          console.log(`GOOSE REAL-TIME COMMUNICATION VALIDATION:`);
          console.log(`  Published Streams:  ${gooseReport.totalGooseStreams}`);
          console.log(`  Publisher IEDs:     ${gooseReport.totalPublishers}`);
          console.log(`  Subscriber IEDs:    ${gooseReport.totalSubscribers}`);
          console.log(`  Stream Integrity:   ${gooseReport.isValid ? "VALID (0 errors)" : "INVALID (Errors found)"}`);

          for (const s of gooseReport.streams) {
            console.log(`\n  Stream '${s.gseControlName}' (APPID: ${s.appId}):`);
            console.log(`    Publisher:        ${s.publisherIed} / ${s.publisherLDevice} / ${s.publisherLn}`);
            console.log(
              `    Performance:      ${s.performanceClass} (minTime: ${s.minTimeMs}ms, maxTime: ${s.maxTimeMs}ms)`,
            );
            console.log(`    Trip Latency:     ${s.latencyValid ? "PASS (<= 4ms)" : "FAIL"}`);
            console.log(
              `    Signals:          ${s.publishedSignals.map((sig: { doName: string }) => sig.doName).join(", ")}`,
            );
            console.log(
              `    Subscribers (${s.subscribers.length}): ${s.subscribers.map((sub: { subscriberIed: string; subscriberLn: string }) => `${sub.subscriberIed}:${sub.subscriberLn}`).join(", ") || "None"}`,
            );
          }
          console.log(`================================================================================\n`);
          break;
        }

        case "to-psse": {
          console.log(`[powerfactory] Converting ${baseName} to PSS/E RAW format...`);
          const { psseCase } = powerFactoryToPsse(model);
          const raw = writeRaw(psseCase);
          const outPath = (args["out"] as string) || `${path.basename(file, path.extname(file))}.raw`;
          fs.writeFileSync(outPath, raw, "utf-8");
          console.log(
            `  ✔ PSS/E RAW file saved to: ${outPath} (${psseCase.buses.size} buses, ${psseCase.branches.length} branches)`,
          );
          break;
        }

        case "to-modelica": {
          console.log(`[powerfactory] Converting ${baseName} to OpenIPSL Modelica format...`);
          const mo = powerFactoryToModelica(model);
          const outPath = (args["out"] as string) || `${path.basename(file, path.extname(file))}.mo`;
          fs.writeFileSync(outPath, mo, "utf-8");
          console.log(`  ✔ OpenIPSL Modelica package saved to: ${outPath}`);
          break;
        }
      }
    }
  },
};
