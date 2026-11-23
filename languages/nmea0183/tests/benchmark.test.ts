// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WGS84_A,
  appendNmeaChecksum,
  computeNmeaChecksum,
  decimalDegreesToDdmm,
  ecefToGeodetic,
  geodeticToEcef,
  geodeticToEnu,
  haversineDistance,
  initialBearing,
  solveNmeaTrack,
  vincentyInverse,
} from "../src/index.js";

describe("@modelscript/nmea0183 Geodesy & Telemetry Benchmark Suite", () => {
  it("matches exact WGS-84 equatorial and meridional geodesic distances & bearings (relErr < 1e-6)", () => {
    // 1. Equatorial 1 degree longitude arc on WGS-84: exact s = a * (pi / 180) = 111319.49079327358 m
    const exactEq1Deg = WGS84_A * (Math.PI / 180);
    const eqRes = vincentyInverse(0, 0, 0, 1);
    assert.strictEqual(eqRes.converged, true);
    const eqRelErr = Math.abs(eqRes.distanceM - exactEq1Deg) / exactEq1Deg;
    assert.ok(eqRelErr < 1e-6, `Equatorial 1-deg relErr=${eqRelErr} should be < 1e-6`);
    assert.ok(
      Math.abs(eqRes.initialBearingDeg - 90.0) < 1e-6,
      `Expected East bearing 90 deg, got ${eqRes.initialBearingDeg}`,
    );

    // 2. Meridional quarter-meridian (Equator to Pole) on WGS-84: exact Karney/Bowring = 10001965.729312722 m
    const exactQuarterMeridian = 10001965.729312722;
    const merRes = vincentyInverse(0, 0, 90, 0);
    assert.strictEqual(merRes.converged, true);
    const merRelErr = Math.abs(merRes.distanceM - exactQuarterMeridian) / exactQuarterMeridian;
    assert.ok(merRelErr < 1e-6, `Quarter-meridian relErr=${merRelErr} should be < 1e-6`);
    assert.ok(Math.abs(merRes.initialBearingDeg - 0.0) < 1e-6 || Math.abs(merRes.initialBearingDeg - 360.0) < 1e-6);

    // 3. Classic Flinders Peak to Buninyong (Vincenty 1975 benchmark): 54972.271 m, azimuth 306.86816 deg
    const flinders = vincentyInverse(-37.9510334167, 144.4248678889, -37.6528211389, 143.9264955278);
    assert.strictEqual(flinders.converged, true);
    const flindersRelErr = Math.abs(flinders.distanceM - 54972.271) / 54972.271;
    assert.ok(flindersRelErr < 1e-6, `Vincenty 1975 benchmark relErr=${flindersRelErr} should be < 1e-6`);
    assert.ok(Math.abs(flinders.initialBearingDeg - 306.86816) < 1e-3);

    // 4. Haversine agrees within 0.5% of Vincenty and initialBearing matches Vincenty closely
    const hav = haversineDistance(-37.9510334167, 144.4248678889, -37.6528211389, 143.9264955278);
    assert.ok(Math.abs(hav - flinders.distanceM) / flinders.distanceM < 0.005);
    const brg = initialBearing(0, 0, 0, 1);
    assert.ok(Math.abs(brg - 90.0) < 1e-6);
  });

  it("achieves ECEF round-trip RMSE < 1e-6 across global latitudes, longitudes, and altitudes", () => {
    const testPoints: Array<[number, number, number]> = [
      [0, 0, 0],
      [37.7749, -122.4194, 52.3],
      [-33.8688, 151.2093, 18.5],
      [51.5074, -0.1278, 120.0],
      [78.2232, 15.6267, 450.0],
      [-77.8419, 166.6863, 2500.0],
      [89.999, 45.0, 10000.0],
      [-89.999, -135.0, 100.0],
    ];

    let sumSqLat = 0;
    let sumSqLon = 0;
    let sumSqAlt = 0;

    for (const [lat, lon, alt] of testPoints) {
      const ecef = geodeticToEcef(lat, lon, alt);
      const back = ecefToGeodetic(ecef.x, ecef.y, ecef.z);
      sumSqLat += (back.latDeg - lat) ** 2;
      sumSqLon += (back.lonDeg - lon) ** 2;
      sumSqAlt += (back.altM - alt) ** 2;
    }

    const rmseLat = Math.sqrt(sumSqLat / testPoints.length);
    const rmseLon = Math.sqrt(sumSqLon / testPoints.length);
    const rmseAlt = Math.sqrt(sumSqAlt / testPoints.length);

    assert.ok(rmseLat < 1e-6, `ECEF round-trip lat RMSE=${rmseLat} should be < 1e-6`);
    assert.ok(rmseLon < 1e-6, `ECEF round-trip lon RMSE=${rmseLon} should be < 1e-6`);
    assert.ok(rmseAlt < 1e-6, `ECEF round-trip alt RMSE=${rmseAlt} should be < 1e-6`);

    // Verify ENU origin is (0,0,0)
    const enu0 = geodeticToEnu(37.7749, -122.4194, 52.3, 37.7749, -122.4194, 52.3);
    assert.ok(Math.hypot(enu0.e, enu0.n, enu0.u) < 1e-9);
  });

  it("verifies XOR checksum parity and multi-epoch speed/heading kinematics parity", () => {
    // Construct a 4-epoch northbound track at exact 0.001 deg latitude steps every 10 seconds
    // (~111.13 m per 10 s -> ~11.113 m/s, bearing 0 deg)
    const baseLat = 40.0;
    const baseLon = -74.0;
    const stepLat = 0.001;
    const lines: string[] = [];

    for (let i = 0; i < 4; i++) {
      const lat = baseLat + i * stepLat;
      const latDd = decimalDegreesToDdmm(lat, false, 5);
      const lonDd = decimalDegreesToDdmm(baseLon, true, 5);
      const sec = String(i * 10).padStart(2, "0");
      const raw = `$GPGGA,1200${sec},${latDd.value},${latDd.hemisphere},${lonDd.value},${lonDd.hemisphere},1,10,0.9,10.0,M,0.0,M,,`;
      const full = appendNmeaChecksum(raw);
      // Verify XOR checksum manually
      const body = full.slice(1, full.indexOf("*"));
      const cs = full.slice(full.indexOf("*") + 1);
      assert.strictEqual(computeNmeaChecksum(body), cs);
      lines.push(full);
    }

    const track = solveNmeaTrack(lines.join("\n"));
    assert.strictEqual(track.epochs.length, 4);
    assert.strictEqual(track.durationSec, 30);

    const expectedTotal = vincentyInverse(baseLat, baseLon, baseLat + 3 * stepLat, baseLon).distanceM;
    const distRelErr = Math.abs(track.totalDistanceVincentyM - expectedTotal) / expectedTotal;
    assert.ok(distRelErr < 1e-4, `Track distance relErr=${distRelErr} should be < 1e-4`);

    const expectedSpeed = expectedTotal / 30;
    const speedRelErr = Math.abs(track.meanSpeedMps - expectedSpeed) / expectedSpeed;
    assert.ok(speedRelErr < 1e-4, `Mean speed relErr=${speedRelErr} should be < 1e-4`);

    assert.ok(track.meanCourseDeg !== undefined);
    const headingErr = Math.min(track.meanCourseDeg, 360 - track.meanCourseDeg);
    assert.ok(headingErr < 0.05, `Expected ~0 deg North course, got ${track.meanCourseDeg}`);
  });
});
