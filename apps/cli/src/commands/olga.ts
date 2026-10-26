// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: OLGA Flow Assurance Subcommand.
 *
 * Provides headless CLI operations for OLGA multiphase flow models (.opi, .key, .genkey):
 * - `msx olga simulate <file> [--duration=3600] [--out=traj.csv]`
 * - `msx olga lint <files...>`
 * - `msx olga verify <file> [--maop=250] [--capacity=150]`
 * - `msx olga diagram <file> [--view=profile|schematic|pvt|wellbore|slug] [--out=diagram.svg]`
 * - `msx olga convert <file> [--to=genkey|opi|sysml2] [--out=converted.ext]`
 */

import {
  renderOlgaBathymetry3dSvg,
  renderOlgaElevationProfileSvg,
  renderOlgaPvtEnvelopeSvg,
  renderOlgaSchematicSvg,
  renderOlgaSlugStatisticsSvg,
  renderOlgaWellboreIprSvg,
} from "@modelscript/diagram/olga-diagram-builder";
import { exportOlgaFmu, formatOlgaCoSimCsv, runOlgaCoSimulation } from "@modelscript/exchange";
import {
  calibrateOlgaModel,
  CubicEos,
  eosToPvtTable,
  evaluateFlowAssuranceGate,
  formatPvtTable,
  importBathymetrySurvey,
  lintOlgaModel,
  loadCheckpoint,
  lowerOlgaToDae,
  olgaToModelica,
  parseGateMetric,
  parseObservationCsv,
  parseOlga,
  parseOlgaPpl,
  parseOlgaTplDataset,
  profileDatasetToSnapshots,
  projectOlgaToSysml2,
  saveCheckpoint,
  serializeKeyDeck,
  serializeOpi,
  simulateDriftFlux,
  simulateNetworkTransient,
  verifyFlowAssuranceLimits,
  type AntiSlugControllerOptions,
  type FlowAssuranceLimits,
  type NetworkTransientDynamicEvent,
  type OlgaCheckpointState,
  type OlgaSimulationResult,
  type TunableParameter,
} from "@modelscript/olga";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

export const OlgaCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "olga <action> [files...]",
  describe: "Simulate, lint, verify, and visualize OLGA multiphase flowline models (.opi, .key, .genkey)",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description:
          "Action to perform (simulate, lint, verify, diagram, convert, survey, gate, fmu, trend, profile, cosim, tune, flash, network)",
        type: "string",
        choices: [
          "inspect",
          "to-dae",
          "to-modelica",
          "simulate",
          "lint",
          "verify",
          "diagram",
          "convert",
          "survey",
          "gate",
          "fmu",
          "trend",
          "profile",
          "cosim",
          "tune",
          "flash",
          "network",
        ],
        demandOption: true,
      })
      .positional("files", {
        description: "OLGA model file(s) to process (.opi, .key, .genkey, .fmu)",
        type: "string",
        array: true,
      })
      .option("out", {
        alias: "o",
        description: "Output file path (e.g. for trajectory CSV, SVG diagram, or .fmu archive)",
        type: "string",
      })
      .option("duration", {
        alias: "t",
        description: "Simulation duration in seconds [s]",
        type: "number",
      })
      .option("dt", {
        description: "Simulation time step in seconds [s]",
        type: "number",
      })
      .option("restart", {
        description: "Path to checkpoint (.rst or .json) file to warm restart simulation from",
        type: "string",
      })
      .option("checkpoint-out", {
        description: "Path to write simulation state checkpoint (.rst) at completion or periodically",
        type: "string",
      })
      .option("checkpoint-interval", {
        description: "Periodic checkpoint snapshot interval in seconds [s]",
        type: "number",
      })
      .option("tune", {
        description:
          "Comma-separated list of parameters to calibrate in 'tune' action (e.g. 'roughness,choke_cd,u_ambient')",
        type: "string",
      })
      .option("max-evals", {
        description: "Maximum number of objective evaluations during history matching optimization",
        type: "number",
        default: 150,
      })
      .option("report", {
        description: "Path to write tuning Markdown report",
        type: "string",
      })
      .option("view", {
        description: "Diagram view type: 'profile', 'schematic', 'pvt', 'wellbore', 'slug', 'bathy'",
        type: "string",
        default: "profile",
      })
      .option("to", {
        description: "Target format for conversion ('genkey', 'opi', 'sysml2')",
        type: "string",
        choices: ["genkey", "opi", "sysml2"],
        default: "genkey",
      })
      .option("maop", {
        description: "Maximum Allowable Operating Pressure limit in bar [bar]",
        type: "number",
        default: 250,
      })
      .option("margin", {
        description: "Required hydrate avoidance subcooling margin in Kelvin [K]",
        type: "number",
        default: 3.0,
      })
      .option("capacity", {
        description: "Topside slug catcher maximum liquid surge capacity in m³ [m³]",
        type: "number",
        default: 150.0,
      })
      .option("min-vel", {
        description: "Minimum gas turndown velocity in m/s [m/s]",
        type: "number",
        default: 0.5,
      })
      .option("max-surge", {
        description: "Maximum allowable topside slug catcher surge volume in m³ [m³]",
        type: "number",
        default: 85.0,
      })
      .option("min-hydrate-margin", {
        description: "Minimum required hydrate avoidance subcooling margin in Kelvin [K]",
        type: "number",
        default: 3.0,
      })
      .option("max-wax", {
        description: "Maximum allowable wax deposition layer thickness in mm [mm]",
        type: "string",
        default: "2mm",
      })
      .option("max-corrosion", {
        description: "Maximum allowable internal sweet CO2 corrosion rate in mm/year [mm/yr]",
        type: "string",
        default: "0.1mm/yr",
      })
      .option("out-report", {
        description: "Path to write Flow Assurance Gate Markdown summary report",
        type: "string",
      })
      .option("fmi-version", {
        description: "FMI specification version for FMU export: '2.0', '3.0', or 'both'",
        type: "string",
        choices: ["2.0", "3.0", "both"],
        default: "2.0",
      })
      .option("macro-step", {
        description: "Co-simulation communication step size in seconds [s] (default: 1.0)",
        type: "number",
        default: 1.0,
      })
      .option("algorithm", {
        description: "Co-simulation coupling algorithm ('gauss-seidel' | 'jacobi')",
        type: "string",
        choices: ["gauss-seidel", "jacobi"],
        default: "gauss-seidel",
      })
      .option("comp", {
        description: "Feed composition string for EOS flash (e.g. 'C1:0.75,C2:0.10,C3:0.08,nC4:0.04,C7:0.03')",
        type: "string",
      })
      .option("p", {
        description: "Operating pressure in bar [bar] for flash (default: 50.0)",
        type: "number",
        default: 50.0,
      })
      .option("t", {
        description: "Operating temperature in Kelvin or Celsius for flash (default: 300.15 K)",
        type: "number",
        default: 300.15,
      })
      .option("model", {
        description: "Cubic equation of state model ('pr' | 'srk')",
        type: "string",
        choices: ["pr", "srk"],
        default: "pr",
      })
      .option("envelope", {
        description: "Trace two-phase saturation envelope (cricondenbar & cricondentherm)",
        type: "boolean",
        default: false,
      })
      .option("anti-slug", {
        description: "Enable active subsea topside closed-loop anti-slug controller during simulation",
        type: "boolean",
        default: false,
      })
      .option("slug-setpoint", {
        description: "Anti-slug riser base pressure setpoint in bar [bar] (default: 50.0)",
        type: "number",
        default: 50.0,
      })
      .option("slug-kp", {
        description: "Anti-slug PI proportional gain [1/Pa] (default: 1.5e-6)",
        type: "number",
        default: 1.5e-6,
      })
      .option("slug-ti", {
        description: "Anti-slug PI integral time constant in seconds [s] (default: 30.0)",
        type: "number",
        default: 30.0,
      })
      .option("slug-washout", {
        description: "Anti-slug high-pass washout filter time constant in seconds [s] (default: 20.0)",
        type: "number",
        default: 20.0,
      })
      .option("slug-choke", {
        description: "Anti-slug baseline nominal choke opening [0..1] (default: 0.50)",
        type: "number",
        default: 0.5,
      })
      .option("trip", {
        description: "Dynamic well trip event specification (e.g. 'WELL_1:20' for shut-in at t=20s)",
        type: "string",
      })
      .option("junction-vol", {
        description: "Gathering manifold junction accumulator volume in m³ [m³] (default: 5.0)",
        type: "number",
        default: 5.0,
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];

    if (action === "flash") {
      const compStr =
        (argv["comp"] as string | undefined) ??
        (files[0] && !files[0].endsWith(".opi") && !files[0].endsWith(".key") && !files[0].endsWith(".genkey")
          ? files[0]
          : "C1:0.75,C2:0.10,C3:0.08,nC4:0.04,C7:0.03");
      const pBar = (argv["p"] as number | undefined) ?? 50.0;
      const tInput = (argv["t"] as number | undefined) ?? 300.15;
      const tKelvin = tInput < 200 ? tInput + 273.15 : tInput;
      const modelArg = ((argv["model"] as string | undefined) ?? "pr").toLowerCase();
      const modelType = modelArg === "srk" ? "SRK" : "PENG_ROBINSON";
      const traceEnvelope = Boolean(argv["envelope"]);

      // Parse composition string "C1:0.75,C2:0.10,..."
      const feedComp: Record<string, number> = {};
      const pairs = compStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const pair of pairs) {
        const [compName, fracStr] = pair.split(":").map((s) => s.trim());
        if (compName && fracStr) {
          const val = parseFloat(fracStr);
          if (!isNaN(val)) feedComp[compName] = val;
        }
      }

      console.log("\n=======================================================");
      console.log(`    OLGA IN-WASM CUBIC EOS (${modelArg.toUpperCase()}) FLASH ENGINE    `);
      console.log("=======================================================");
      console.log(
        ` Model Formulation   : ${modelType === "PENG_ROBINSON" ? "Peng-Robinson (1978)" : "Soave-Redlich-Kwong (SRK)"}`,
      );
      console.log(` Operating Pressure  : ${pBar.toFixed(2)} bar (${(pBar * 1e5).toLocaleString()} Pa)`);
      console.log(` Operating Temp      : ${tKelvin.toFixed(2)} K (${(tKelvin - 273.15).toFixed(2)} °C)`);
      console.log(
        ` Feed Components     : ${Object.entries(feedComp)
          .map(([k, v]) => `${k}=${(v * 100).toFixed(1)}%`)
          .join(", ")}`,
      );
      console.log("=======================================================\n");

      const compNames = Object.keys(feedComp);
      const eos = new CubicEos(compNames, modelType);
      const pPa = pBar * 1e5;
      const flash = eos.flashPT(pPa, tKelvin, feedComp);

      console.log(" Thermodynamic Flash State Summary:");
      console.log(
        `   Phase State        : ${flash.isTwoPhase ? "TWO-PHASE" : flash.vaporFraction > 0.5 ? "SINGLE-PHASE GAS" : "SINGLE-PHASE LIQUID"}`,
      );
      console.log(`   Vapor Fraction (β) : ${(flash.vaporFraction * 100).toFixed(2)} %`);
      console.log(`   Liquid Fraction    : ${((1 - flash.vaporFraction) * 100).toFixed(2)} %`);
      console.log(`   Gas Density        : ${flash.gas.densityKgM3.toFixed(2)} kg/m³`);
      console.log(`   Liquid Density     : ${flash.liquid.densityKgM3.toFixed(2)} kg/m³`);
      console.log(`   Gas Viscosity      : ${(flash.gas.viscosityPaS * 1e3).toFixed(4)} cP`);
      console.log(`   Liquid Viscosity   : ${(flash.liquid.viscosityPaS * 1e3).toFixed(4)} cP`);
      console.log(`   Surface Tension    : ${(flash.surfaceTensionNPerM * 1e3).toFixed(2)} mN/m`);
      console.log(`   Gas Sound Speed    : ${flash.gas.soundSpeedMS.toFixed(1)} m/s`);
      console.log(`   Liquid Sound Speed : ${flash.liquid.soundSpeedMS.toFixed(1)} m/s`);

      console.log("\n Equilibrium Component Distribution:");
      console.log("   Component   z_feed      x_liq       y_vap       K_value");
      console.log("   --------------------------------------------------------");
      for (let i = 0; i < eos.components.length; i++) {
        const k = eos.componentKeys[i]!;
        const z = feedComp[k] ?? 0;
        const x = flash.liquid.composition[i] ?? 0;
        const y = flash.gas.composition[i] ?? 0;
        const kval = flash.equilibriumKValues[i] ?? (x > 0 ? y / x : 0);
        console.log(
          `   ${k.padEnd(10)} ${z.toFixed(4).padStart(8)} ${x.toFixed(4).padStart(11)} ${y.toFixed(4).padStart(11)} ${kval.toFixed(4).padStart(11)}`,
        );
      }

      if (traceEnvelope) {
        console.log("\n Tracing Saturation Phase Envelope...");
        const envelope = eos.generatePhaseEnvelope(feedComp, 240.0, 380.0, 15);
        console.log(`   Bubble Points      : ${envelope.bubblePoints.length}`);
        console.log(`   Dew Points         : ${envelope.dewPoints.length}`);
        console.log(
          `   Cricondenbar       : ${(envelope.cricondenbar.pressurePa / 1e5).toFixed(2)} bar @ ${envelope.cricondenbar.temperatureK.toFixed(1)} K`,
        );
        console.log(
          `   Cricondentherm     : ${envelope.cricondentherm.temperatureK.toFixed(1)} K @ ${(envelope.cricondentherm.pressurePa / 1e5).toFixed(2)} bar`,
        );
      }

      if (argv["out"]) {
        const outPath = path.resolve(process.cwd(), argv["out"] as string);
        if (outPath.endsWith(".tab")) {
          const pressuresGrid = [10e5, 20e5, 40e5, 60e5, 80e5, 100e5];
          const tempsGrid = [275.15, 295.15, 315.15, 335.15, 355.15];
          const pvtData = eosToPvtTable(eos, feedComp, pressuresGrid, tempsGrid);
          const tabText = formatPvtTable(pvtData);
          fs.writeFileSync(outPath, tabText, "utf-8");
          console.log(
            `\n✔ 2D PVT Flash Table exported to ${outPath} (${pressuresGrid.length}x${tempsGrid.length} grid)`,
          );
        } else if (outPath.endsWith(".json")) {
          fs.writeFileSync(outPath, JSON.stringify(flash, null, 2), "utf-8");
          console.log(`\n✔ Flash results JSON exported to ${outPath}`);
        } else {
          // Default to CSV
          const csvLines = [
            "property,unit,value",
            `vapor_fraction,-,${flash.vaporFraction.toFixed(4)}`,
            `gas_density,kg/m3,${flash.gas.densityKgM3.toFixed(2)}`,
            `liquid_density,kg/m3,${flash.liquid.densityKgM3.toFixed(2)}`,
            `gas_viscosity,Pa.s,${flash.gas.viscosityPaS.toExponential(4)}`,
            `liquid_viscosity,Pa.s,${flash.liquid.viscosityPaS.toExponential(4)}`,
            `surface_tension,N/m,${flash.surfaceTensionNPerM.toExponential(4)}`,
            `gas_sound_speed,m/s,${flash.gas.soundSpeedMS.toFixed(2)}`,
            `liquid_sound_speed,m/s,${flash.liquid.soundSpeedMS.toFixed(2)}`,
          ];
          fs.writeFileSync(outPath, csvLines.join("\n"), "utf-8");
          console.log(`\n✔ Flash summary CSV exported to ${outPath}`);
        }
      }
      return;
    }

    if (files.length === 0) {
      console.error("Error: No OLGA input files specified.");
      process.exit(1);
    }

    const filePath = path.resolve(process.cwd(), files[0]!);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, "utf-8");

    if (action === "trend") {
      const dataset = parseOlgaTplDataset(content);
      console.log("\n=======================================================");
      console.log("            OLGA TREND (.TPL) CHANNEL SUMMARY          ");
      console.log("=======================================================");
      console.log(` Title           : ${dataset.title || path.basename(filePath)}`);
      console.log(` Timesteps       : ${dataset.times.length}`);
      console.log(
        ` Time Span       : [${dataset.times[0]?.toFixed(1) ?? 0}, ${dataset.times[dataset.times.length - 1]?.toFixed(1) ?? 0}] s`,
      );
      console.log(` Channels Count  : ${dataset.variables.length}`);
      console.log(" Channels List   :");
      dataset.variables.forEach((v, idx) => {
        const vals = dataset.data[idx] || [];
        let minVal = Infinity;
        let maxVal = -Infinity;
        for (const val of vals) {
          if (val < minVal) minVal = val;
          if (val > maxVal) maxVal = val;
        }
        console.log(
          `   [${idx + 1}] ${v.name} [${v.unit}] — min: ${isFinite(minVal) ? minVal.toFixed(2) : "-"}, max: ${isFinite(maxVal) ? maxVal.toFixed(2) : "-"}`,
        );
      });

      if (argv["out"]) {
        const outPath = path.resolve(process.cwd(), argv["out"] as string);
        const lines = [["TIME [S]", ...dataset.variables.map((v) => `${v.name} [${v.unit}]`)].join(",")];
        for (let i = 0; i < dataset.times.length; i++) {
          const row = [dataset.times[i]!.toFixed(3), ...dataset.variables.map((_, col) => dataset.data[col]?.[i] ?? 0)];
          lines.push(row.join(","));
        }
        fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
        console.log(`\n✔ Trajectory exported to CSV: ${outPath}`);
      }
      return;
    }

    if (action === "profile") {
      const dataset = parseOlgaPpl(content);
      console.log("\n=======================================================");
      console.log("          OLGA SPATIAL PROFILE (.PPL) SUMMARY          ");
      console.log("=======================================================");
      console.log(` Title       : ${dataset.title}`);
      console.log(` Branch      : ${dataset.branch}`);
      console.log(` Snapshots   : ${dataset.snapshots.length}`);
      console.log(` Variables   : ${dataset.variables.map((v) => `${v.name} [${v.unit}]`).join(", ")}`);
      if (dataset.snapshots.length > 0) {
        const s0 = dataset.snapshots[0]!;
        console.log(` Spatial X   : [${s0.x[0] ?? 0}, ${s0.x[s0.x.length - 1] ?? 0}] m (${s0.x.length} sections)`);
        const sLast = dataset.snapshots[dataset.snapshots.length - 1]!;
        console.log(` Time Span   : [${s0.time.toFixed(1)}, ${sLast.time.toFixed(1)}] s`);
      }

      if (argv["out"]) {
        const outPath = path.resolve(process.cwd(), argv["out"] as string);
        const snaps = profileDatasetToSnapshots(dataset);
        const simResult: OlgaSimulationResult = {
          times: snaps.map((s) => s.time),
          profiles: snaps,
          profileDataset: dataset,
          trends: {
            inletPressure: snaps.map((s) => s.pressure[0] ?? 0),
            arrivalPressure: snaps.map((s) => s.pressure[s.pressure.length - 1] ?? 0),
            arrivalTemperature: snaps.map((s) => s.temperature[s.temperature.length - 1] ?? 0),
            arrivalLiquidHoldup: snaps.map((s) => s.liquidHoldup[s.liquidHoldup.length - 1] ?? 0),
            arrivalLiquidMassRate: snaps.map(() => 0),
            accumulatedLiquidVolume: snaps.map(() => 0),
            peakLiquidSurgeVolume: 0,
          },
        };
        const dummyModel = {
          title: dataset.title ?? path.basename(filePath),
          startTime: snaps[0]?.time ?? 0,
          endTime: snaps[snaps.length - 1]?.time ?? 100,
          minDt: 0.1,
          maxDt: 1.0,
          flowpaths: [
            {
              name: dataset.branch,
              pipes: [
                {
                  label: "LINE",
                  length: snaps[0]?.x[snaps[0]?.x.length - 1] ?? 1000,
                  diameter: 0.254,
                  elevation: 0,
                  roughness: 1e-5,
                  discretization: 20,
                },
              ],
              valves: [],
              sources: [],
              controllers: [],
            },
          ],
          nodes: [],
        };
        const svg = renderOlgaElevationProfileSvg(dummyModel, simResult);
        fs.writeFileSync(outPath, svg, "utf-8");
        console.log(`\n✔ Elevation profile SVG diagram saved: ${outPath}`);
      }
      return;
    }

    if (action === "cosim") {
      const subseaFile = filePath;
      const topsideFile = files[1] ? path.resolve(process.cwd(), files[1]) : undefined;
      const durationSeconds = (argv["duration"] as number | undefined) ?? 100.0;
      const macroStep = (argv["macro-step"] as number | undefined) ?? 1.0;
      const algorithm = (argv["algorithm"] as "gauss-seidel" | "jacobi" | undefined) ?? "gauss-seidel";

      console.log("\n=======================================================");
      console.log("       OLGA SUBSEA-TO-TOPSIDE CO-SIMULATION MASTER     ");
      console.log("=======================================================");
      console.log(` Subsea Participant   : ${path.basename(subseaFile)}`);
      console.log(
        ` Topside Participant  : ${topsideFile ? path.basename(topsideFile) : "Offshore Process Facilities (Default)"}`,
      );
      console.log(` Coupling Algorithm   : ${algorithm.toUpperCase()} Multi-Rate Time Integration`);
      console.log(` Macro-Step Interval  : ${macroStep} s`);
      console.log(` Duration             : ${durationSeconds} s`);
      console.log("=======================================================\n");

      const result = await runOlgaCoSimulation(subseaFile, topsideFile, {
        durationSeconds,
        macroStepSize: macroStep,
        algorithm,
      });

      console.log(" Co-Simulation Run Summary:");
      console.log(`   Steps Evaluated    : ${result.summary.stepsCount}`);
      console.log(`   Convergence Rate   : ${(result.summary.convergedRate * 100).toFixed(1)}%`);
      console.log(`   Peak Surge Volume  : ${result.summary.peakSurgeM3.toFixed(2)} m³`);
      console.log(`   Min Hydrate Margin : ${result.summary.minHydrateSubcoolingK.toFixed(1)} K`);
      console.log(`   Min MAOP Headroom  : ${result.summary.minMaopMarginBar.toFixed(1)} bar`);
      console.log(`   Peak Comp. Power   : ${result.summary.peakCompressorPowerMW.toFixed(2)} MW`);

      if (argv["out"]) {
        const outPath = path.resolve(process.cwd(), argv["out"] as string);
        const csv = formatOlgaCoSimCsv(result);
        fs.writeFileSync(outPath, csv, "utf-8");
        console.log(`\n✔ Synchronized co-simulation trajectory written to ${outPath}`);
      }
      return;
    }

    const model = parseOlga(content);

    switch (action) {
      case "inspect": {
        console.log(`[OLGA Multiphase Model] File: ${path.basename(filePath)}`);
        console.log(`  Title: ${model.title}`);
        console.log(`  Flowpaths: ${model.flowpaths.length}`);
        for (const fp of model.flowpaths) {
          console.log(
            `    - Flowpath '${fp.name}': ${fp.pipes.length} pipes, ${fp.valves.length} valves, ${fp.sources.length} sources`,
          );
        }
        console.log(`  Boundary Nodes: ${model.nodes.length}`);
        for (const node of model.nodes) {
          console.log(
            `    - Node '${node.name}' [${node.type}]: P=${((node.pressure ?? 0) / 1e5).toFixed(1)} bar, T=${((node.temperature ?? 273.15) - 273.15).toFixed(1)} °C`,
          );
        }
        break;
      }

      case "to-dae": {
        console.log(`Lowering OLGA model '${model.title}' to ModelScript linear-memory DAE arena...`);
        const dae = lowerOlgaToDae(model);
        console.log(`✔ DAE arena lowered successfully:`);
        console.log(`  Variables : ${dae.varCount}`);
        console.log(`  Equations : ${dae.eqCount}`);
        const out = argv["out"] as string | undefined;
        if (out) {
          const outPath = path.resolve(process.cwd(), out);
          fs.writeFileSync(outPath, JSON.stringify({ varCount: dae.varCount, eqCount: dae.eqCount }, null, 2), "utf-8");
          console.log(`✔ DAE metadata written to ${out}`);
        }
        break;
      }

      case "to-modelica": {
        const mo = olgaToModelica(model);
        const out = argv["out"] as string | undefined;
        if (out) {
          const outPath = path.resolve(process.cwd(), out);
          fs.writeFileSync(outPath, mo, "utf-8");
          console.log(`✔ Modelica projection written to ${out}`);
        } else {
          console.log(mo);
        }
        break;
      }

      case "simulate": {
        const durationSeconds = (argv["duration"] as number | undefined) ?? model.endTime - model.startTime;
        const timeStepSeconds = (argv["dt"] as number | undefined) ?? model.maxDt;
        const restartFile = argv["restart"] as string | undefined;
        let initialCheckpoint: OlgaCheckpointState | undefined;
        if (restartFile) {
          const cpPath = path.resolve(process.cwd(), restartFile);
          if (!fs.existsSync(cpPath)) {
            console.error(`Error: Checkpoint file not found: ${cpPath}`);
            process.exit(1);
          }
          initialCheckpoint = loadCheckpoint(cpPath);
          console.log(
            `✔ Resuming from checkpoint snapshot '${path.basename(cpPath)}' (t=${initialCheckpoint.simulatedTime.toFixed(1)}s, ${initialCheckpoint.gridCells.length} cells)`,
          );
        }

        const checkpointOut = argv["checkpoint-out"] as string | undefined;
        const checkpointInterval = argv["checkpoint-interval"] as number | undefined;

        // Configure anti-slug options if requested
        const antiSlugEnabled = Boolean(argv["anti-slug"]);
        const antiSlugController: AntiSlugControllerOptions | undefined = antiSlugEnabled
          ? {
              setpointPa: ((argv["slug-setpoint"] as number | undefined) ?? 50.0) * 1e5,
              kp: (argv["slug-kp"] as number | undefined) ?? 1.5e-6,
              tiSeconds: (argv["slug-ti"] as number | undefined) ?? 30.0,
              washoutTimeSeconds: (argv["slug-washout"] as number | undefined) ?? 20.0,
              nominalChokeOpening: (argv["slug-choke"] as number | undefined) ?? 0.5,
            }
          : undefined;

        console.log(
          `Simulating OLGA model '${model.title}' (duration=${durationSeconds}s, dt=${timeStepSeconds}s${antiSlugEnabled ? ", anti-slug=ACTIVE" : ""})...`,
        );

        let lastCheckpoint: OlgaCheckpointState | undefined;
        const simResult = simulateDriftFlux(model, {
          durationSeconds,
          timeStepSeconds,
          initialCheckpoint,
          checkpointIntervalSeconds: checkpointInterval,
          antiSlugController,
          onCheckpoint: (cp) => {
            lastCheckpoint = cp;
            if (checkpointOut && checkpointInterval) {
              saveCheckpoint(cp, path.resolve(process.cwd(), checkpointOut));
            }
          },
        });

        if (checkpointOut && lastCheckpoint) {
          const resolvedCpOut = path.resolve(process.cwd(), checkpointOut);
          saveCheckpoint(lastCheckpoint, resolvedCpOut);
          console.log(`✔ Simulation state checkpoint saved: ${resolvedCpOut}`);
        }

        const lastProfile = simResult.profiles[simResult.profiles.length - 1];
        const peakSurge = simResult.trends.peakLiquidSurgeVolume;
        const meanSlugL = simResult.trends.meanSlugLength?.[simResult.trends.meanSlugLength.length - 1] ?? 0;
        const slugFreq = simResult.trends.slugFrequency?.[simResult.trends.slugFrequency.length - 1] ?? 0;

        console.log("\n=======================================================");
        console.log("            OLGA SIMULATION RESULTS SUMMARY            ");
        console.log("=======================================================");
        console.log(` Model Title               : ${model.title}`);
        console.log(` Simulated Steps           : ${simResult.times.length}`);
        console.log(` Peak Arrival Surge Volume : ${peakSurge.toFixed(2)} m³`);
        console.log(
          ` Topside Arrival Pressure  : ${((simResult.trends.arrivalPressure[simResult.trends.arrivalPressure.length - 1] ?? 0) / 1e5).toFixed(1)} bar`,
        );
        console.log(
          ` Topside Arrival Temp      : ${((simResult.trends.arrivalTemperature[simResult.trends.arrivalTemperature.length - 1] ?? 273.15) - 273.15).toFixed(1)} °C`,
        );
        console.log(` Mean Slug Body Length     : ${meanSlugL.toFixed(1)} m`);
        console.log(` Slug Arrival Frequency    : ${slugFreq.toFixed(3)} Hz`);
        if (antiSlugEnabled && simResult.trends.chokeOpening) {
          const lastZ = simResult.trends.chokeOpening[simResult.trends.chokeOpening.length - 1] ?? 0;
          console.log(` Anti-Slug Choke Opening   : ${(lastZ * 100).toFixed(1)} % (Active Control)`);
        }
        if (lastProfile?.pigs && lastProfile.pigs.length > 0) {
          const pig = lastProfile.pigs[0]!;
          console.log(
            ` Scraper Pig (${pig.name})   : ${(pig.position / 1000).toFixed(2)} km (v=${pig.velocity.toFixed(2)} m/s, swept=${pig.sweptLiquidVolume.toFixed(1)} m³)`,
          );
        }
        console.log("=======================================================\n");

        const outPath = argv["out"] as string | undefined;
        if (outPath) {
          const resolvedOut = path.resolve(process.cwd(), outPath);
          if (resolvedOut.endsWith(".json")) {
            fs.writeFileSync(resolvedOut, JSON.stringify(simResult, null, 2), "utf-8");
          } else {
            // CSV format
            const hasAntiSlug = antiSlugEnabled && simResult.trends.chokeOpening;
            const lines: string[] = [
              "time,inlet_pressure_bar,arrival_pressure_bar,arrival_temperature_c,arrival_holdup,peak_surge_m3,mean_slug_length_m" +
                (hasAntiSlug ? ",choke_opening,controller_error" : ""),
            ];
            for (let i = 0; i < simResult.times.length; i++) {
              let line = [
                simResult.times[i]!.toFixed(1),
                ((simResult.trends.inletPressure[i] ?? 0) / 1e5).toFixed(2),
                ((simResult.trends.arrivalPressure[i] ?? 0) / 1e5).toFixed(2),
                ((simResult.trends.arrivalTemperature[i] ?? 273.15) - 273.15).toFixed(2),
                (simResult.trends.arrivalLiquidHoldup[i] ?? 0).toFixed(4),
                peakSurge.toFixed(2),
                (simResult.trends.meanSlugLength?.[i] ?? 0).toFixed(2),
              ].join(",");
              if (hasAntiSlug) {
                const chokeZ = simResult.trends.chokeOpening![i] ?? antiSlugController!.nominalChokeOpening ?? 0.5;
                const err = simResult.trends.controllerError?.[i] ?? 0;
                line += `,${chokeZ.toFixed(4)},${err.toFixed(2)}`;
              }
              lines.push(line);
            }
            fs.writeFileSync(resolvedOut, lines.join("\n"), "utf-8");
          }
          console.log(`✔ Trajectory exported to ${resolvedOut}`);
        }
        break;
      }

      case "lint": {
        console.log(`Linting OLGA model '${model.title}'...`);
        const diagnostics = lintOlgaModel(model);
        if (diagnostics.length === 0) {
          console.log("✔ Pre-flight flow assurance checks passed with 0 diagnostics.");
        } else {
          console.log(`Found ${diagnostics.length} diagnostic(s):`);
          for (const d of diagnostics) {
            const tag = `[${d.code}] ${d.severity.toUpperCase()}`;
            console.log(`  ${tag}: ${d.message} (target: '${d.target}')`);
          }
          const hasErrors = diagnostics.some((d) => d.severity === "error");
          if (hasErrors) {
            process.exit(1);
          }
        }
        break;
      }

      case "verify": {
        const maopBar = (argv["maop"] as number) ?? 250;
        const marginK = (argv["margin"] as number) ?? 3.0;
        const capacityM3 = (argv["capacity"] as number) ?? 150.0;
        const minVel = (argv["min-vel"] as number) ?? 0.5;

        const limits: FlowAssuranceLimits = {
          maop: maopBar * 1e5,
          hydrateMarginKelvin: marginK,
          slugCatcherLiquidCapacity: capacityM3,
          minGasVelocity: minVel,
        };

        console.log(`Verifying flow assurance limits for '${model.title}'...`);
        const result = verifyFlowAssuranceLimits(model, limits);

        console.log("\n=======================================================");
        console.log("            FLOW ASSURANCE VERIFICATION REPORT         ");
        console.log("=======================================================");
        console.log(` Overall Compliance        : ${result.passed ? "PASSED" : "FAILED"}`);
        console.log(
          ` Hydrate Avoidance Check   : ${result.checks.hydrateAvoidance.passed ? "PASS" : "FAIL"} (Min Margin: ${result.checks.hydrateAvoidance.minMarginObserved.toFixed(1)} K vs ${marginK.toFixed(1)} K required)`,
        );
        console.log(
          ` Slug Catcher Capacity     : ${result.checks.slugCatcherSurge.passed ? "PASS" : "FAIL"} (Peak Surge: ${result.checks.slugCatcherSurge.peakArrivalLiquidVolume.toFixed(1)} m³ vs ${capacityM3.toFixed(1)} m³ limit)`,
        );
        console.log(
          ` MAOP Overpressure Check   : ${result.checks.maopOverpressure.passed ? "PASS" : "FAIL"} (Peak Observed: ${(result.checks.maopOverpressure.peakPressureObserved / 1e5).toFixed(1)} bar vs ${maopBar.toFixed(1)} bar limit)`,
        );
        console.log(
          ` Turndown Velocity Check   : ${result.checks.turndownVelocity.passed ? "PASS" : "FAIL"} (Min Gas Vel: ${result.checks.turndownVelocity.minVelocityObserved.toFixed(2)} m/s vs ${minVel.toFixed(2)} m/s required)`,
        );
        console.log("=======================================================\n");

        if (!result.passed) {
          process.exit(1);
        }
        break;
      }

      case "diagram": {
        const view = (argv["view"] as string) ?? "profile";
        let svg: string;
        if (view === "schematic") {
          svg = renderOlgaSchematicSvg(model);
        } else if (view === "pvt") {
          svg = renderOlgaPvtEnvelopeSvg(undefined, undefined, model.title);
        } else if (view === "wellbore") {
          const wellNode =
            model.nodes.find((n) => (n.type as string) === "WELL" || n.type === "TERMINAL") ?? model.nodes[0];
          svg = renderOlgaWellboreIprSvg(
            (wellNode as any)?.ipr as any,
            wellNode?.name || "SUBSEA WELL",
            wellNode?.massRate ?? 35.0,
            (wellNode?.pressure ?? 140e5) / 1e5,
          );
        } else if (view === "slug") {
          svg = renderOlgaSlugStatisticsSvg(undefined, 150.0);
        } else if (view === "bathy" || view === "3d") {
          svg = renderOlgaBathymetry3dSvg(model);
        } else {
          const simResult = simulateDriftFlux(model, {
            durationSeconds: Math.min(model.endTime - model.startTime, 60),
            timeStepSeconds: 1.0,
          });
          svg = renderOlgaElevationProfileSvg(model, simResult);
        }

        const outPath = argv["out"] as string | undefined;
        if (outPath) {
          const resolvedOut = path.resolve(process.cwd(), outPath);
          fs.writeFileSync(resolvedOut, svg, "utf-8");
          console.log(`✔ SVG diagram rendered to ${resolvedOut}`);
        } else {
          process.stdout.write(svg);
        }
        break;
      }

      case "survey": {
        const surveyPath = files[0];
        if (!surveyPath || !fs.existsSync(surveyPath)) {
          console.error(`Error: Survey file '${surveyPath || ""}' not found.`);
          process.exit(1);
        }
        const surveyText = fs.readFileSync(surveyPath, "utf-8");
        const surveyResult = importBathymetrySurvey(surveyText, {
          defaultDiameter: (argv["diameter"] as number) ?? 0.3048,
          targetCellLength: (argv["cell-length"] as number) ?? 50.0,
        });

        console.log(`\n=======================================================`);
        console.log(`      3D SEABED BATHYMETRY SURVEY INGESTION REPORT     `);
        console.log(`=======================================================`);
        console.log(` Total 3D Route Length : ${(surveyResult.totalLengthM / 1000).toFixed(2)} km`);
        console.log(
          ` Elevation Span        : [${surveyResult.minElevationM.toFixed(1)} m, ${surveyResult.maxElevationM.toFixed(1)} m]`,
        );
        console.log(` Max Dogleg Severity   : ${surveyResult.maxDoglegSeverity.toFixed(2)}° / 30m`);
        console.log(` Discretized Pipes     : ${surveyResult.pipes.length} segments`);
        console.log(`=======================================================\n`);

        const outPath = argv["out"] as string | undefined;
        if (outPath) {
          const resolvedOut = path.resolve(process.cwd(), outPath);
          fs.writeFileSync(resolvedOut, surveyResult.opiXmlSnippet, "utf-8");
          console.log(`✔ Discretized <Pipe> XML snippet written to ${resolvedOut}`);
        } else {
          console.log(surveyResult.opiXmlSnippet);
        }
        break;
      }

      case "convert": {
        const targetFormat = (argv["to"] as string) ?? "genkey";
        let converted: string;
        if (targetFormat === "sysml2") {
          converted = projectOlgaToSysml2(model);
        } else if (targetFormat === "opi") {
          converted = serializeOpi(model);
        } else {
          converted = serializeKeyDeck(model);
        }

        const outPath = argv["out"] as string | undefined;
        if (outPath) {
          const resolvedOut = path.resolve(process.cwd(), outPath);
          fs.writeFileSync(resolvedOut, converted, "utf-8");
          console.log(`✔ Converted model written to ${resolvedOut}`);
        } else {
          process.stdout.write(converted);
        }
        break;
      }

      case "gate": {
        const maxSurge = parseGateMetric(argv["max-surge"] as any, 85.0);
        const minHydrateMargin = parseGateMetric(argv["min-hydrate-margin"] as any, (argv["margin"] as number) ?? 3.0);
        const maxWax = parseGateMetric(argv["max-wax"] as any, 2.0);
        const maxCorrosion = parseGateMetric(argv["max-corrosion"] as any, 0.1);
        const maopBar = parseGateMetric(argv["maop"] as any, 250.0);
        const minVel = parseGateMetric(argv["min-vel"] as any, 0.5);
        const durationSeconds = argv["duration"] as number | undefined;

        console.log(`Evaluating Flow Assurance CI/CD Safety Gate for '${model.title}'...`);
        const result = evaluateFlowAssuranceGate(model, {
          maxSurgeM3: maxSurge,
          minHydrateMarginK: minHydrateMargin,
          maxWaxThicknessMm: maxWax,
          maxCorrosionRateMmPerYear: maxCorrosion,
          maxPressureBar: maopBar,
          minGasVelocity: minVel,
          durationSeconds,
        });

        console.log("\n=======================================================");
        console.log("             FLOW ASSURANCE SAFETY GATE                ");
        console.log("=======================================================");
        console.log(` Overall Compliance    : ${result.passed ? "APPROVED (PASSED)" : "BLOCKED (FAILED)"}`);
        console.log(
          ` Slug Catcher Surge    : ${result.checks.slugSurge.passed ? "PASS" : "FAIL"} (${result.checks.slugSurge.observed.toFixed(2)} m³ vs max ${maxSurge.toFixed(1)} m³)`,
        );
        console.log(
          ` Hydrate Avoidance     : ${result.checks.hydrateMargin.passed ? "PASS" : "FAIL"} (${result.checks.hydrateMargin.observed.toFixed(1)} K vs min ${minHydrateMargin.toFixed(1)} K)`,
        );
        console.log(
          ` Wax Layer Growth      : ${result.checks.waxThickness.passed ? "PASS" : "FAIL"} (${result.checks.waxThickness.observed.toFixed(2)} mm vs max ${maxWax.toFixed(2)} mm)`,
        );
        console.log(
          ` Sweet CO2 Corrosion   : ${result.checks.corrosionRate.passed ? "PASS" : "FAIL"} (${result.checks.corrosionRate.observed.toFixed(3)} mm/yr vs max ${maxCorrosion.toFixed(3)} mm/yr)`,
        );
        console.log(
          ` MAOP Overpressure     : ${result.checks.maop.passed ? "PASS" : "FAIL"} (${result.checks.maop.observed.toFixed(1)} bar vs max ${maopBar.toFixed(1)} bar)`,
        );
        console.log(
          ` Turndown Gas Velocity : ${result.checks.turndownVelocity.passed ? "PASS" : "FAIL"} (${result.checks.turndownVelocity.observed.toFixed(2)} m/s vs min ${minVel.toFixed(2)} m/s)`,
        );
        console.log("=======================================================\n");

        const reportPath = (argv["out-report"] || argv["out"]) as string | undefined;
        if (reportPath) {
          const resolvedReport = path.resolve(process.cwd(), reportPath);
          fs.writeFileSync(resolvedReport, result.markdownReport, "utf-8");
          console.log(`✔ Flow Assurance Gate Markdown summary report written to ${resolvedReport}`);
        }

        const ghStepSummary = process.env["GITHUB_STEP_SUMMARY"];
        if (ghStepSummary) {
          try {
            fs.appendFileSync(ghStepSummary, `\n\n${result.markdownReport}\n`, "utf-8");
            console.log(`✔ Appended Gate summary to GitHub Actions $GITHUB_STEP_SUMMARY`);
          } catch (e: any) {
            console.warn(`Warning: Could not write to $GITHUB_STEP_SUMMARY: ${e.message}`);
          }
        }

        if (!result.passed) {
          process.exit(1);
        }
        break;
      }

      case "fmu": {
        const fmiVersion = (argv["fmi-version"] as "2.0" | "3.0" | "both") ?? "2.0";
        console.log(`Exporting OLGA model '${model.title}' to FMI ${fmiVersion} Co-Simulation FMU...`);

        const fmuResult = exportOlgaFmu(model, {
          fmiVersion,
          description: `OLGA Flowline Co-Simulation FMU: ${model.title}`,
        });

        const defaultStem = model.title.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase() || "olga_model";
        const outPath = (argv["out"] as string | undefined) ?? `${defaultStem}.fmu`;
        const resolvedOut = path.resolve(process.cwd(), outPath);
        fs.writeFileSync(resolvedOut, fmuResult.archive);

        console.log("\n=======================================================");
        console.log("           OLGA FMI CO-SIMULATION FMU EXPORT           ");
        console.log("=======================================================");
        console.log(` FMU Package Name      : ${path.basename(resolvedOut)}`);
        console.log(` Model Identifier      : ${fmuResult.modelIdentifier}`);
        console.log(` FMI Standard Version  : ${fmiVersion}`);
        console.log(` Exposed Variables     : ${fmuResult.variableCount} (Inputs: 4, Outputs: 7, Parameters: 3)`);
        console.log(` Bundled Files         : ${fmuResult.files.join(", ")}`);
        console.log(` Package Archive Size  : ${(fmuResult.archive.length / 1024).toFixed(1)} KB`);
        console.log(`=======================================================\n`);
        console.log(`✔ Standalone Co-Simulation FMU written to ${resolvedOut}`);
        break;
      }

      case "tune": {
        const obsFile = files[1] ? path.resolve(process.cwd(), files[1]) : undefined;
        if (!obsFile || !fs.existsSync(obsFile)) {
          console.error(
            "Error: Telemetry observation CSV file required as second argument: msx olga tune <model> <telemetry.csv>",
          );
          process.exit(1);
        }
        const obsCsv = fs.readFileSync(obsFile, "utf-8");
        const observations = parseObservationCsv(obsCsv);
        const paramArg = argv["tune"] as string | undefined;
        const validParams: TunableParameter[] = ["roughness", "heat-transfer", "choke-cd", "well-rate"];
        const tunableParams: TunableParameter[] = paramArg
          ? paramArg
              .split(",")
              .map((s) => s.trim().toLowerCase().replace(/_/g, "-"))
              .filter((s): s is TunableParameter => validParams.includes(s as TunableParameter))
          : ["roughness", "choke-cd", "heat-transfer"];
        const maxEvals = (argv["max-evals"] as number | undefined) ?? 150;

        console.log("\n=======================================================");
        console.log("       OLGA AUTONOMOUS FIELD HISTORY MATCHING          ");
        console.log("=======================================================");
        console.log(` Model File            : ${path.basename(filePath)}`);
        console.log(` Observations File     : ${path.basename(obsFile)} (${observations.times.length} data points)`);
        console.log(` Calibration Targets   : ${tunableParams.join(", ")}`);
        console.log(` Max Evaluations       : ${maxEvals}`);
        console.log("=======================================================\n");

        const tuneResult = calibrateOlgaModel(model, observations, {
          parameters: tunableParams,
          maxEvaluations: maxEvals,
        });

        console.log(" Calibration Run Summary:");
        console.log(`   Initial Objective   : ${tuneResult.initialObjective.toExponential(3)}`);
        console.log(`   Optimized Objective : ${tuneResult.finalObjective.toExponential(3)}`);
        console.log(`   Error Reduction     : ${tuneResult.improvementPercent.toFixed(1)}%`);
        console.log(`   Evaluations Run     : ${tuneResult.evaluations}`);
        console.log(`   Converged           : ${tuneResult.success ? "YES" : "MAX EVALUATIONS REACHED"}`);
        console.log(`   Pressure R²         : ${(tuneResult.metrics.pressureR2 * 100).toFixed(1)}%`);
        console.log(`   Pressure RMSE       : ${tuneResult.metrics.pressureRmseBar.toFixed(2)} bar`);
        console.log(`   Temperature R²      : ${(tuneResult.metrics.temperatureR2 * 100).toFixed(1)}%`);
        console.log(`   Temperature RMSE    : ${tuneResult.metrics.temperatureRmseK.toFixed(2)} K`);
        console.log("\n Parameter Estimates:");
        for (const p of tuneResult.calibratedParameters) {
          console.log(
            `   * ${p.name.padEnd(16)} : ${p.initialValue.toFixed(4)} → ${p.calibratedValue.toFixed(4)} ${p.unit} (${p.shiftPercent >= 0 ? "+" : ""}${p.shiftPercent.toFixed(1)}%)`,
          );
        }
        console.log("=======================================================\n");

        const outPath = argv["out"] as string | undefined;
        if (outPath) {
          const resolvedOut = path.resolve(process.cwd(), outPath);
          let serialized: string;
          if (resolvedOut.endsWith(".opi")) {
            serialized = serializeOpi(tuneResult.calibratedModel);
          } else {
            serialized = serializeKeyDeck(tuneResult.calibratedModel);
          }
          fs.writeFileSync(resolvedOut, serialized, "utf-8");
          console.log(`✔ Calibrated OLGA model saved: ${resolvedOut}`);
        }

        const reportPath = (argv["out-report"] || argv["report"]) as string | undefined;
        if (reportPath) {
          const resolvedReport = path.resolve(process.cwd(), reportPath);
          fs.writeFileSync(resolvedReport, tuneResult.markdownReport, "utf-8");
          console.log(`✔ History matching calibration report written to ${resolvedReport}`);
        }
        break;
      }

      case "network": {
        const duration = (argv["duration"] as number | undefined) ?? 60.0;
        const dt = (argv["dt"] as number | undefined) ?? 1.0;
        const junctionVol = (argv["junction-vol"] as number | undefined) ?? 5.0;
        const tripSpec = argv["trip"] as string | undefined;

        const events: NetworkTransientDynamicEvent[] = [];
        if (tripSpec) {
          // e.g. "WELL_1:20" or "FLOWLINE_1:20"
          const [target, timeStr] = tripSpec.split(":").map((s) => s.trim());
          const tripTime = timeStr ? parseFloat(timeStr) : 20.0;
          if (target) {
            events.push({
              timeSeconds: tripTime,
              action: "TRIP_WELL",
              flowpath: target,
              sourceName: target,
            });
          }
        }

        console.log("\n=======================================================");
        console.log("       OLGA COUPLED GATHERING NETWORK TRANSIENT        ");
        console.log("=======================================================");
        console.log(` Model Network       : ${model.title}`);
        console.log(` Flowpaths Count     : ${model.flowpaths.length}`);
        console.log(` Manifold Volume     : ${junctionVol.toFixed(1)} m³`);
        console.log(` Duration            : ${duration} s (dt=${dt} s)`);
        if (events.length > 0) {
          console.log(
            ` Dynamic Events      : ${events.map((e) => `${e.action} on ${e.flowpath} at t=${e.timeSeconds}s`).join(", ")}`,
          );
        }
        console.log("=======================================================\n");

        const netResult = simulateNetworkTransient(model, {
          durationSeconds: duration,
          timeStepSeconds: dt,
          junctionVolumeM3: junctionVol,
          events,
        });

        console.log(" Gathering Network Simulation Summary:");
        console.log(`   Simulated Steps    : ${netResult.times.length}`);
        console.log(`   Junction Manifolds : ${Object.keys(netResult.junctionPressures).join(", ") || "None"}`);
        for (const [junc, pTrend] of Object.entries(netResult.junctionPressures)) {
          const pInit = (pTrend[0] ?? 0) / 1e5;
          const pFinal = (pTrend[pTrend.length - 1] ?? 0) / 1e5;
          console.log(`   Manifold '${junc}' : P_init=${pInit.toFixed(1)} bar -> P_final=${pFinal.toFixed(1)} bar`);
        }
        for (const [fpName, flowResult] of Object.entries(netResult.flowpathResults)) {
          const qFinal =
            flowResult.trends.arrivalLiquidMassRate[flowResult.trends.arrivalLiquidMassRate.length - 1] ?? 0;
          console.log(`   Branch '${fpName}' : Final Liquid Rate = ${qFinal.toFixed(2)} kg/s`);
        }

        if (argv["out"]) {
          const outPath = path.resolve(process.cwd(), argv["out"] as string);
          if (outPath.endsWith(".json")) {
            fs.writeFileSync(outPath, JSON.stringify(netResult, null, 2), "utf-8");
          } else {
            // Composite CSV
            const juncNames = Object.keys(netResult.junctionPressures);
            const fpNames = Object.keys(netResult.flowpathResults);
            const header = [
              "time",
              ...juncNames.map((j) => `manifold_${j}_bar`),
              ...fpNames.map((f) => `branch_${f}_rate_kgs`),
            ];
            const lines = [header.join(",")];
            for (let i = 0; i < netResult.times.length; i++) {
              const row = [netResult.times[i]!.toFixed(1)];
              for (const j of juncNames) {
                row.push(((netResult.junctionPressures[j]?.[i] ?? 0) / 1e5).toFixed(2));
              }
              for (const f of fpNames) {
                row.push((netResult.flowpathResults[f]?.trends.arrivalLiquidMassRate[i] ?? 0).toFixed(2));
              }
              lines.push(row.join(","));
            }
            fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
          }
          console.log(`\n✔ Network gathering trajectory written to ${outPath}`);
        }
        break;
      }
    }
  },
};
