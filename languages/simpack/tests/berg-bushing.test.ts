// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeBergCyclicDissipation,
  evaluateBergBushing,
  lowerBergBushingToDae,
  type BergBushingParameters,
  type BergBushingState,
} from "../src/bushing/berg-bushing.js";

describe("Berg Elastomeric Bushing Dynamics (Workstream 3.3)", () => {
  const params: BergBushingParameters = {
    ke: 1.0e5, // 100 kN/m elastic stiffness
    cv: 500.0, // 500 N*s/m viscous damping
    kf: 4.0e5, // 400 kN/m friction initial stiffness (k_total,micro = 500 kN/m)
    fmax: 2000.0, // 2 kN friction saturation
    beta: 1.0,
  };

  it("exhibits high micro-amplitude dynamic stiffness (ke + kf)", () => {
    let state: BergBushingState = { fFriction: 0.0 };
    const dt = 1e-4;
    const microAmpl = 1e-4; // 0.1 mm micro-displacement (< fmax / kf = 5 mm)
    const omega = 2 * Math.PI * 5.0; // 5 Hz

    let fPeak = 0;
    // Simulate 1/4 cycle
    for (let t = 0; t <= 0.05; t += dt) {
      const x = microAmpl * Math.sin(omega * t);
      const v = microAmpl * omega * Math.cos(omega * t);
      const res = evaluateBergBushing(state, x, v, dt, params);
      state = res.nextState;
      if (res.fTotal > fPeak) fPeak = res.fTotal;
    }

    // Dynamic stiffness k_dyn = F_peak / X_peak
    const kDyn = fPeak / microAmpl;
    const expectedMicroK = params.ke + params.kf; // 500 kN/m

    // In micro regime, k_dyn should approach 500 kN/m (within 10%)
    assert.ok(
      kDyn > 0.85 * expectedMicroK,
      `Micro dynamic stiffness (${kDyn.toFixed(0)} N/m) must approach ${expectedMicroK} N/m`,
    );
  });

  it("saturates friction force at +/- F_max under large displacements", () => {
    let state: BergBushingState = { fFriction: 0.0 };
    const dt = 1e-3;
    const largeAmpl = 0.02; // 20 mm (> 5 mm yield)

    // Pull forward to 50 mm (10x yield displacement)
    for (let t = 0; t <= 0.25; t += dt) {
      const res = evaluateBergBushing(state, largeAmpl, 0.2, dt, params);
      state = res.nextState;
    }

    assert.ok(
      Math.abs(state.fFriction - params.fmax) < 1.0,
      `Friction force (${state.fFriction.toFixed(2)} N) must saturate at F_max (${params.fmax} N)`,
    );
  });

  it("computes theoretical cyclic energy dissipation", () => {
    const diss = computeBergCyclicDissipation(0.015, params); // 15 mm amplitude
    // 4 * F_max * (X - X_yield) = 4 * 2000 * (0.015 - 0.005) = 80 J
    assert.ok(Math.abs(diss - 80.0) < 1.0, `Dissipation (${diss.toFixed(2)} J) should be ~ 80 J`);
  });

  it("lowers Berg bushing into DAEBuilder with internal state der(f_fr)", () => {
    const dae = new DAEBuilder(undefined, "BushingTest");
    dae.addVariable("marker1.x", 0, 0, 0, 0.0);
    dae.addVariable("marker1.vx", 0, 0, 0, 0.0);

    const { fTotalVar, fFrictionVar } = lowerBergBushingToDae(dae, "bush_primary", params, "marker1.x", "marker1.vx");

    assert.equal(fTotalVar, "bush_primary.f_total");
    assert.equal(fFrictionVar, "bush_primary.f_fr");

    assert.ok(dae.varCount >= 4);
    assert.ok(dae.eqCount >= 2);

    const totalVarIdx = dae.lookupVariable("bush_primary.f_total");
    const frVarIdx = dae.lookupVariable("bush_primary.f_fr");
    assert.ok(totalVarIdx >= 0);
    assert.ok(frVarIdx >= 0);
  });
});
