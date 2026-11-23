// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRinexTimestamp } from "../src/parser/index.js";
import {
  GPS_F_REL,
  SPEED_OF_LIGHT,
  WGS84_MU,
  WGS84_OMEGA_E_DOT,
  computeSatelliteEcef,
  ecefToGeodetic,
  geodeticToEcef,
  solveReceiverPosition,
} from "../src/solver/index.js";
import type { RinexNavEphemeris, SatellitePseudorange } from "../src/types.js";

function makeNominalGpsEphemeris(prnNum: number, omega0Rad: number, m0Rad: number): RinexNavEphemeris {
  const toc = buildRinexTimestamp(24, 5, 1, 0, 0, 0);
  return {
    prn: `G${String(prnNum).padStart(2, "0")}`,
    prnNumber: prnNum,
    toc,
    af0: 1.2e-4,
    af1: -2.0e-12,
    af2: 0,
    iode: 42,
    crs: 15.625,
    deltaN: 4.5e-9,
    m0: m0Rad,
    cuc: 8.1e-7,
    e: 0.00425,
    cus: 6.5e-6,
    sqrtA: 5153.65, // a = 26,560,108.3225 m (~26,560 km)
    toe: toc.gpsTow,
    cic: 1.2e-8,
    omega0: omega0Rad,
    cis: -2.3e-8,
    i0: (55.0 * Math.PI) / 180.0,
    crc: 245.625,
    omega: Math.PI / 4.0,
    omegaDot: -8.1e-9,
    idot: 1.2e-10,
    codesL2: 1,
    gpsWeek: toc.gpsWeek,
    l2pFlag: 0,
    svAccuracy: 2.0,
    svHealth: 0,
    tgd: -5.5e-9,
    iodc: 42,
    transmissionTime: toc.gpsTow - 7200,
    fitInterval: 4,
    line: 1,
  };
}

describe("RINEX v2 GNSS Orbit & 3D Position Fix Benchmark", () => {
  it("propagates ICD-GPS-200 broadcast Keplerian ephemeris to MEO radius a ~ 26,560 km with relativistic correction", () => {
    const ephem = makeNominalGpsEphemeris(1, 0.5, 1.0);
    const sv = computeSatelliteEcef(ephem, ephem.toe + 600);

    // Semi-major axis a = sqrtA^2 ~ 26,560 km
    const aKm = sv.semiMajorAxisM / 1000;
    assert.ok(Math.abs(aKm - 26560.108) < 1.0, `Expected semi-major axis ~26,560 km, got ${aKm}`);

    // ECEF radius ||r|| must match orbital radius r_k to machine precision
    const ecefNorm = Math.hypot(sv.position.x, sv.position.y, sv.position.z);
    const relErr = Math.abs(ecefNorm - sv.orbitalRadiusM) / sv.orbitalRadiusM;
    assert.ok(relErr < 1e-12, `ECEF norm vs r_k relErr=${relErr}`);
    assert.ok(ecefNorm > 26_300_000 && ecefNorm < 26_800_000);

    // Relativistic clock correction delta_t_r = F_rel * e * sqrtA * sin(E_k)
    const expectedRel = GPS_F_REL * ephem.e * ephem.sqrtA * Math.sin(sv.eccentricAnomalyRad);
    assert.ok(Math.abs(sv.relativisticCorrectionSec - expectedRel) < 1e-18);

    // Orbital speed in ECEF is physically consistent (~3.0 - 4.0 km/s)
    const speedMps = Math.hypot(sv.velocity.x, sv.velocity.y, sv.velocity.z);
    assert.ok(speedMps > 2500 && speedMps < 4500, `Unexpected ECEF speed ${speedMps} m/s`);

    // Verify WGS-84 constants
    assert.strictEqual(WGS84_MU, 3.986005e14);
    assert.strictEqual(WGS84_OMEGA_E_DOT, 7.2921151467e-5);
    assert.strictEqual(SPEED_OF_LIGHT, 299792458.0);
  });

  it("recovers 3D receiver position & clock bias from 6 GPS satellites with position error < 1e-3 m, relErr < 1e-9, and rmse < 1e-3", () => {
    // True receiver location (Wettzell Geodetic Observatory, Germany)
    const trueGeo = { latDeg: 49.1442, lonDeg: 12.8789, altM: 665.9 };
    const trueEcef = geodeticToEcef(trueGeo);
    const trueClockBiasM = 45_210.75; // ~150.8 microseconds receiver clock offset

    // Build 6 well-distributed GPS satellites above the horizon from broadcast Keplerian orbits
    const planeConfigs: Array<[number, number, number]> = [
      [1, 0.2, 0.6],
      [5, 1.1, 1.1],
      [12, 2.0, 0.8],
      [17, 3.2, 1.4],
      [24, 4.3, 0.9],
      [30, 5.4, 1.2],
    ];

    const satObs: SatellitePseudorange[] = planeConfigs.map(([prn, omega0, m0]) => {
      const ephem = makeNominalGpsEphemeris(prn, omega0, m0);
      const sv = computeSatelliteEcef(ephem, ephem.toe);
      const geomRange = Math.hypot(sv.position.x - trueEcef.x, sv.position.y - trueEcef.y, sv.position.z - trueEcef.z);
      // Measured pseudorange P = rho + c * dt_rx - c * dt_sv
      const pr = geomRange + trueClockBiasM - SPEED_OF_LIGHT * sv.clockCorrectionSec;
      return {
        prn: sv.prn,
        satPos: sv.position,
        pseudorangeM: pr,
        satClockBiasSec: sv.clockCorrectionSec,
      };
    });

    // Solve starting from an intentionally perturbed initial guess (500 km away)
    const perturbedGuess = {
      x: trueEcef.x + 300_000,
      y: trueEcef.y - 250_000,
      z: trueEcef.z + 200_000,
    };

    const solution = solveReceiverPosition(satObs, perturbedGuess);
    assert.strictEqual(solution.converged, true);
    assert.strictEqual(solution.satellites.length, 6);

    const posErrM = Math.hypot(
      solution.ecef.x - trueEcef.x,
      solution.ecef.y - trueEcef.y,
      solution.ecef.z - trueEcef.z,
    );
    const ecefRadius = Math.hypot(trueEcef.x, trueEcef.y, trueEcef.z);
    const relErr = posErrM / ecefRadius;
    const clkErrM = Math.abs(solution.clockBiasM - trueClockBiasM);

    assert.ok(posErrM < 1e-3, `Expected position error < 1e-3 m, got ${posErrM}`);
    assert.ok(relErr < 1e-9, `Expected relErr < 1e-9, got ${relErr}`);
    assert.ok(clkErrM < 1e-3, `Expected clock bias error < 1e-3 m, got ${clkErrM}`);
    assert.ok(solution.rmseM < 1e-3, `Expected RMSE < 1e-3 m, got ${solution.rmseM}`);

    // Geodetic round-trip accuracy
    const recoveredGeo = ecefToGeodetic(solution.ecef);
    assert.ok(Math.abs(recoveredGeo.latDeg - trueGeo.latDeg) < 1e-7);
    assert.ok(Math.abs(recoveredGeo.lonDeg - trueGeo.lonDeg) < 1e-7);
    assert.ok(Math.abs(recoveredGeo.altM - trueGeo.altM) < 1e-3);

    // DOP metrics should be finite and positive
    assert.ok(Number.isFinite(solution.dop.gdop) && solution.dop.gdop > 0);
    assert.ok(Number.isFinite(solution.dop.pdop) && solution.dop.pdop > 0);
    assert.ok(Number.isFinite(solution.dop.hdop) && solution.dop.hdop > 0);
    assert.ok(Number.isFinite(solution.dop.vdop) && solution.dop.vdop > 0);
    assert.ok(solution.dop.gdop >= solution.dop.pdop);
  });
});
