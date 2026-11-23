// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GRAVITY_SI,
  GRAVITY_US,
  MANNING_PHI_SI,
  MANNING_PHI_US,
  computeCriticalWsel,
  computeNormalWsel,
  parseHec2Deck,
  solveHec2Profile,
  type Hec2CrossSection,
} from "../src/index.js";

function relErr(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-12);
}

function rmse(errors: number[]): number {
  if (errors.length === 0) return 0;
  const sumSq = errors.reduce((acc, e) => acc + e * e, 0);
  return Math.sqrt(sumSq / errors.length);
}

/**
 * Exact analytical normal depth solver for a prismatic trapezoidal channel
 * (bottom width b, side slope z H:1V, Manning n, bed slope S0, discharge Q).
 */
function analyticalTrapezoidalNormalDepth(b: number, z: number, n: number, s0: number, q: number, phi: number): number {
  let lo = 1e-6;
  let hi = 100.0;
  for (let i = 0; i < 80; i++) {
    const y = 0.5 * (lo + hi);
    const A = (b + z * y) * y;
    const P = b + 2 * y * Math.sqrt(1 + z * z);
    const R = A / P;
    const qCalc = (phi / n) * A * Math.pow(R, 2 / 3) * Math.sqrt(s0);
    if (qCalc < q) lo = y;
    else hi = y;
  }
  return 0.5 * (lo + hi);
}

/**
 * Exact analytical critical depth for a trapezoidal channel solving Q^2 * T / (g * A^3) = 1.
 */
function analyticalTrapezoidalCriticalDepth(b: number, z: number, q: number, g: number): number {
  let lo = 1e-6;
  let hi = 100.0;
  for (let i = 0; i < 80; i++) {
    const y = 0.5 * (lo + hi);
    const A = (b + z * y) * y;
    const T = b + 2 * z * y;
    const lhs = (q * q * T) / (g * A * A * A);
    if (lhs > 1.0) lo = y;
    else hi = y;
  }
  return 0.5 * (lo + hi);
}

describe("@modelscript/hec2 — Hydraulic Verification Benchmarks", () => {
  it("matches exact analytical Manning normal depth yn and critical depth yc=(q^2/g)^(1/3) for prismatic rectangular channel (SI & US)", () => {
    // 1. SI Rectangular channel: B = 10 m, Q = 40 m^3/s, n = 0.02, S0 = 0.001, invert = 100 m
    const B = 10.0;
    const Q = 40.0;
    const n = 0.02;
    const S0 = 0.001;
    const invert = 100.0;

    const rectXs: Hec2CrossSection = {
      secno: 100,
      numst: 4,
      stchl: 0,
      stchr: B,
      xlobl: 0,
      xlobr: 0,
      xlch: 0,
      pxsecr: 0,
      pxsece: 0,
      manning: { left: n, right: n, channel: n },
      contractionCoef: 0.1,
      expansionCoef: 0.3,
      grPoints: [
        { elevation: invert + 20, station: 0 },
        { elevation: invert, station: 0 },
        { elevation: invert, station: B },
        { elevation: invert + 20, station: B },
      ],
      line: 1,
    };

    // Exact rectangular critical depth: yc = (q^2 / g)^(1/3)
    const unitQ = Q / B;
    const ycExactSi = Math.cbrt((unitQ * unitQ) / GRAVITY_SI);
    const ycComputedSi = computeCriticalWsel(rectXs, Q, "SI") - invert;
    const ycRelErrSi = relErr(ycComputedSi, ycExactSi);
    assert.ok(ycRelErrSi < 1e-8, `Expected SI rectangular yc relErr < 1e-8, got ${ycRelErrSi}`);

    // Exact rectangular normal depth
    const ynExactSi = analyticalTrapezoidalNormalDepth(B, 0, n, S0, Q, MANNING_PHI_SI);
    const ynComputedSi = computeNormalWsel(rectXs, Q, S0, "SI") - invert;
    const ynRelErrSi = relErr(ynComputedSi, ynExactSi);
    assert.ok(ynRelErrSi < 1e-8, `Expected SI rectangular yn relErr < 1e-8, got ${ynRelErrSi}`);

    // 2. US Customary Rectangular channel: B = 30 ft, Q = 1200 cfs, n = 0.025, S0 = 0.0008
    const bUs = 30.0;
    const qUs = 1200.0;
    const nUs = 0.025;
    const sUs = 0.0008;
    const rectUs: Hec2CrossSection = {
      ...rectXs,
      stchr: bUs,
      manning: { left: nUs, right: nUs, channel: nUs },
      grPoints: [
        { elevation: invert + 30, station: 0 },
        { elevation: invert, station: 0 },
        { elevation: invert, station: bUs },
        { elevation: invert + 30, station: bUs },
      ],
    };

    const ycExactUs = Math.cbrt((qUs / bUs) ** 2 / GRAVITY_US);
    const ycComputedUs = computeCriticalWsel(rectUs, qUs, "US") - invert;
    assert.ok(relErr(ycComputedUs, ycExactUs) < 1e-8, "Expected US rectangular yc relErr < 1e-8");

    const ynExactUs = analyticalTrapezoidalNormalDepth(bUs, 0, nUs, sUs, qUs, MANNING_PHI_US);
    const ynComputedUs = computeNormalWsel(rectUs, qUs, sUs, "US") - invert;
    assert.ok(relErr(ynComputedUs, ynExactUs) < 1e-8, "Expected US rectangular yn relErr < 1e-8");
  });

  it("matches exact analytical normal depth yn and critical depth yc for prismatic trapezoidal channel", () => {
    // Trapezoidal channel: b = 12 m, z = 2 (2H:1V), height = 10 m, n = 0.025, S0 = 0.0005, Q = 60 m^3/s
    const b = 12.0;
    const z = 2.0;
    const hMax = 10.0;
    const n = 0.025;
    const S0 = 0.0005;
    const Q = 60.0;
    const invert = 50.0;

    const trapXs: Hec2CrossSection = {
      secno: 500,
      numst: 4,
      stchl: 0,
      stchr: b + 2 * z * hMax,
      xlobl: 0,
      xlobr: 0,
      xlch: 0,
      pxsecr: 0,
      pxsece: 0,
      manning: { left: n, right: n, channel: n },
      contractionCoef: 0.1,
      expansionCoef: 0.3,
      grPoints: [
        { elevation: invert + hMax, station: 0 },
        { elevation: invert, station: z * hMax },
        { elevation: invert, station: z * hMax + b },
        { elevation: invert + hMax, station: 2 * z * hMax + b },
      ],
      line: 1,
    };

    const ynExact = analyticalTrapezoidalNormalDepth(b, z, n, S0, Q, MANNING_PHI_SI);
    const ynComputed = computeNormalWsel(trapXs, Q, S0, "SI") - invert;
    const ynRelErr = relErr(ynComputed, ynExact);
    assert.ok(ynRelErr < 1e-8, `Expected trapezoidal yn relErr < 1e-8, got ${ynRelErr}`);

    const ycExact = analyticalTrapezoidalCriticalDepth(b, z, Q, GRAVITY_SI);
    const ycComputed = computeCriticalWsel(trapXs, Q, "SI") - invert;
    const ycRelErr = relErr(ycComputed, ycExact);
    assert.ok(ycRelErr < 1e-8, `Expected trapezoidal yc relErr < 1e-8, got ${ycRelErr}`);
  });

  it("solves subcritical M1 backwater curve with Standard Step energy balance residual < 1e-6 and monotonic asymptotic approach to yn", () => {
    // 10-station mild-slope rectangular channel (SI): B = 10 m, n = 0.02, S0 = 0.0005, Q = 30 m^3/s
    // Normal depth yn ~ 2.08 m, critical depth yc ~ 0.97 m.
    // Impose downstream dam/weir backwater depth y0 = 4.0 m > yn (classic M1 backwater curve!).
    const B = 10.0;
    const n = 0.02;
    const S0 = 0.0005;
    const Q = 30.0;
    const dx = 400.0;
    const nStations = 10;
    const y0 = 4.0;

    const lines: string[] = [
      "T1  M1 SUBCRITICAL BACKWATER BENCHMARK (SI)",
      `J1,0,0,0,0,${S0},1,0,${Q},${100.0 + y0}`,
      `NC,${n},${n},${n},0.1,0.3`,
    ];

    for (let i = 0; i < nStations; i++) {
      const x = i * dx;
      const bed = 100.0 + S0 * x;
      const reach = i === 0 ? 0 : dx;
      lines.push(`X1,${x},4,0,${B},${reach},${reach},${reach}`);
      lines.push(
        `GR,${(bed + 15).toFixed(4)},0,${bed.toFixed(4)},0,${bed.toFixed(4)},${B},${(bed + 15).toFixed(4)},${B}`,
      );
    }
    lines.push("EJ");

    const deck = parseHec2Deck(lines.join("\n"));
    const profile = solveHec2Profile(deck);

    assert.equal(profile.allConverged, true, "Expected all M1 stations to converge");
    assert.equal(profile.stations.length, nStations);
    assert.ok(
      profile.maxEnergyResidual < 1e-6,
      `Expected max Standard Step energy balance residual < 1e-6, got ${profile.maxEnergyResidual}`,
    );

    const ynExact = analyticalTrapezoidalNormalDepth(B, 0, n, S0, Q, MANNING_PHI_SI);
    const energyResiduals: number[] = [];

    for (let i = 0; i < profile.stations.length; i++) {
      const st = profile.stations[i]!;
      energyResiduals.push(st.energyResidual);
      assert.equal(st.flowRegime, "subcritical", `Station ${st.secno} should be subcritical`);
      assert.ok(st.depth > ynExact, `M1 depth (${st.depth}) should remain above normal depth yn (${ynExact})`);

      if (i > 0) {
        const prev = profile.stations[i - 1]!;
        // M1 curve: water surface elevation rises upstream, while flow depth decreases monotonically toward yn
        assert.ok(st.wsel > prev.wsel, "M1 WSEL must increase moving upstream");
        assert.ok(st.depth < prev.depth, "M1 depth must decrease moving upstream toward normal depth yn");
      }
    }

    const residualRmse = rmse(energyResiduals);
    assert.ok(residualRmse < 1e-7, `Expected energy residual RMSE < 1e-7, got ${residualRmse}`);

    // Upstream station should asymptotically approach normal depth yn
    const upstreamDepth = profile.stations[nStations - 1]!.depth;
    assert.ok(
      upstreamDepth < y0 - 0.5,
      `Expected upstream depth (${upstreamDepth}) to draw down toward yn (${ynExact})`,
    );
  });
});
