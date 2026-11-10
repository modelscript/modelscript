// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CCSDS Astrodynamics & Orbit Propagation Benchmark Runner
 *
 * Verifies high-fidelity orbit propagation (J2-J4 zonal harmonics, solar radiation pressure,
 * luni-solar third body gravity) and cubic Hermite OEM ephemeris interpolation.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cartesianToKeplerian,
  computeOrbitAcceleration,
  interpolateOemState,
  keplerianToCartesian,
  lowerCcsdsToDae,
  parseCcsds,
  propagateOrbit,
  type CcsdsKeplerianElements,
  type CcsdsOemDocument,
  type CcsdsStateVector,
} from "../src/index.js";

export const ISS_OEM_BENCHMARK = `CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2026-11-09T00:00:00
ORIGINATOR = MODELSCRIPT_AEROSPACE
META_START
OBJECT_NAME = ISS_ZARYA
OBJECT_ID = 1998-067A
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = 2026-11-09T00:00:00.000
STOP_TIME = 2026-11-09T00:10:00.000
META_STOP
2026-11-09T00:00:00.000  -4969.801   2662.131  3756.261  -0.2032  -6.3819   4.2541
2026-11-09T00:05:00.000  -4428.110    632.412  4741.012   3.7121  -6.8410   2.1012
2026-11-09T00:10:00.000  -3012.440  -1420.210  5102.330   5.5012  -6.2102  -0.1205
`;

export interface CcsdsBenchmarkReport {
  objectName: string;
  initialSemiMajorAxisKm: number;
  initialEccentricity: number;
  initialInclinationDeg: number;
  propagatedStepsCount: number;
  finalTimeSeconds: number;
  semiMajorAxisDriftKm: number;
  interpolatedMidpointPositionKm: [number, number, number];
  daeVariablesCount: number;
  daeEquationsCount: number;
}

export function runCcsdsBenchmark(oemText = ISS_OEM_BENCHMARK): CcsdsBenchmarkReport {
  const doc = parseCcsds(oemText, "iss.oem") as CcsdsOemDocument;
  assert.equal(doc.metadata.objectName, "ISS_ZARYA");

  // Initial state from OEM
  const st0 = doc.points[0]!;
  const sv0: CcsdsStateVector = {
    x: st0.x,
    y: st0.y,
    z: st0.z,
    vx: st0.vx,
    vy: st0.vy,
    vz: st0.vz,
  };

  const kep0 = cartesianToKeplerian(sv0);
  assert.ok(kep0.semiMajorAxisKm > 6700.0 && kep0.semiMajorAxisKm < 6900.0, `ISS altitude ~400km`);
  assert.ok(kep0.eccentricity < 0.01, `Near-circular orbit`);
  assert.ok(Math.abs(kep0.inclinationDeg - 51.6) < 1.0, `ISS inclination ~51.6 deg`);

  // Propagate orbit using adaptive RK45 with J2-J4 harmonics and third-body luni-solar gravity
  const traj = propagateOrbit(
    sv0,
    { massKg: 450000, solarRadAreaM2: 2400.0, solarRadCoeff: 1.2 },
    {
      durationSeconds: 5560.0, // ~1 full orbital period (92.6 min)
      stepSeconds: 60.0,
      integrator: "rk45",
      rtol: 1e-8,
      atol: 1e-9,
      includeZonalHarmonics: true,
      includeThirdBody: true,
      includeSrp: true,
    },
  );

  assert.ok(traj.length > 50, `Expected > 50 trajectory steps, got ${traj.length}`);
  const stFinal = traj[traj.length - 1]!;
  const svFinal: CcsdsStateVector = {
    x: stFinal.x,
    y: stFinal.y,
    z: stFinal.z,
    vx: stFinal.vx,
    vy: stFinal.vy,
    vz: stFinal.vz,
  };
  const kepFinal = cartesianToKeplerian(svFinal);
  const daDrift = Math.abs(kepFinal.semiMajorAxisKm - kep0.semiMajorAxisKm);
  assert.ok(daDrift < 5.0, `Semi-major axis drift ${daDrift} km over full orbit under J2-J4`);

  // Interpolate intermediate state at t = 2.5 minutes (150s)
  const midState = interpolateOemState(doc, "2026-11-09T00:02:30.000");
  assert.ok(midState.x !== undefined && midState.y !== undefined && midState.z !== undefined);

  // Lower to DAE arena
  const dae = lowerCcsdsToDae(doc);
  const nVars = dae.variables().length;
  const nEqs = dae.equations().length;

  return {
    objectName: doc.metadata.objectName,
    initialSemiMajorAxisKm: kep0.semiMajorAxisKm,
    initialEccentricity: kep0.eccentricity,
    initialInclinationDeg: kep0.inclinationDeg,
    propagatedStepsCount: traj.length,
    finalTimeSeconds: stFinal.timeSeconds,
    semiMajorAxisDriftKm: daDrift,
    interpolatedMidpointPositionKm: [midState.x, midState.y, midState.z],
    daeVariablesCount: nVars,
    daeEquationsCount: nEqs,
  };
}

if (process.argv[1] && process.argv[1].endsWith("ccsds-benchmark-runner.ts")) {
  console.log("=== CCSDS Astrodynamics & Orbit Propagation Benchmark ===");
  const report = runCcsdsBenchmark();
  console.log(JSON.stringify(report, null, 2));
}
