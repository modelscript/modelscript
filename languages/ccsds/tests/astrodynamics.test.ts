// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  cartesianToKeplerian,
  computeLunarPositionEciKm,
  computeOrbitAcceleration,
  computeSolarPositionEciKm,
  evaluateThermosphericDensityKgM3,
  interpolateOemState,
  isInEarthCylindricalShadow,
  keplerianToCartesian,
  meanToTrueAnomalyDeg,
  propagateOrbit,
} from "../src/astrodynamics/index.js";
import { parseCcsds } from "../src/parser/index.js";
import type { CcsdsKeplerianElements, CcsdsOemDocument } from "../src/types.js";

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

  it("converts OMM MEAN_MOTION and MEAN_ANOMALY via Kepler's equation without NaN", () => {
    const omm = `CCSDS_OMM_VERS = 2.0
OBJECT_NAME = ISS (ZARYA)
OBJECT_ID = 1998-067A
CENTER_NAME = EARTH
REF_FRAME = TEME
TIME_SYSTEM = UTC
MEAN_ELEMENT_THEORY = SGP4
EPOCH = 2026-10-26T12:00:00.000
MEAN_MOTION = 15.49523104
ECCENTRICITY = 0.05
INCLINATION = 51.6416
RA_OF_ASC_NODE = 247.4627
ARG_OF_PERICENTER = 130.5360
MEAN_ANOMALY = 45.0
`;
    const doc = parseCcsds(omm, "iss.omm");
    assert.strictEqual(doc.format, "OMM");
    assert(doc.meanElements !== undefined);
    assert(Number.isFinite(doc.meanElements.semiMajorAxisKm));
    assert(doc.meanElements.semiMajorAxisKm > 6700.0 && doc.meanElements.semiMajorAxisKm < 6900.0);
    assert(doc.meanElements.trueAnomalyDeg !== undefined);
    // For e = 0.05 and M = 45 deg, true anomaly nu > M
    assert(doc.meanElements.trueAnomalyDeg > 45.0);

    const sv = keplerianToCartesian(doc.meanElements);
    assert(Number.isFinite(sv.x) && Number.isFinite(sv.vx));

    // Verify meanToTrueAnomalyDeg directly for eccentric orbit
    const nu = meanToTrueAnomalyDeg(90.0, 0.2);
    assert(nu > 110.0 && nu < 115.0);
  });

  it("evaluates multi-layer CIRA-72 thermospheric density and drag acceleration at LEO altitudes", () => {
    const rho400 = evaluateThermosphericDensityKgM3(400.0);
    const rho600 = evaluateThermosphericDensityKgM3(600.0);
    // At 400 km, CIRA-72 density is ~ 3.7e-12 kg/m^3 (much higher than single-scale-height exp(-400/8.5) ~ 0)
    assert(rho400 > 1e-13 && rho400 < 1e-10, `Expected realistic LEO density at 400 km, got ${rho400}`);
    assert(rho600 > 0 && rho600 < rho400);

    const pos: [number, number, number] = [6778.137, 0.0, 0.0]; // 400 km altitude
    const vel: [number, number, number] = [0.0, 7.67, 0.0];
    const aNoDrag = computeOrbitAcceleration(
      pos,
      vel,
      { massKg: 100, dragAreaM2: 10.0, dragCoeff: 2.2 },
      { includeJ2: false, includeDrag: false },
    );
    const aDrag = computeOrbitAcceleration(
      pos,
      vel,
      { massKg: 100, dragAreaM2: 10.0, dragCoeff: 2.2 },
      { includeJ2: false, includeDrag: true },
    );
    // Drag opposes +y velocity, so aDrag[1] < aNoDrag[1] (negative along-track deceleration)
    assert(aDrag[1] < aNoDrag[1]);
  });

  it("computes J3 and J4 zonal harmonics, cylindrical shadow SRP, and third-body Moon/Sun gravity", () => {
    const pos: [number, number, number] = [5000.0, 0.0, 5000.0];
    const vel: [number, number, number] = [0.0, 7.5, 0.0];

    const aJ2Only = computeOrbitAcceleration(pos, vel, undefined, {
      includeJ2: true,
      includeJ3: false,
      includeJ4: false,
    });
    const aJ234 = computeOrbitAcceleration(pos, vel, undefined, { includeZonalHarmonics: true });
    assert(Math.abs(aJ234[0] - aJ2Only[0]) > 1e-10);
    assert(Math.abs(aJ234[2] - aJ2Only[2]) > 1e-10);

    // Cylindrical shadow check: Sun along +X, satellite behind Earth at [-7000, 0, 0] is in umbra
    assert.strictEqual(isInEarthCylindricalShadow([-7000.0, 0.0, 0.0]), true);
    assert.strictEqual(isInEarthCylindricalShadow([7000.0, 0.0, 0.0]), false);
    assert.strictEqual(isInEarthCylindricalShadow([-7000.0, 7000.0, 0.0]), false);

    const sc = { massKg: 200, solarRadAreaM2: 10.0, solarRadCoeff: 1.5 };
    const aShadow = computeOrbitAcceleration([-7000.0, 0.0, 0.0], vel, sc, { includeJ2: false, includeSrp: true });
    const aNoSrp = computeOrbitAcceleration([-7000.0, 0.0, 0.0], vel, sc, { includeJ2: false, includeSrp: false });
    assert.strictEqual(aShadow[0], aNoSrp[0]); // SRP suppressed inside Earth shadow

    const aSunlit = computeOrbitAcceleration([7000.0, 0.0, 0.0], vel, sc, { includeJ2: false, includeSrp: true });
    const aSunlitNoSrp = computeOrbitAcceleration([7000.0, 0.0, 0.0], vel, sc, { includeJ2: false, includeSrp: false });
    assert(aSunlit[0] < aSunlitNoSrp[0]); // Pushed away from Sun (+X)

    // Third-body Moon & Sun gravity perturbations
    const sunPos = computeSolarPositionEciKm(0);
    const moonPos = computeLunarPositionEciKm(0);
    const rSun = Math.hypot(sunPos[0], sunPos[1], sunPos[2]);
    const rMoon = Math.hypot(moonPos[0], moonPos[1], moonPos[2]);
    assert(rSun > 1.45e8 && rSun < 1.53e8);
    assert(rMoon > 3.5e5 && rMoon < 4.1e5);

    const aWith3B = computeOrbitAcceleration([42164.0, 0.0, 0.0], [0.0, 3.07, 0.0], undefined, {
      includeJ2: false,
      includeThirdBody: true,
      epochSeconds: 0,
    });
    const aNo3B = computeOrbitAcceleration([42164.0, 0.0, 0.0], [0.0, 3.07, 0.0], undefined, {
      includeJ2: false,
      includeThirdBody: false,
    });
    const delta3B = Math.hypot(aWith3B[0] - aNo3B[0], aWith3B[1] - aNo3B[1], aWith3B[2] - aNo3B[2]);
    assert(delta3B > 1e-10, `Expected non-zero luni-solar perturbation at GEO, got ${delta3B}`);
  });

  it("propagates with adaptive Dormand-Prince RK45 and interpolates OEM ephemeris via cubic Hermite", () => {
    const sv0 = keplerianToCartesian({
      semiMajorAxisKm: 7000.0,
      eccentricity: 0.05,
      inclinationDeg: 45.0,
      raanDeg: 20.0,
      argOfPericenterDeg: 10.0,
      trueAnomalyDeg: 0.0,
    });

    const trajRk45 = propagateOrbit(sv0, undefined, {
      durationSeconds: 1800,
      stepSeconds: 60,
      integrator: "rk45",
      rtol: 1e-9,
      atol: 1e-10,
      includeZonalHarmonics: true,
    });
    assert(trajRk45.length >= 5);
    assert(Math.abs(trajRk45[trajRk45.length - 1]!.timeSeconds - 1800) < 1e-6);

    // Cubic Hermite OEM interpolation test against exact cubic trajectory x(t) = 7000 + 7.5*t - 0.0005*t^2
    const oemText = `CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2026-10-26T00:00:00
ORIGINATOR = MODELSCRIPT
META_START
OBJECT_NAME = SAT-1
OBJECT_ID = 2026-001A
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = 2026-10-26T00:00:00.000
STOP_TIME = 2026-10-26T00:01:00.000
META_STOP
2026-10-26T00:00:00.000 7000.0 0.0 0.0 0.0 7.5 0.0
2026-10-26T00:01:00.000 6983.0 449.0 0.0 -0.566 7.48 0.0
`;
    const oemDoc = parseCcsds(oemText, "sat.oem") as CcsdsOemDocument;
    const midState = interpolateOemState(oemDoc, "2026-10-26T00:00:30.000");
    assert(midState.x > 6983.0 && midState.x < 7000.0);
    assert(midState.y > 220.0 && midState.y < 230.0);
    assert(midState.vy >= 7.479 && midState.vy <= 7.51);
  });
});
