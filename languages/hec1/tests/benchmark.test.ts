// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeMuskingumCoefficients,
  computePotentialRetention,
  computeScsExcessRunoff,
  generateClarkUnitHydrograph,
  generateScsUnitHydrograph,
  generateSnyderUnitHydrograph,
  integrateHydrographVolume,
  parseHec1Deck,
  routeMuskingum,
  simulateHec1Deck,
  unitRunoffVolumeFactor,
  type Hec1HydrographPoint,
} from "../src/index.js";

function relErr(actual: number, expected: number): number {
  const denom = Math.max(1e-12, Math.abs(expected));
  return Math.abs(actual - expected) / denom;
}

function rmse(actual: readonly number[], expected: readonly number[]): number {
  assert.equal(actual.length, expected.length);
  let sumSq = 0;
  for (let i = 0; i < actual.length; i++) {
    const diff = actual[i]! - expected[i]!;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / Math.max(1, actual.length));
}

describe("@modelscript/hec1 — Hydrologic Verification Benchmarks (SCS-CN, Muskingum, Clark UH)", () => {
  it("matches exact analytical SCS Curve Number rainfall-excess formula Q = (P - Ia)^2 / (P - Ia + S)", () => {
    const testCases: Array<{ cn: number; p: number; unit: "English" | "Metric" }> = [
      { cn: 55, p: 4.0, unit: "English" },
      { cn: 70, p: 3.5, unit: "English" },
      { cn: 75, p: 5.0, unit: "English" },
      { cn: 85, p: 2.5, unit: "English" },
      { cn: 92, p: 1.8, unit: "English" },
      { cn: 98, p: 1.0, unit: "English" },
      { cn: 78, p: 120.0, unit: "Metric" },
      { cn: 88, p: 75.0, unit: "Metric" },
    ];

    const actuals: number[] = [];
    const expecteds: number[] = [];

    for (const tc of testCases) {
      const s = tc.unit === "Metric" ? 25400.0 / tc.cn - 254.0 : 1000.0 / tc.cn - 10.0;
      const ia = 0.2 * s;
      const qExact = tc.p > ia ? Math.pow(tc.p - ia, 2) / (tc.p - ia + s) : 0.0;
      const qCalc = computeScsExcessRunoff(tc.p, tc.cn, undefined, tc.unit, 0);

      assert.ok(relErr(computePotentialRetention(tc.cn, tc.unit), s) < 1e-12);
      assert.ok(
        relErr(qCalc, qExact) < 1e-12,
        `SCS-CN parity failed for CN=${tc.cn}, P=${tc.p}: got ${qCalc}, expected ${qExact}`,
      );
      actuals.push(qCalc);
      expecteds.push(qExact);
    }

    assert.ok(rmse(actuals, expecteds) < 1e-12, `Expected RMSE < 1e-12, got ${rmse(actuals, expecteds)}`);

    // Impervious fraction blending: 30% impervious at P = 4.0 in, CN = 75
    const qPerv = computeScsExcessRunoff(4.0, 75, undefined, "English", 0);
    const qBlend = computeScsExcessRunoff(4.0, 75, undefined, "English", 30);
    const qBlendExact = 0.7 * qPerv + 0.3 * 4.0;
    assert.ok(relErr(qBlend, qBlendExact) < 1e-12);
  });

  it("satisfies exact Muskingum mass conservation (integral Q_out dt = integral Q_in dt), peak attenuation, and lag parity", () => {
    const dt = 0.5; // hr
    const kHours = 2.0; // hr
    const x = 0.2;
    const nstps = 2; // kSub = 1.0 hr -> dt/(2*kSub) = 0.25 >= 0.20 (stable)

    const coeffs = computeMuskingumCoefficients(kHours, x, dt, nstps);
    assert.equal(coeffs.stable, true);
    assert.ok(
      relErr(coeffs.c0 + coeffs.c1 + coeffs.c2, 1.0) < 1e-12,
      `Expected C0 + C1 + C2 = 1, got ${coeffs.c0 + coeffs.c1 + coeffs.c2}`,
    );

    // Build a smooth triangular/gamma inflow hydrograph that returns to 0 well before horizon end
    const nSteps = 200;
    const inflow: Hec1HydrographPoint[] = [];
    for (let i = 0; i < nSteps; i++) {
      const t = i * dt;
      const q = t <= 0 || t >= 20 ? 0.0 : 1000.0 * Math.pow(t / 4.0, 3) * Math.exp(3.0 * (1.0 - t / 4.0));
      inflow.push({ timeHours: t, flow: q });
    }

    const outflow = routeMuskingum(inflow, { kHours, x, nstps, dtHours: dt });

    // 1. Exact mass conservation: integral(Q_out dt) === integral(Q_in dt)
    const volIn = integrateHydrographVolume(inflow);
    const volOut = integrateHydrographVolume(outflow);
    assert.ok(
      relErr(volOut, volIn) < 1e-5,
      `Muskingum mass conservation error too high: volIn=${volIn}, volOut=${volOut}, relErr=${relErr(volOut, volIn)}`,
    );

    // 2. Peak attenuation and positive travel-time lag
    let peakIn = 0;
    let tPeakIn = 0;
    let peakOut = 0;
    let tPeakOut = 0;
    for (const pt of inflow) {
      if (pt.flow > peakIn) {
        peakIn = pt.flow;
        tPeakIn = pt.timeHours;
      }
    }
    for (const pt of outflow) {
      if (pt.flow > peakOut) {
        peakOut = pt.flow;
        tPeakOut = pt.timeHours;
      }
    }
    assert.ok(peakOut < peakIn, `Expected peak attenuation: peakOut (${peakOut}) < peakIn (${peakIn})`);
    assert.ok(tPeakOut > tPeakIn, `Expected positive lag: tPeakOut (${tPeakOut}) > tPeakIn (${tPeakIn})`);
    // Travel time lag should be close to K = 2.0 hr (within 1 time step for discrete peak)
    assert.ok(Math.abs(tPeakOut - tPeakIn - kHours) <= dt + 1e-9);

    // 3. Single-subreach exact recurrence parity (RMSE < 1e-12)
    const c1Reach = computeMuskingumCoefficients(1.0, 0.2, dt, 1);
    const routed1 = routeMuskingum(inflow, { kHours: 1.0, x: 0.2, nstps: 1, dtHours: dt });
    const refFlows: number[] = [inflow[0]!.flow];
    for (let i = 1; i < inflow.length; i++) {
      refFlows.push(c1Reach.c0 * inflow[i]!.flow + c1Reach.c1 * inflow[i - 1]!.flow + c1Reach.c2 * refFlows[i - 1]!);
    }
    const errRmse = rmse(
      routed1.map((p) => p.flow),
      refFlows,
    );
    assert.ok(errRmse < 1e-12, `Expected Muskingum recurrence RMSE < 1e-12, got ${errRmse}`);
  });

  it("conserves exact unit runoff volume for Clark, SCS, and Snyder unit hydrographs", () => {
    const areaSqMi = 10.0;
    const dt = 0.25; // 15 min
    const expectedVol = areaSqMi * unitRunoffVolumeFactor("English"); // 6453.3333... cfs*hr

    // 1. Clark UH (UC card: Tc = 2.0 hr, R = 1.5 hr)
    const clarkUh = generateClarkUnitHydrograph(areaSqMi, 2.0, 1.5, dt, "English");
    const clarkVol = clarkUh.reduce((acc, q) => acc + q * dt, 0.0);
    assert.ok(
      relErr(clarkVol, expectedVol) < 1e-4,
      `Clark UH volume conservation failed: got ${clarkVol}, expected ${expectedVol}, relErr=${relErr(clarkVol, expectedVol)}`,
    );

    // 2. SCS Dimensionless UH (UD card: Tlag = 1.2 hr)
    const scsUh = generateScsUnitHydrograph(areaSqMi, 1.2, dt, "English");
    const scsVol = scsUh.reduce((acc, q) => acc + q * dt, 0.0);
    assert.ok(
      relErr(scsVol, expectedVol) < 1e-10,
      `SCS UH volume conservation failed: got ${scsVol}, expected ${expectedVol}`,
    );

    // 3. Snyder UH (US card: Tp = 2.0 hr, Cp = 0.65)
    const snyderUh = generateSnyderUnitHydrograph(areaSqMi, 2.0, 0.65, dt, "English");
    const snyderVol = snyderUh.reduce((acc, q) => acc + q * dt, 0.0);
    assert.ok(
      relErr(snyderVol, expectedVol) < 1e-10,
      `Snyder UH volume conservation failed: got ${snyderVol}, expected ${expectedVol}`,
    );
  });

  it("simulates a complete two-subbasin + Muskingum reach + combine HEC-1 deck with mass conservation", () => {
    const deck = parseHec1Deck(
      [
        "ID FULL BENCHMARK WATERSHED",
        "IT 15 01JUN90 0000 300",
        "KK SUB1",
        "BA 5.0",
        "PI 0.2 0.6 1.2 1.5 0.8 0.3",
        "LS 0.4 80 0",
        "UC 1.5 1.2",
        "KK RCH1",
        "RM 4 1.0 0.2",
        "KK SUB2",
        "BA 3.0",
        "PI 0.2 0.6 1.2 1.5 0.8 0.3",
        "LS 0.4 80 0",
        "UD 1.0",
        "KK OUTLET",
        "HC 2",
        "ZZ",
      ].join("\n"),
    );

    const sim = simulateHec1Deck(deck);
    const sub1 = sim.stations.get("SUB1")!;
    const rch1 = sim.stations.get("RCH1")!;
    const sub2 = sim.stations.get("SUB2")!;
    const outlet = sim.stations.get("OUTLET")!;

    assert.equal(sim.outletStationId, "OUTLET");
    assert.ok(sub1.peakFlow > 0 && sub2.peakFlow > 0);
    // Routing attenuates peak and preserves total volume
    assert.ok(rch1.peakFlow < sub1.peakFlow);
    assert.ok(relErr(rch1.totalVolume, sub1.totalVolume) < 1e-4);
    // Combined outlet volume equals sum of routed SUB1 and SUB2 volumes
    assert.ok(relErr(outlet.totalVolume, rch1.totalVolume + sub2.totalVolume) < 1e-10);
  });
});
