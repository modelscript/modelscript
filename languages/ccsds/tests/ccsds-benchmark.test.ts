// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { runCcsdsBenchmark } from "./ccsds-benchmark-runner.js";

test("CCSDS Astrodynamics Benchmark: High-Fidelity Orbit Propagation & OEM Ephemeris", () => {
  const rep = runCcsdsBenchmark();

  assert.equal(rep.objectName, "ISS_ZARYA");
  assert.ok(rep.initialSemiMajorAxisKm > 6770.0 && rep.initialSemiMajorAxisKm < 6790.0, "Altitude ~400km");
  assert.ok(rep.initialEccentricity < 0.002, "Near-circular orbit");
  assert.ok(Math.abs(rep.initialInclinationDeg - 51.64) < 0.1, "Inclination 51.64 deg");
  assert.ok(rep.propagatedStepsCount >= 60, `Adaptive RK45 steps ${rep.propagatedStepsCount}`);
  assert.equal(rep.finalTimeSeconds, 5560.0);
  assert.ok(rep.semiMajorAxisDriftKm < 1.0, `Orbit semi-major axis drift ${rep.semiMajorAxisDriftKm} km < 1.0 km`);
  assert.ok(rep.interpolatedMidpointPositionKm[0] < -4000.0, "Cubic Hermite interpolation sanity");
  assert.equal(rep.daeVariablesCount, rep.daeEquationsCount, "DAE must be structurally square");
});
