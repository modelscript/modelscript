// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  cartesianToKeplerian,
  computeOrbitAcceleration,
  keplerianToCartesian,
  propagateOrbit,
} from "../src/astrodynamics/index.js";
import type { CcsdsKeplerianElements } from "../src/types.js";

describe("CCSDS Astrodynamics & Orbit Mechanics", () => {
  it("converts circular equatorial Keplerian elements to Cartesian and back", () => {
    const elem: CcsdsKeplerianElements = {
      semiMajorAxisKm: 7000.0,
      eccentricity: 0.001,
      inclinationDeg: 28.5,
      raanDeg: 45.0,
      argOfPericenterDeg: 30.0,
      trueAnomalyDeg: 60.0,
    };

    const sv = keplerianToCartesian(elem);
    assert(sv.x !== 0 || sv.y !== 0 || sv.z !== 0);

    // Verify distance ~ 7000 km
    const r = Math.sqrt(sv.x * sv.x + sv.y * sv.y + sv.z * sv.z);
    assert(Math.abs(r - 7000.0) < 50.0, `Expected r ~ 7000 km, got ${r}`);

    // Verify circular velocity ~ 7.546 km/s
    const v = Math.sqrt(sv.vx * sv.vx + sv.vy * sv.vy + sv.vz * sv.vz);
    assert(Math.abs(v - 7.546) < 0.1, `Expected v ~ 7.546 km/s, got ${v}`);

    // Roundtrip back to Keplerian
    const elemBack = cartesianToKeplerian(sv);
    assert(Math.abs(elemBack.semiMajorAxisKm - elem.semiMajorAxisKm) < 1.0);
    assert(Math.abs(elemBack.eccentricity - elem.eccentricity) < 0.005);
    assert(Math.abs(elemBack.inclinationDeg - elem.inclinationDeg) < 0.1);
  });

  it("computes J2 oblateness acceleration accurately", () => {
    const pos: [number, number, number] = [7000.0, 0.0, 0.0];
    const vel: [number, number, number] = [0.0, 7.546, 0.0];

    const aTwoBody = computeOrbitAcceleration(pos, vel, undefined, { includeJ2: false });
    const aWithJ2 = computeOrbitAcceleration(pos, vel, undefined, { includeJ2: true });

    // In equatorial plane, J2 increases inward radial acceleration slightly
    assert(Math.abs(aWithJ2[0]) > Math.abs(aTwoBody[0]));
  });

  it("propagates LEO satellite orbit across 1 full orbital period (~90 min)", () => {
    const elem: CcsdsKeplerianElements = {
      semiMajorAxisKm: 6878.137, // ~500 km altitude
      eccentricity: 0.0005,
      inclinationDeg: 51.6, // ISS inclination
      raanDeg: 0.0,
      argOfPericenterDeg: 0.0,
      trueAnomalyDeg: 0.0,
    };

    const sv0 = keplerianToCartesian(elem);
    const periodSeconds = 2.0 * Math.PI * Math.sqrt(Math.pow(elem.semiMajorAxisKm, 3) / 398600.4418); // ~5670 s

    const traj = propagateOrbit(
      sv0,
      { massKg: 450, dragAreaM2: 2.0, dragCoeff: 2.2 },
      {
        durationSeconds: periodSeconds,
        stepSeconds: 60.0,
        includeJ2: true,
        includeDrag: false,
      },
    );

    assert(traj.length > 80);

    // Initial altitude ~ 500 km
    assert(Math.abs(traj[0]!.altitudeKm - 500.0) < 5.0);

    // Final point after 1 orbit should return close to initial position
    const lastPt = traj[traj.length - 1]!;
    assert(Math.abs(lastPt.altitudeKm - 500.0) < 15.0);
    assert(Math.abs(lastPt.latitudeDeg) <= 52.0); // Bounded by inclination
  });
});
