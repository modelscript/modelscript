// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { computeFluxLimiter, parseOlga, simulateDriftFlux } from "../src/index.js";

test("Total Variation Diminishing (TVD) Flux Limiters (Van Leer, Minmod, Superbee)", () => {
  // 1. Negative or zero successive gradient ratio r <= 0: Drop to 1st-order (psi = 0)
  assert.strictEqual(computeFluxLimiter(-1.0, "VAN_LEER"), 0.0);
  assert.strictEqual(computeFluxLimiter(0.0, "VAN_LEER"), 0.0);
  assert.strictEqual(computeFluxLimiter(-0.5, "MINMOD"), 0.0);
  assert.strictEqual(computeFluxLimiter(0.0, "SUPERBEE"), 0.0);

  // 2. Van Leer limiter: psi(r) = 2r / (1 + r) for r > 0
  // At r = 1 (smooth uniform gradient): psi(1) = 1.0 (2nd-order Lax-Wendroff)
  assert.strictEqual(computeFluxLimiter(1.0, "VAN_LEER"), 1.0);
  assert.strictEqual(computeFluxLimiter(0.5, "VAN_LEER"), (2 * 0.5) / 1.5); // 2/3
  assert.strictEqual(computeFluxLimiter(2.0, "VAN_LEER"), (2 * 2.0) / 3.0); // 4/3
  assert.ok(Math.abs(computeFluxLimiter(100.0, "VAN_LEER") - 2.0) < 0.05); // asymptote -> 2

  // 3. Minmod limiter: psi(r) = max(0, min(1, r))
  assert.strictEqual(computeFluxLimiter(0.5, "MINMOD"), 0.5);
  assert.strictEqual(computeFluxLimiter(1.0, "MINMOD"), 1.0);
  assert.strictEqual(computeFluxLimiter(2.5, "MINMOD"), 1.0);

  // 4. Superbee limiter: psi(r) = max(0, min(2r, 1), min(r, 2))
  assert.strictEqual(computeFluxLimiter(0.25, "SUPERBEE"), 0.5);
  assert.strictEqual(computeFluxLimiter(0.75, "SUPERBEE"), 1.0);
  assert.strictEqual(computeFluxLimiter(1.5, "SUPERBEE"), 1.5);
  assert.strictEqual(computeFluxLimiter(3.0, "SUPERBEE"), 2.0);
});

test("2nd-Order TVD Drift-Flux vs 1st-Order Upwind Slugging Comparison", () => {
  const sampleOpi = `<?xml version="1.0" encoding="utf-8"?>
<Model Title="Wellman_Riser_Severe_Slugging">
  <Integration StartTime="0" EndTime="120" MinDt="0.001" MaxDt="1.0" />
  <Flowpath Name="RISER_SYSTEM">
    <Pipe Label="SEALINE" Length="1000.0" Diameter="0.2032" Elevation="-50.0" Roughness="0.000045" Discretization="10" />
    <Pipe Label="RISER" Length="300.0" Diameter="0.2032" Elevation="300.0" Roughness="0.000045" Discretization="6" />
    <Valve Name="TOPSIDE_CHOKE" AbsolutePosition="1280.0" Diameter="0.10" Opening="0.5" Cd="0.8" />
    <Source Name="INLET_WELL" Position="0.0" TotalMassRate="30.0" GasMassFraction="0.15" WaterCut="0.0" Temperature="55C" Pressure="60bar" />
  </Flowpath>
</Model>`;

  const model = parseOlga(sampleOpi);
  assert.strictEqual(model.flowpaths.length, 1);

  // 1. Simulate using 1st-order Upwind scheme
  const resUpwind = simulateDriftFlux(model, {
    durationSeconds: 120.0,
    timeStepSeconds: 1.0,
    spatialScheme: "UPWIND",
  });

  // 2. Simulate using 2nd-order TVD Van Leer limiter
  const resTvd = simulateDriftFlux(model, {
    durationSeconds: 120.0,
    timeStepSeconds: 1.0,
    spatialScheme: "TVD_VAN_LEER",
  });

  // 3. Simulate using 2nd-order TVD Minmod limiter
  const resMinmod = simulateDriftFlux(model, {
    durationSeconds: 120.0,
    timeStepSeconds: 1.0,
    spatialScheme: "TVD_MINMOD",
  });

  assert.ok(resUpwind.times.length > 50, "Upwind simulation must produce time steps");
  assert.ok(resTvd.times.length > 50, "TVD simulation must produce time steps");
  assert.ok(resMinmod.times.length > 50, "Minmod simulation must produce time steps");

  // TVD scheme sharpens phase transitions, capturing higher peak surge volume than diffuse 1st-order upwind
  assert.ok(
    resTvd.trends.peakLiquidSurgeVolume >= resUpwind.trends.peakLiquidSurgeVolume * 0.95,
    `TVD peak surge (${resTvd.trends.peakLiquidSurgeVolume.toFixed(3)} m^3) should be comparable or sharper than upwind (${resUpwind.trends.peakLiquidSurgeVolume.toFixed(3)} m^3)`,
  );

  // Verify numerical boundedness of void fraction in TVD
  for (const prof of resTvd.profiles) {
    for (const holdup of prof.liquidHoldup) {
      assert.ok(holdup >= 0.0 && holdup <= 1.0, `Liquid holdup ${holdup} must stay physically bounded in [0, 1]`);
    }
  }
});
