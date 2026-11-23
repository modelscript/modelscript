// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeGrib1Binary, encodeGrib1Binary } from "../src/parser/binary-codec.js";
import {
  computeBarometricPressure,
  computeCoriolisParameter,
  computeGeostrophicWindAtGridPoint,
  computeGeostrophicWindFromGradient,
  computeHypsometricThickness,
  EARTH_RADIUS,
  R_DRY_AIR,
  STANDARD_GRAVITY,
} from "../src/solver/meteorology.js";
import { computeAreaWeightedGlobalMean } from "../src/solver/packing.js";
import type { GribDocument, GribGridDefinitionSection } from "../src/types.js";

describe("GRIB1 Numerical Verification & Meteorological Benchmarks", () => {
  it("achieves relErr < 1e-4 on GRIB1 binary bit-packing and IBM 32-bit float round-trip", () => {
    const ni = 12;
    const nj = 8;
    const original: number[] = [];
    for (let j = 0; j < nj; j++) {
      for (let i = 0; i < ni; i++) {
        // Synthetic 500 hPa geopotential height field (5100..5900 gpm)
        const val = 5500 + 320 * Math.cos((j / (nj - 1)) * Math.PI) + 65 * Math.sin((i / ni) * 2 * Math.PI);
        original.push(val);
      }
    }

    const doc: GribDocument = {
      isBinary: true,
      syntaxErrors: [],
      messages: [
        {
          index: 0,
          indicator: { magic: "GRIB", totalLength: 0, edition: 1 },
          pds: {
            tableVersion: 2,
            centerId: 7,
            generatingProcessId: 81,
            gridId: 255,
            hasGds: true,
            hasBms: false,
            parameterCode: 7,
            parameterName: "HGT",
            levelType: 100,
            levelName: "ISBL",
            levelValue: 500,
            year: 2026,
            month: 1,
            day: 15,
            hour: 0,
            minute: 0,
            timeUnit: 1,
            p1: 0,
            p2: 0,
            timeRangeIndicator: 0,
            century: 21,
            subCenterId: 0,
            decimalScaleFactor: 2,
          },
          gds: {
            dataRepresentationType: 0,
            ni,
            nj,
            la1: 70,
            lo1: -120,
            resolutionFlags: 128,
            la2: 0,
            lo2: -10,
            di: 10,
            dj: 10,
            scanningMode: 0,
          },
          bds: {
            flags: 0,
            binaryScaleFactor: 0,
            referenceValue: 0,
            bitsPerValue: 16,
            values: original,
          },
          end: { magic: "7777", present: true },
        },
      ],
    };

    const bytes = encodeGrib1Binary(doc);
    const decoded = decodeGrib1Binary(bytes);
    const unpacked = decoded.messages[0]!.bds!.values;
    assert.equal(unpacked.length, original.length);

    let maxRelErr = 0;
    for (let k = 0; k < original.length; k++) {
      const relErr = Math.abs(unpacked[k]! - original[k]!) / Math.abs(original[k]!);
      if (relErr > maxRelErr) maxRelErr = relErr;
    }
    assert.ok(maxRelErr < 1e-4, `GRIB1 binary round-trip maxRelErr=${maxRelErr} exceeded 1e-4`);
  });

  it("matches analytical hypsometric thickness and barometric pressure with rmse < 1e-6", () => {
    const cases: Array<[T: number, p1: number, p2: number]> = [
      [255.0, 100000, 50000],
      [273.15, 101325, 85000],
      [230.0, 50000, 20000],
      [288.15, 101325, 70000],
    ];

    let sqErrThickness = 0;
    let sqErrPressure = 0;
    for (const [T, p1, p2] of cases) {
      const expectedDz = ((R_DRY_AIR * T) / STANDARD_GRAVITY) * Math.log(p1 / p2);
      const res = computeHypsometricThickness(T, p1, p2);
      const diffZ = res.thicknessMeters - expectedDz;
      sqErrThickness += diffZ * diffZ;

      // Invert via barometric formula p(DeltaZ) should recover p2 exactly
      const pRecovered = computeBarometricPressure(p1, res.thicknessMeters, T);
      const diffP = pRecovered - p2;
      sqErrPressure += diffP * diffP;
    }

    const rmseZ = Math.sqrt(sqErrThickness / cases.length);
    const rmseP = Math.sqrt(sqErrPressure / cases.length);
    assert.ok(rmseZ < 1e-6, `Hypsometric thickness RMSE=${rmseZ} exceeded 1e-6`);
    assert.ok(rmseP < 1e-6, `Barometric pressure inversion RMSE=${rmseP} exceeded 1e-6`);
  });

  it("matches analytical mid-latitude geostrophic wind on a linear geopotential plane with rmse < 1e-6", () => {
    const lat0 = 45.0;
    const f = computeCoriolisParameter(lat0);
    const uExact = 22.5; // m/s eastward
    const vExact = -8.4; // m/s southward

    // Exact linear gradient dZ/dx, dZ/dy corresponding to (uExact, vExact)
    const dZdy = -(f / STANDARD_GRAVITY) * uExact;
    const dZdx = (f / STANDARD_GRAVITY) * vExact;

    const direct = computeGeostrophicWindFromGradient(dZdx, dZdy, lat0);
    const rmseDirect = Math.sqrt(((direct.u - uExact) ** 2 + (direct.v - vExact) ** 2) / 2);
    assert.ok(rmseDirect < 1e-6, `Direct geostrophic wind RMSE=${rmseDirect} exceeded 1e-6`);

    // Construct a 3x3 regular lat/lon grid centered at lat0 = 45 deg with exact linear Z(x, y)
    const dLat = 1.0;
    const dLon = 1.0;
    const gds: GribGridDefinitionSection = {
      dataRepresentationType: 0,
      ni: 3,
      nj: 3,
      la1: lat0 - dLat,
      lo1: -dLon,
      resolutionFlags: 128,
      la2: lat0 + dLat,
      lo2: dLon,
      di: dLon,
      dj: dLat,
      scanningMode: 0,
    };

    const deg2rad = Math.PI / 180;
    const cosLat0 = Math.cos(lat0 * deg2rad);
    const zGrid: number[] = [];
    for (let j = 0; j < 3; j++) {
      const lat = gds.la1 + j * dLat;
      const y = EARTH_RADIUS * (lat - lat0) * deg2rad;
      for (let i = 0; i < 3; i++) {
        const lon = gds.lo1 + i * dLon;
        const x = EARTH_RADIUS * cosLat0 * lon * deg2rad;
        zGrid.push(5500 + dZdx * x + dZdy * y);
      }
    }

    const gridWind = computeGeostrophicWindAtGridPoint(zGrid, gds, 1, 1);
    const rmseGrid = Math.sqrt(((gridWind.u - uExact) ** 2 + (gridWind.v - vExact) ** 2) / 2);
    assert.ok(rmseGrid < 1e-6, `Grid geostrophic wind RMSE=${rmseGrid} exceeded 1e-6`);
  });

  it("computes cosine-latitude area-weighted global mean accurately", () => {
    // Field Y(lat) = cos(lat): analytical global area-weighted mean = (integral cos^2(phi) dphi) / (integral cos(phi) dphi) = pi/4
    const nj = 181;
    const ni = 4;
    const gds: GribGridDefinitionSection = {
      dataRepresentationType: 0,
      ni,
      nj,
      la1: -90,
      lo1: 0,
      resolutionFlags: 128,
      la2: 90,
      lo2: 270,
      di: 90,
      dj: 1,
      scanningMode: 0,
    };
    const values: number[] = [];
    for (let j = 0; j < nj; j++) {
      const lat = -90 + j;
      const v = Math.cos((lat * Math.PI) / 180);
      for (let i = 0; i < ni; i++) values.push(v);
    }
    const mean = computeAreaWeightedGlobalMean(values, gds);
    const analytical = Math.PI / 4;
    assert.ok(Math.abs(mean - analytical) < 1e-3, `Area-weighted mean=${mean}, expected ~${analytical}`);
  });
});
