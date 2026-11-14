// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { parseTopas } from "../src/parser/index.js";
import { computeBraggPeakDepthDose, lowerTopasToDae } from "../src/physics/index.js";

const CARBON_TOPAS = `
s:Ge/WaterPhantom/Type = "TsBox"
s:Ge/WaterPhantom/Parent = "World"
s:Ge/WaterPhantom/Material = "G4_WATER"
d:Ge/WaterPhantom/HLX = 100.0 mm
d:Ge/WaterPhantom/HLY = 100.0 mm
d:Ge/WaterPhantom/HLZ = 150.0 mm
s:So/CarbonIonBeam/Type = "Beam"
s:So/CarbonIonBeam/BeamParticle = "carbon"
d:So/CarbonIonBeam/BeamEnergy = 280.0 MeV
u:So/CarbonIonBeam/BeamEnergySpread = 0.3
`;

export const topasBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "topas",
  referenceTool: "TOPAS/Geant4 / Bortfeld Analytical Bragg Peak",
  defaultTolerance: 0.02,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const bragg150 = computeBraggPeakDepthDose(150.0, 0.5, "proton");
    const doc = parseTopas(CARBON_TOPAS);
    const dae = lowerTopasToDae(doc);
    const d1 = performance.now() - t0;

    // Bortfeld 150 MeV proton range in water: R0 = 0.022 * 150^1.77 ~= 156.9 mm
    const expectedR0 = 0.022 * Math.pow(150.0, 1.77);
    const relErr = Math.abs(bragg150.projectedRangeMm - expectedR0) / expectedR0;

    return [
      {
        id: "topas-bortfeld-bragg-peak",
        name: "150 MeV Proton Bragg Peak Range & TOPAS DAE Lowering",
        scale: "micro",
        referenceTool: "TOPAS/Geant4 / Bortfeld Analytical Bragg Peak",
        metricKind: "max-relative-error",
        threshold: 0.02,
        measuredError: relErr,
        passed: relErr < 0.02 && bragg150.peakToEntranceRatio > 2.5 && dae.getVarCount() >= 8,
        durationMs: d1,
        details: `R0=${bragg150.projectedRangeMm.toFixed(1)}mm, peak/ent=${bragg150.peakToEntranceRatio.toFixed(2)}`,
      },
    ];
  },
};
