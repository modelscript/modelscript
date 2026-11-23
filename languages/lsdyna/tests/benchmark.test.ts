// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLsDynaDeck } from "../src/parser/index.js";
import { barWaveSpeed, computeCflAnalysis, solveLsDynaExplicit } from "../src/solver/index.js";

function relErr(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(1e-15, Math.abs(expected));
}

function rmse(actual: number[], expected: number[]): number {
  assert.equal(actual.length, expected.length);
  let sumSq = 0;
  for (let i = 0; i < actual.length; i++) {
    const d = actual[i]! - expected[i]!;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / Math.max(1, actual.length));
}

function build1DElasticBarDeck(numElements: number, length: number, e: number, rho: number, area: number): string {
  const dx = length / numElements;
  const lines: string[] = ["*KEYWORD", "*TITLE", "1D Fixed-Free Elastic Bar", "*NODE"];
  for (let i = 0; i <= numElements; i++) {
    lines.push(`${i + 1}, ${(i * dx).toFixed(8)}, 0.0, 0.0, 0, 0`);
  }
  lines.push("*ELEMENT_BEAM");
  for (let i = 1; i <= numElements; i++) {
    lines.push(`${i}, 1, ${i}, ${i + 1}, 0`);
  }
  lines.push("*PART", "SteelBar", "1, 1, 1, 0, 0, 0, 0, 0");
  lines.push("*SECTION_BEAM", "1, 3, 1.0", `${area}, 0.0, 0.0, 0.0`);
  lines.push("*MAT_ELASTIC", `1, ${rho}, ${e}, 0.3`);
  lines.push("*BOUNDARY_SPC_NODE", "1, 0, 1, 1, 1, 1, 1, 1");
  lines.push("*CONTROL_TERMINATION", "0.002, 0, 0.0, 0.0, 0.0");
  lines.push("*CONTROL_TIMESTEP", "0.0, 0.8, 0, 0.0, 0.0");
  lines.push("*END");
  return lines.join("\n") + "\n";
}

describe("@modelscript/lsdyna — Explicit Dynamics Physics Benchmarks", () => {
  it("Benchmark 1: 1D elastic bar longitudinal wave speed c = sqrt(E/rho) and fundamental frequency f1 = c/(4L)", () => {
    const L = 1.0;
    const E = 2.1e11;
    const rho = 7850.0;
    const A = 1.0e-4;
    const N = 20;

    const cExact = Math.sqrt(E / rho);
    const f1Exact = cExact / (4.0 * L);
    const T1Exact = 1.0 / f1Exact;

    const deck = parseLsDynaDeck(build1DElasticBarDeck(N, L, E, rho, A));
    const cfl = computeCflAnalysis(deck);

    // Verify exact wave speed c = sqrt(E/rho)
    assert.ok(relErr(cfl.maxWaveSpeed, cExact) < 1e-12, `Wave speed relErr too high: ${cfl.maxWaveSpeed} vs ${cExact}`);
    assert.ok(relErr(barWaveSpeed(E, rho), cExact) < 1e-12);

    // Excite fundamental mode shape u_0(x) = U0 * sin(pi * x / (2 * L))
    const U0 = 1.0e-4;
    const initDisp = new Map<number, [number, number, number]>();
    for (let i = 1; i <= N + 1; i++) {
      const x = ((i - 1) / N) * L;
      initDisp.set(i, [U0 * Math.sin((Math.PI * x) / (2.0 * L)), 0, 0]);
    }

    const res = solveLsDynaExplicit(deck, {
      endTime: 2.5 * T1Exact,
      tssfac: 0.5,
      initialDisplacements: initDisp,
    });

    // Extract zero-crossings of tip displacement (node N+1) to measure fundamental frequency f1
    const tipNode = N + 1;
    const crossings: number[] = [];
    for (let i = 1; i < res.samples.length; i++) {
      const uPrev = res.samples[i - 1]!.displacements.get(tipNode)![0];
      const uCurr = res.samples[i]!.displacements.get(tipNode)![0];
      if ((uPrev > 0 && uCurr <= 0) || (uPrev < 0 && uCurr >= 0)) {
        const tPrev = res.samples[i - 1]!.time;
        const tCurr = res.samples[i]!.time;
        const frac = Math.abs(uPrev) / (Math.abs(uPrev) + Math.abs(uCurr));
        crossings.push(tPrev + frac * (tCurr - tPrev));
      }
    }

    assert.ok(crossings.length >= 4, `Expected >= 4 zero crossings, got ${crossings.length}`);
    // Half-period between consecutive crossings => full period T1 = 2 * avgHalfPeriod
    let sumHalfPeriod = 0;
    for (let i = 1; i < crossings.length; i++) {
      sumHalfPeriod += crossings[i]! - crossings[i - 1]!;
    }
    const avgT1 = (2.0 * sumHalfPeriod) / (crossings.length - 1);
    const f1Measured = 1.0 / avgT1;
    const f1RelErr = relErr(f1Measured, f1Exact);

    assert.ok(
      f1RelErr < 0.015,
      `Expected fundamental frequency f1 within 1.5% of c/(4L)=${f1Exact.toFixed(2)} Hz, got ${f1Measured.toFixed(2)} Hz (relErr=${f1RelErr.toExponential(3)})`,
    );
  });

  it("Benchmark 2: SDOF undamped free-vibration trajectory RMSE and energy conservation", () => {
    // 1-element fixed-free bar: L=1, A=1, E=1e4, rho=2 => lumped free-node mass m = 0.5*rho*A*L = 1.0 kg,
    // stiffness k = E*A/L = 1e4 N/m => omega = sqrt(k/m) = 100 rad/s, T = 2*pi/100 s.
    const deck = parseLsDynaDeck(`*KEYWORD
*TITLE
SDOF Undamped Oscillator
*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
*ELEMENT_BEAM
1, 1, 1, 2
*PART
SpringBar
1, 1, 1
*SECTION_BEAM
1, 3, 1.0
1.0
*MAT_ELASTIC
1, 2.0, 1.0e4, 0.0
*BOUNDARY_SPC_NODE
1, 0, 1, 1, 1, 1, 1, 1
*INITIAL_VELOCITY
0, 0, 0
1.0, 0.0, 0.0
*CONTROL_TERMINATION
0.314159265
*END
`);

    const omega = 100.0;
    const v0 = 1.0;
    const res = solveLsDynaExplicit(deck, {
      dt: 2.0e-4, // << dt_cr = 1 / sqrt(5000) = 0.01414 s
      endTime: (5.0 * 2.0 * Math.PI) / omega, // 5 full cycles
    });

    const numU: number[] = [];
    const exactU: number[] = [];
    for (const s of res.samples) {
      numU.push(s.displacements.get(2)![0]);
      exactU.push((v0 / omega) * Math.sin(omega * s.time));
    }

    const errRmse = rmse(numU, exactU);
    assert.ok(errRmse < 5.0e-5, `Expected SDOF displacement RMSE < 5e-5, got ${errRmse.toExponential(3)}`);
    assert.ok(
      res.maxEnergyDriftRatio < 5.0e-4,
      `Expected SDOF total energy drift < 0.05%, got ${(res.maxEnergyDriftRatio * 100).toFixed(4)}%`,
    );

    // Check total energy remains close to 0.5 * m * v0^2 = 0.5 J
    const finalE = res.samples[res.samples.length - 1]!.totalEnergy;
    assert.ok(relErr(finalE, 0.5) < 5.0e-4, `Expected final total energy ~0.5 J, got ${finalE}`);
  });

  it("Benchmark 3: CFL critical timestep parity across mixed-material, non-uniform mesh", () => {
    const deck = parseLsDynaDeck(`*KEYWORD
*TITLE
Mixed Steel & Aluminum Mesh
*NODE
1, 0.0, 0.0, 0.0
2, 0.25, 0.0, 0.0
3, 0.30, 0.0, 0.0
*ELEMENT_BEAM
1, 1, 1, 2
2, 2, 2, 3
*PART
Steel
1, 1, 1
Aluminum
2, 1, 2
*SECTION_BEAM
1, 3, 1.0
0.001
*MAT_ELASTIC
1, 7850.0, 2.1e11, 0.3
*MAT_ELASTIC
2, 2700.0, 7.0e10, 0.33
*BOUNDARY_SPC_NODE
1, 0, 1, 1, 1, 1, 1, 1
*CONTROL_TERMINATION
0.001
*CONTROL_TIMESTEP
0.0, 0.9
*END
`);

    const cfl = computeCflAnalysis(deck);
    const dtSteel = 0.25 / Math.sqrt(2.1e11 / 7850.0);
    const dtAlum = 0.05 / Math.sqrt(7.0e10 / 2700.0);
    const expectedMin = Math.min(dtSteel, dtAlum);

    assert.equal(cfl.controllingElementId, 2);
    assert.ok(
      relErr(cfl.minDtCritical, expectedMin) < 1e-12,
      `CFL dt_cr mismatch: ${cfl.minDtCritical} vs ${expectedMin}`,
    );
    assert.ok(relErr(cfl.stableDt, 0.9 * expectedMin) < 1e-12);
  });
});
