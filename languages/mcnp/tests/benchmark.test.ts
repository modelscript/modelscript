// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeExactCellVolume, estimateCellVolumeMonteCarlo, intersectRaySurface } from "../src/cad/index.js";
import { parseMcnpDeck } from "../src/parser/index.js";
import { computeMaterialCrossSections, solveMcnpCriticality, solveMcnpFixedSource } from "../src/solver/index.js";

describe("MCNP Physics Benchmarks (Criticality, Shielding Attenuation & CSG Parity)", () => {
  it("Godiva bare U-235 sphere criticality benchmark yields k_eff ~= 1.00", () => {
    const godivaDeck = parseMcnpDeck(`Godiva Bare HEU Criticality Benchmark (LANL HEU-MET-FAST-001)
1 1 -18.74 -1 IMP:N=1
2 0         1 IMP:N=0

1 SO 8.741

MODE N
M1 92235.80c -0.9371 92238.80c -0.0629
KCODE 2000 1.0 15 65
KSRC 0.0 0.0 0.0
F4:N 1
`);

    const res = solveMcnpCriticality(godivaDeck, { seed: 42, groups: 1 });
    const kRef = 1.0;
    const relErr = Math.abs(res.kEff - kRef) / kRef;
    const tolerance = 0.03;

    assert.ok(
      relErr <= tolerance,
      `Godiva k_eff=${res.kEff.toFixed(4)} +/- ${res.kEffStdErr.toFixed(4)} deviated from 1.00 (relErr=${relErr.toFixed(4)} > tolerance=${tolerance})`,
    );
    assert.ok(res.kEffStdErr < 0.02, `Expected small k_eff stdErr, got ${res.kEffStdErr}`);
    assert.ok(res.leakageFraction > 0.3 && res.leakageFraction < 0.8);
    assert.ok((res.tallies.get(4)?.mean ?? 0) > 0, "Expected positive F4 cell flux tally");
  });

  it("Beer-Lambert exponential shielding attenuation I(x) = I0 * exp(-Sigma_t * x) matches analytical parity", () => {
    const slabThickness = 2.0; // cm
    const slabDensity = -0.0025; // g/cm^3 B-10 (~1.15 mean free paths thermal)
    const slabDeck = parseMcnpDeck(`Beer-Lambert Thermal B-10 Absorber Slab
1 1 -0.0025 -1 IMP:N=1
2 0          1 IMP:N=0

1 RPP 0.0 2.0 -50.0 50.0 -50.0 50.0

MODE N
M1 5010.80c 1.0
SDEF POS=0.001 0.0 0.0 VEC=1.0 0.0 0.0 DIR=1 ERG=2.53e-8 PAR=N
F1:N 1
NPS 50000
`);

    const mat1 = slabDeck.materials.get(1)!;
    const xs = computeMaterialCrossSections(mat1, slabDensity, "thermal");
    const expectedTransmission = Math.exp(-xs.sigmaT * (slabThickness - 0.001));

    const res = solveMcnpFixedSource(slabDeck, { seed: 2025, spectrum: "thermal", nps: 50000 });
    const simulated = res.tallies.get(1)?.uncollidedMean ?? res.transmittedFraction;
    const relErr = Math.abs(simulated - expectedTransmission) / expectedTransmission;
    const tolerance = 0.03;

    assert.ok(
      relErr <= tolerance,
      `Beer-Lambert transmission=${simulated.toFixed(5)} vs analytical=${expectedTransmission.toFixed(5)} (relErr=${relErr.toFixed(4)} > tolerance=${tolerance})`,
    );
  });

  it("CSG cell volume and ray-casting parity (spherical shell and RPP box)", () => {
    const geomDeck = parseMcnpDeck(`CSG Volume & Ray-Casting Parity Deck
1 1 -1.0  1 -2 IMP:N=1
2 1 -1.0 -3    IMP:N=1
3 0       2  3 IMP:N=0

1 SO 3.0
2 SO 5.0
3 RPP 10.0 14.0 -2.0 2.0 -3.0 3.0

M1 1001.80c 1.0
SDEF POS=0 0 0
`);

    // 1. Spherical shell exact vs Monte Carlo volume
    const exactShellVol = computeExactCellVolume(geomDeck, 1)!;
    const expectedShellVol = (4 / 3) * Math.PI * (5 ** 3 - 3 ** 3);
    assert.ok(Math.abs(exactShellVol - expectedShellVol) < 1e-9);

    const mcShell = estimateCellVolumeMonteCarlo(
      geomDeck,
      1,
      { xmin: -5, xmax: 5, ymin: -5, ymax: 5, zmin: -5, zmax: 5 },
      60000,
      777,
    );
    const shellRelErr = Math.abs(mcShell.volume - exactShellVol) / exactShellVol;
    const tolerance = 0.025;
    assert.ok(
      shellRelErr <= tolerance,
      `Shell MC vol=${mcShell.volume.toFixed(2)} vs exact=${exactShellVol.toFixed(2)} (relErr=${shellRelErr.toFixed(4)} > tolerance=${tolerance})`,
    );

    // 2. RPP box exact volume & ray-casting intersection distances
    const exactBoxVol = computeExactCellVolume(geomDeck, 2)!;
    assert.strictEqual(exactBoxVol, 4 * 4 * 6);

    const rppHits = intersectRaySurface(geomDeck.surfaces.get(3)!, [0, 0, 0], [1, 0, 0]);
    assert.strictEqual(rppHits.length, 2);
    assert.ok(Math.abs(rppHits[0]! - 10.0) < 1e-9);
    assert.ok(Math.abs(rppHits[1]! - 14.0) < 1e-9);
  });

  it("2-group moderated U-235 + H2O sphere increases k_eff relative to unmoderated fast spectrum", () => {
    const moderatedDeck = parseMcnpDeck(`2-Group Moderated U-235 + H2O Sphere
1 1 -1.5 -1 IMP:N=1
2 0       1 IMP:N=0

1 SO 18.0

MODE N
M1 92235.80c 0.02 1001.80c 2.0 8016.80c 1.0
KCODE 800 1.0 5 25
KSRC 0.0 0.0 0.0
`);

    const res1g = solveMcnpCriticality(moderatedDeck, { seed: 99, groups: 1 });
    const res2g = solveMcnpCriticality(moderatedDeck, { seed: 99, groups: 2 });
    assert.ok(
      res2g.kEff > res1g.kEff,
      `Expected 2-group moderated k_eff (${res2g.kEff.toFixed(4)}) > 1-group fast k_eff (${res1g.kEff.toFixed(4)})`,
    );
  });
});
