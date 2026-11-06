// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI: Hydraulic Completions & Real-Time Frac Analytics Subcommand.
 *
 * Provides headless CLI operations for fracturing stages:
 * - `msx frac simulate <stage.csv> [--well=well.json] [--stage-cfg=stage.json] [--out=report.json]`
 * - `msx frac monitor <stage.csv> [--units=FIELD|SI]`
 * - `msx frac inspect <stage.json|well.json>`
 */

import {
  bpmToM3PerSec,
  FracStageEngine,
  parseFracTelemetryCsv,
  pascalsToPsi,
  ppaToKgPerM3,
  psiToPascals,
  type StageCompletionConfig,
  type WellboreGeometry,
} from "@modelscript/simulate/twin";
import fs from "node:fs";
import path from "node:path";
import type { CommandModule } from "yargs";

// Default standard horizontal shale wellbore for quick CLI simulation
const DEFAULT_CLI_WELLBORE: WellboreGeometry = {
  wellName: "Standard-Horizontal-Well",
  totalMeasuredDepth: 4500.0,
  trueVerticalDepth: 3000.0,
  maopPascals: psiToPascals(10500.0), // ~72.4 MPa
  surveyStations: [
    { measuredDepth: 0.0, trueVerticalDepth: 0.0, inclinationDeg: 0.0, innerDiameter: 0.1214 },
    { measuredDepth: 2500.0, trueVerticalDepth: 2500.0, inclinationDeg: 0.0, innerDiameter: 0.1214 },
    { measuredDepth: 3200.0, trueVerticalDepth: 3000.0, inclinationDeg: 90.0, innerDiameter: 0.1214 },
    { measuredDepth: 4500.0, trueVerticalDepth: 3000.0, inclinationDeg: 90.0, innerDiameter: 0.1214 },
  ],
};

// Default standard 5-cluster stage
const DEFAULT_CLI_STAGE: StageCompletionConfig = {
  stageNumber: 1,
  casingDiameterMeters: 0.1214,
  closurePressurePascals: psiToPascals(6800.0), // ~46.9 MPa
  clusters: [
    { clusterIndex: 0, measuredDepth: 4420.0, shotCount: 6, initialDiameterMeters: 0.010668, initialCd: 0.62 },
    { clusterIndex: 1, measuredDepth: 4440.0, shotCount: 6, initialDiameterMeters: 0.010668, initialCd: 0.62 },
    { clusterIndex: 2, measuredDepth: 4460.0, shotCount: 6, initialDiameterMeters: 0.010668, initialCd: 0.62 },
    { clusterIndex: 3, measuredDepth: 4480.0, shotCount: 6, initialDiameterMeters: 0.010668, initialCd: 0.62 },
    { clusterIndex: 4, measuredDepth: 4500.0, shotCount: 6, initialDiameterMeters: 0.010668, initialCd: 0.62 },
  ],
};

export const FracCommand: CommandModule<Record<string, unknown>, Record<string, unknown>> = {
  command: "frac <action> [files...]",
  describe:
    "Real-time hydraulic completions, slurry hydraulics, perforation erosion, fracture compliance, and screen-out analytics",
  builder: (yargs) => {
    return yargs
      .positional("action", {
        description: "Action to perform (simulate, monitor, inspect)",
        type: "string",
        choices: ["simulate", "monitor", "inspect"],
        demandOption: true,
      })
      .positional("files", {
        description: "Telemetry CSV file(s) or well/stage JSON configurations",
        type: "string",
        array: true,
      })
      .option("well", {
        description: "Path to wellbore geometry JSON file",
        type: "string",
      })
      .option("stage-cfg", {
        description: "Path to stage completion JSON file",
        type: "string",
      })
      .option("units", {
        description: "Telemetry unit convention: FIELD (psi, bpm, ppa) or SI (Pa, m³/s, kg/m³)",
        type: "string",
        choices: ["FIELD", "SI"],
        default: "FIELD",
      })
      .option("out", {
        alias: ["o", "output"],
        description: "Output file path for analysis JSON summary",
        type: "string",
      });
  },
  handler: async (argv) => {
    const action = argv["action"] as string;
    const files = (argv["files"] as string[]) ?? [];
    const wellPath = argv["well"] as string | undefined;
    const stagePath = argv["stage-cfg"] as string | undefined;
    const units = (argv["units"] as "FIELD" | "SI") ?? "FIELD";
    const outPath = argv["out"] as string | undefined;

    if (files.length === 0) {
      console.error("[frac] No input file(s) specified.");
      process.exit(1);
    }

    const filePath = path.resolve(process.cwd(), files[0]!);
    if (!fs.existsSync(filePath)) {
      console.error(`[frac] File not found: ${filePath}`);
      process.exit(1);
    }

    // 1. Inspect JSON file
    if (action === "inspect") {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content);
      console.log(`[frac inspect] File: ${path.basename(filePath)}`);
      console.log(JSON.stringify(parsed, null, 2));
      return;
    }

    // Load custom wellbore and stage configs if provided
    let well = DEFAULT_CLI_WELLBORE;
    if (wellPath) {
      const wellContent = fs.readFileSync(path.resolve(process.cwd(), wellPath), "utf-8");
      well = JSON.parse(wellContent) as WellboreGeometry;
    }

    let stage = DEFAULT_CLI_STAGE;
    if (stagePath) {
      const stageContent = fs.readFileSync(path.resolve(process.cwd(), stagePath), "utf-8");
      stage = JSON.parse(stageContent) as StageCompletionConfig;
    }

    // Load CSV telemetry
    const csvContent = fs.readFileSync(filePath, "utf-8");
    const samples = parseFracTelemetryCsv(csvContent, units);
    if (samples.length === 0) {
      console.error(`[frac] No valid telemetry samples parsed from: ${filePath}`);
      process.exit(1);
    }

    const engine = new FracStageEngine({ survey: well, stage });

    if (action === "monitor") {
      console.log(`\n========================================================================================`);
      console.log(` MODELSCRIPT REAL-TIME COMPLETIONS ENGINE — FRAC MONITOR`);
      console.log(` Well: ${well.wellName} | Stage: #${stage.stageNumber} | Clusters: ${stage.clusters.length}`);
      console.log(`========================================================================================\n`);

      for (const sample of samples) {
        const snap = engine.processSample(sample);
        const pSurfPsi = Math.round(pascalsToPsi(snap.telemetry.surfacePressurePascals));
        const bhtpPsi = Math.round(pascalsToPsi(snap.hydraulics.bottomHoleTreatingPressurePascals));
        const pNetPsi = Math.round(pascalsToPsi(snap.compliance.netPressurePascals));
        const qBpm = (snap.telemetry.slurryRateM3PerSec / bpmToM3PerSec(1.0)).toFixed(1);
        const propPpa = (snap.telemetry.proppantConcentrationKgPerM3 / ppaToKgPerM3(1.0)).toFixed(2);
        const effPct = Math.round(snap.erosion.clusterEfficiencyPercent);
        const slope = snap.screenout.nolteSmithSlope.toFixed(2);
        const alarm = snap.screenout.alarmLevel;

        const alarmColor =
          alarm === "EMERGENCY_SHUTDOWN" ? "🚨 " : alarm === "WARNING" ? "⚠️ " : alarm === "WATCH" ? "👀 " : "✅ ";

        console.log(
          `[T+${snap.timeSeconds.toFixed(0).padStart(4)}s] P_surf: ${String(pSurfPsi).padStart(5)} psi | BHTP: ${String(bhtpPsi).padStart(5)} psi | P_net: ${String(pNetPsi).padStart(4)} psi | Q: ${String(qBpm).padStart(4)} bpm | Sand: ${propPpa} ppa | CE: ${effPct}% | b: ${slope} | ${alarmColor}${alarm}`,
        );

        if (alarm === "EMERGENCY_SHUTDOWN" || alarm === "WARNING") {
          console.log(`  └─> ${snap.screenout.message}`);
        }
      }
      return;
    }

    // Default action: simulate
    console.log(`[frac simulate] Processing ${samples.length} samples from ${path.basename(filePath)}...`);
    const snapshots = [];
    for (const sample of samples) {
      snapshots.push(engine.processSample(sample));
    }

    const lastSnap = snapshots[snapshots.length - 1]!;
    console.log(`\n--- Stage Simulation Complete ---`);
    console.log(`Duration:                  ${lastSnap.timeSeconds.toFixed(1)} seconds`);
    console.log(
      `Final Surface Pressure:    ${Math.round(pascalsToPsi(lastSnap.telemetry.surfacePressurePascals))} psi`,
    );
    console.log(
      `Final BHTP:                ${Math.round(pascalsToPsi(lastSnap.hydraulics.bottomHoleTreatingPressurePascals))} psi`,
    );
    console.log(`Final Net Pressure:        ${Math.round(pascalsToPsi(lastSnap.compliance.netPressurePascals))} psi`);
    console.log(`Final Fracture Compliance: ${lastSnap.compliance.complianceM3PerPascal.toExponential(3)} m³/Pa`);
    console.log(`Cluster Efficiency:        ${lastSnap.erosion.clusterEfficiencyPercent.toFixed(1)}%`);
    console.log(
      `Total Proppant Pumped:     ${Math.round(lastSnap.erosion.totalProppantPumpedKg * 2.20462)} lbs (${Math.round(lastSnap.erosion.totalProppantPumpedKg)} kg)`,
    );
    console.log(
      `Nolte-Smith Slope (b):     ${lastSnap.screenout.nolteSmithSlope.toFixed(3)} (${lastSnap.screenout.regime})`,
    );
    console.log(`Final Alarm State:         ${lastSnap.screenout.alarmLevel}`);

    console.log(`\n--- Cluster Breakdown ---`);
    for (const c of lastSnap.erosion.clusters) {
      const initDiamIn = (stage.clusters[c.clusterIndex]!.initialDiameterMeters / 0.0254).toFixed(3);
      const curDiamIn = (c.currentDiameterMeters / 0.0254).toFixed(3);
      console.log(
        `Cluster ${c.clusterIndex} (MD ${stage.clusters[c.clusterIndex]!.measuredDepth}m): Diam: ${initDiamIn}" -> ${curDiamIn}" (+${(((c.currentDiameterMeters - stage.clusters[c.clusterIndex]!.initialDiameterMeters) / stage.clusters[c.clusterIndex]!.initialDiameterMeters) * 100).toFixed(1)}%) | Cd: ${c.currentCd.toFixed(2)} | Share: ${c.rateSharePercent.toFixed(1)}% | Active: ${c.isActive ? "YES" : "NO"}`,
      );
    }

    if (outPath) {
      const resolvedOut = path.resolve(process.cwd(), outPath);
      fs.writeFileSync(resolvedOut, JSON.stringify({ summary: lastSnap, snapshots }, null, 2), "utf-8");
      console.log(`[frac] Simulation report saved to: ${resolvedOut}`);
    }
  },
};
