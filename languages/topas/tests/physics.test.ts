// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseTopas } from "../src/parser/index.js";
import { computeBraggPeakDepthDose, lowerTopasToDae } from "../src/physics/index.js";

describe("Bortfeld Analytical Bragg Peak Depth-Dose & DAE Lowering", () => {
  it("computes accurate proton Bragg peak range R_0 = alpha * E_0^p in water", () => {
    // At 150 MeV, R_0 = 0.022 * 150^1.77 ~= 156.9 mm (15.69 cm)
    const bragg150 = computeBraggPeakDepthDose(150.0, 0.5, "proton");
    assert(bragg150.projectedRangeMm > 154.0 && bragg150.projectedRangeMm < 160.0);
    assert(bragg150.projectedRangeCm > 15.4 && bragg150.projectedRangeCm < 16.0);
    assert(bragg150.peakToEntranceRatio > 2.5);
    assert(bragg150.distal80DepthMm >= bragg150.braggPeakDepthMm);
    assert(bragg150.distal20DepthMm > bragg150.distal80DepthMm);
    assert(bragg150.fwhmMm > 0);
    assert(bragg150.depthProfile.length > 100);

    // Higher energy (200 MeV) penetrates deeper than 150 MeV
    const bragg200 = computeBraggPeakDepthDose({ energyMeV: 200.0, energySpreadPercent: 0.5, particle: "proton" });
    assert(bragg200.projectedRangeMm > bragg150.projectedRangeMm);
  });

  it("computes carbon-12 ion depth-dose with higher LET and lowers TOPAS model to DAEBuilder", () => {
    const topasDoc = parseTopas(`
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
`);

    const carbonBragg = computeBraggPeakDepthDose(topasDoc);
    assert.strictEqual(carbonBragg.particle, "carbon");
    assert(carbonBragg.projectedRangeMm > 0);

    const arena = lowerTopasToDae(topasDoc);
    assert(arena.getVarCount() >= 8);
    assert(arena.getEqCount() >= 8);
  });
});
