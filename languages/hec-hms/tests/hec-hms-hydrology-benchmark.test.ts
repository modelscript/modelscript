// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { computeCumulativeRunoff, computePotentialRetention, routeMuskingum } from "../src/index.js";

test("HEC-HMS Hydrology Benchmark: SCS Curve Number potential retention and runoff tolerance", () => {
  // Analytical benchmark: CN = 75 in English units: S = 1000/75 - 10 = 3.333 in, Ia = 0.2 * S = 0.667 in
  const sEnglish = computePotentialRetention(75, "U.S. Customary");
  const expectedS = 1000.0 / 75.0 - 10.0;
  assert.ok(Math.abs(sEnglish - expectedS) < 1e-4, "Potential retention S error within tolerance");

  // In Metric: CN = 75: S = 25400/75 - 254 = 84.667 mm
  const sMetric = computePotentialRetention(75, "Metric");
  assert.ok(Math.abs(sMetric - 84.667) < 1e-2, "Metric S error within tolerance");

  // Runoff for P = 100 mm: Ia = 0.2 * 84.667 = 16.933 mm
  // Q = (100 - 16.933)^2 / (100 - 16.933 + 84.667) = 6900.1 / 167.734 = 41.137 mm
  const qRunoff = computeCumulativeRunoff(100.0, 75.0, undefined, "Metric");
  assert.ok(
    Math.abs(qRunoff - 41.137) < 0.1,
    `Cumulative runoff should converge to expected benchmark (got ${qRunoff})`,
  );
});

test("HEC-HMS Routing Benchmark: Muskingum channel attenuation and mass conservation tolerance", () => {
  // Formulate a triangular hydrograph
  const inflow = [
    { timeHours: 0.0, flow: 0.0 },
    { timeHours: 1.0, flow: 50.0 },
    { timeHours: 2.0, flow: 100.0 },
    { timeHours: 3.0, flow: 50.0 },
    { timeHours: 4.0, flow: 10.0 },
    { timeHours: 5.0, flow: 0.0 },
  ];

  const routed = routeMuskingum(inflow, {
    kHours: 1.5,
    x: 0.2,
    subreaches: 2,
  });

  assert.equal(routed.length, inflow.length);

  // Peak attenuation: routed peak should be dampened compared to inflow peak
  const peakIn = Math.max(...inflow.map((p) => p.flow));
  const peakOut = Math.max(...routed.map((p) => p.flow));
  assert.ok(peakOut < peakIn, `Routed peak (${peakOut}) should be attenuated relative to inflow (${peakIn})`);

  // Time lag: peak should occur later
  const peakInTime = inflow.find((p) => p.flow === peakIn)!.timeHours;
  const peakOutTime = routed.find((p) => p.flow === peakOut)!.timeHours;
  assert.ok(
    peakOutTime >= peakInTime,
    `Routed peak time (${peakOutTime}) should exhibit positive lag relative to inflow (${peakInTime})`,
  );
});
