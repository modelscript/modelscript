// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate/twin/frac — Completions Stream Adapter & Stage Engine.
 *
 * Implements:
 * 1. Multi-format telemetry parser (CSV lines, JSON packets, Field/SI units).
 * 2. High-performance circular buffer synchronization via CircularTelemetryBuffer.
 * 3. Integrated FracStageEngine combining:
 *    - Wellbore slurry hydraulics (BHTP)
 *    - Perforation orifice friction & abrasive erosion
 *    - Dynamic fracture compliance
 *    - Nolte-Smith screen-out diagnostic early warning
 */

import { CircularTelemetryBuffer } from "../telemetry-buffer.js";
import {
  initializeFractureCompliance,
  stepFractureCompliance,
  type FractureComplianceOptions,
} from "./fracture-compliance.js";
import { initializeStageErosion, stepStageErosion } from "./perforation-erosion.js";
import { ScreenoutDetector, type ScreenoutDetectorOptions } from "./screenout-detector.js";
import {
  bpmToM3PerSec,
  pascalsToPsi,
  ppaToKgPerM3,
  psiToPascals,
  solveWellboreHydraulics,
} from "./slurry-hydraulics.js";
import type {
  FracTelemetrySample,
  FractureComplianceState,
  ScreenoutDiagnostic,
  SlurryRheologyConfig,
  StageCompletionConfig,
  StageErosionSummary,
  WellboreGeometry,
  WellboreHydraulicsState,
} from "./types.js";

export interface StageSimulationSnapshot {
  timeSeconds: number;
  telemetry: FracTelemetrySample;
  hydraulics: WellboreHydraulicsState;
  erosion: StageErosionSummary;
  compliance: FractureComplianceState;
  screenout: ScreenoutDiagnostic;
}

export interface FracStageEngineOptions {
  survey: WellboreGeometry;
  stage: StageCompletionConfig;
  rheology?: SlurryRheologyConfig | undefined;
  complianceOptions?: FractureComplianceOptions | undefined;
  screenoutOptions?: ScreenoutDetectorOptions | undefined;
  bufferCapacity?: number | undefined;
}

/**
 * Standard Telemetry Channels for CircularTelemetryBuffer:
 * ch_0: surfacePressurePascals
 * ch_1: slurryRateM3PerSec
 * ch_2: proppantConcentrationKgPerM3
 * ch_3: bottomHoleTreatingPressurePascals
 * ch_4: averagePerfFrictionPascals
 * ch_5: complianceM3PerPascal
 * ch_6: clusterEfficiencyPercent
 * ch_7: nolteSmithSlope
 */
const FRAC_CHANNEL_NAMES = [
  "surface_pressure_pa",
  "slurry_rate_m3_s",
  "proppant_conc_kg_m3",
  "bhtp_pa",
  "perf_friction_pa",
  "compliance_m3_pa",
  "cluster_efficiency_pct",
  "nolte_smith_slope",
];

export class FracStageEngine {
  readonly survey: WellboreGeometry;
  readonly stage: StageCompletionConfig;
  readonly rheology?: SlurryRheologyConfig | undefined;
  readonly complianceOptions?: FractureComplianceOptions | undefined;

  readonly buffer: CircularTelemetryBuffer;
  readonly screenoutDetector: ScreenoutDetector;

  private erosionState: StageErosionSummary;
  private complianceState: FractureComplianceState;
  private lastSample: FracTelemetrySample | null = null;

  constructor(options: FracStageEngineOptions) {
    this.survey = options.survey;
    this.stage = options.stage;
    this.rheology = options.rheology;
    this.complianceOptions = options.complianceOptions;

    this.buffer = new CircularTelemetryBuffer({
      numChannels: FRAC_CHANNEL_NAMES.length,
      capacity: options.bufferCapacity ?? 20_000,
      channelNames: FRAC_CHANNEL_NAMES,
    });

    this.screenoutDetector = new ScreenoutDetector({
      maopPascals: options.survey.maopPascals,
      ...options.screenoutOptions,
    });

    // Initialize states
    this.erosionState = initializeStageErosion(this.stage);
    const initialBhtp = options.stage.closurePressurePascals + 5.0e6; // ~5 MPa net seed
    this.complianceState = initializeFractureCompliance(this.stage, initialBhtp, 0.0, options.complianceOptions);
  }

  /**
   * Processes a single streaming telemetry sample and returns the complete real-time evaluation snapshot.
   */
  processSample(sample: FracTelemetrySample): StageSimulationSnapshot {
    const dt = this.lastSample ? Math.max(1e-3, sample.timeSeconds - this.lastSample.timeSeconds) : 1.0;

    // 1. Solve Wellbore Slurry Hydraulics
    const targetMd = this.stage.clusters[0]?.measuredDepth ?? this.survey.totalMeasuredDepth;
    const hydraulics = solveWellboreHydraulics(sample, this.survey, this.rheology, targetMd);

    // 2. Step Multi-Cluster Perforation Erosion
    this.erosionState = stepStageErosion(
      this.stage,
      this.erosionState,
      sample.slurryRateM3PerSec,
      sample.proppantConcentrationKgPerM3,
      hydraulics.slurryDensityKgPerM3,
      hydraulics.bottomHoleTreatingPressurePascals,
      dt,
    );

    // 3. Step Dynamic Fracture Compliance
    this.complianceState = stepFractureCompliance(
      this.complianceState,
      this.stage,
      hydraulics.bottomHoleTreatingPressurePascals,
      sample.slurryRateM3PerSec,
      this.erosionState.averagePerfFrictionPascals,
      dt,
      this.complianceOptions,
    );

    // 4. Evaluate Nolte-Smith Screen-out Diagnostic
    const screenout = this.screenoutDetector.evaluate(
      sample.timeSeconds,
      this.complianceState.netPressurePascals,
      sample.surfacePressurePascals,
    );

    // 5. Push multi-channel metrics into ring buffer
    const channelValues = [
      sample.surfacePressurePascals,
      sample.slurryRateM3PerSec,
      sample.proppantConcentrationKgPerM3,
      hydraulics.bottomHoleTreatingPressurePascals,
      this.erosionState.averagePerfFrictionPascals,
      this.complianceState.complianceM3PerPascal,
      this.erosionState.clusterEfficiencyPercent,
      screenout.nolteSmithSlope,
    ];
    this.buffer.push(sample.timeSeconds, channelValues);

    this.lastSample = sample;

    return {
      timeSeconds: sample.timeSeconds,
      telemetry: sample,
      hydraulics,
      erosion: this.erosionState,
      compliance: this.complianceState,
      screenout,
    };
  }

  /**
   * Resets engine state for another stage.
   */
  reset(): void {
    this.erosionState = initializeStageErosion(this.stage);
    const initialBhtp = this.stage.closurePressurePascals + 5.0e6;
    this.complianceState = initializeFractureCompliance(this.stage, initialBhtp, 0.0, this.complianceOptions);
    this.screenoutDetector.reset();
    this.lastSample = null;
  }
}

/**
 * Parses raw CSV telemetry string or rows into typed FracTelemetrySample array.
 * Supports auto-detection of Field Units (psi, bpm, ppa) or SI units (Pa, m³/s, kg/m³).
 */
export function parseFracTelemetryCsv(csvContent: string, units: "FIELD" | "SI" = "FIELD"): FracTelemetrySample[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length === 0) return [];

  // Inspect header row if present
  let startIdx = 0;
  const header = lines[0]!.toLowerCase();
  if (header.includes("time") || header.includes("press") || header.includes("rate")) {
    startIdx = 1;
  }

  const samples: FracTelemetrySample[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i]!.split(/[,;\t ]+/).map((v) => Number(v.trim()));
    if (parts.length < 3 || isNaN(parts[0]!) || isNaN(parts[1]!) || isNaN(parts[2]!)) {
      continue;
    }

    const t = parts[0]!;
    const rawP = parts[1]!;
    const rawQ = parts[2]!;
    const rawProp = parts[3] !== undefined && !isNaN(parts[3]) ? parts[3] : 0.0;
    const rawDownhole = parts[4] !== undefined && !isNaN(parts[4]) ? parts[4] : undefined;

    if (units === "FIELD") {
      // Field: psi, bpm, ppa
      samples.push({
        timeSeconds: t,
        surfacePressurePascals: psiToPascals(rawP),
        slurryRateM3PerSec: bpmToM3PerSec(rawQ),
        proppantConcentrationKgPerM3: ppaToKgPerM3(rawProp),
        downholePressurePascals: rawDownhole !== undefined ? psiToPascals(rawDownhole) : undefined,
      });
    } else {
      // SI: s, Pa, m³/s, kg/m³
      samples.push({
        timeSeconds: t,
        surfacePressurePascals: rawP,
        slurryRateM3PerSec: rawQ,
        proppantConcentrationKgPerM3: rawProp,
        downholePressurePascals: rawDownhole,
      });
    }
  }

  return samples;
}

export { bpmToM3PerSec, pascalsToPsi, ppaToKgPerM3, psiToPascals };
