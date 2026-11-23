// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FITS_BLOCK_BYTES, decodeFitsBinary, encodeFitsBinary } from "../src/parser/index.js";
import {
  angularSeparationDeg,
  aperturePhotometry,
  computeImageStatistics,
  extractWcsFromHeader,
  fluxToMagnitude,
  generateGaussianPsfImage,
  janskyToAbMagnitude,
  magnitudeToFlux,
  pixelToWorld,
  planckRadianceFrequency,
  planckRadianceWavelength,
  stefanBoltzmannFlux,
  worldToPixel,
} from "../src/solver/index.js";
import type { FitsWcsParams, WcsProjectionType } from "../src/types.js";

describe("FITS Quantitative Verification & Physics Benchmarks", () => {
  it("WCS TAN/SIN/ARC pixel <-> sky (RA, Dec) round-trip parity (relErr < 1e-10) & exact angular separation", () => {
    const projections: WcsProjectionType[] = ["TAN", "SIN", "ARC"];
    const testPixels = [
      { x: 512.5, y: 512.5 },
      { x: 1.0, y: 1.0 },
      { x: 1024.0, y: 1024.0 },
      { x: 200.25, y: 810.75 },
      { x: 900.1, y: 120.4 },
    ];

    for (const projection of projections) {
      // Rotated 15 deg CD matrix at 1.5 arcsec/pixel around M31-like sky coordinates
      const scale = 1.5 / 3600.0;
      const theta = (15.0 * Math.PI) / 180.0;
      const wcs: FitsWcsParams = {
        ctype1: `RA---${projection}`,
        ctype2: `DEC--${projection}`,
        projection,
        crpix1: 512.5,
        crpix2: 512.5,
        crval1: 210.8023,
        crval2: 54.3489,
        cd1_1: -scale * Math.cos(theta),
        cd1_2: scale * Math.sin(theta),
        cd2_1: scale * Math.sin(theta),
        cd2_2: scale * Math.cos(theta),
        lonpole: 180.0,
      };

      for (const px of testPixels) {
        const sky = pixelToWorld(wcs, px);
        const recovered = worldToPixel(wcs, sky);
        const relErrX = Math.abs(recovered.x - px.x) / Math.max(1.0, Math.abs(px.x));
        const relErrY = Math.abs(recovered.y - px.y) / Math.max(1.0, Math.abs(px.y));

        assert.ok(
          relErrX < 1e-10 && relErrY < 1e-10,
          `${projection} round-trip failed for (${px.x},${px.y}): relErr=(${relErrX}, ${relErrY})`,
        );
      }

      // Verify exact angular separation at reference point vs 100 pixels North along ARC projection
      if (projection === "ARC") {
        const unrotatedArc: FitsWcsParams = {
          ...wcs,
          cd1_1: -scale,
          cd1_2: 0,
          cd2_1: 0,
          cd2_2: scale,
        };
        const center = pixelToWorld(unrotatedArc, { x: 512.5, y: 512.5 });
        const north100 = pixelToWorld(unrotatedArc, { x: 512.5, y: 612.5 });
        const sep = angularSeparationDeg(center, north100);
        const expectedSep = 100.0 * scale;
        const sepRelErr = Math.abs(sep - expectedSep) / expectedSep;
        assert.ok(sepRelErr < 1e-10, `ARC angular separation relErr=${sepRelErr}`);
      }
    }

    // Orthogonal great-circle angular separation ground truth: (0,0) to (90,0) = 90 deg, (0,0) to (0,90) = 90 deg
    assert.ok(Math.abs(angularSeparationDeg({ raDeg: 0, decDeg: 0 }, { raDeg: 90, decDeg: 0 }) - 90.0) < 1e-12);
    assert.ok(Math.abs(angularSeparationDeg({ raDeg: 45, decDeg: 0 }, { raDeg: 45, decDeg: 90 }) - 90.0) < 1e-12);
  });

  it("BITPIX=-32 and BITPIX=16 BSCALE/BZERO 2880-byte HDU round-trip parity (rmse < 1e-6)", () => {
    const n = 64 * 64;
    const floatPixels = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      floatPixels[i] = 1.25 * Math.sin(i * 0.031) + 5.0;
    }

    // 1. BITPIX = -32 round-trip
    const bin32 = encodeFitsBinary([
      {
        kind: "PRIMARY",
        bitpix: -32,
        axes: [64, 64],
        data: floatPixels,
        extraCards: [
          { keyword: "CTYPE1", value: "RA---TAN" },
          { keyword: "CTYPE2", value: "DEC--TAN" },
          { keyword: "CRVAL1", value: 150.0 },
          { keyword: "CRVAL2", value: 2.2 },
          { keyword: "CRPIX1", value: 32.5 },
          { keyword: "CRPIX2", value: 32.5 },
          { keyword: "CDELT1", value: -0.000277778 },
          { keyword: "CDELT2", value: 0.000277778 },
        ],
      },
    ]);
    assert.strictEqual(bin32.byteLength % FITS_BLOCK_BYTES, 0);
    const dec32 = decodeFitsBinary(bin32);
    const wcs32 = extractWcsFromHeader(dec32.hdus[0]!.header);
    assert.ok(wcs32 && wcs32.projection === "TAN");

    let sqErr32 = 0;
    for (let i = 0; i < n; i++) {
      const d = dec32.hdus[0]!.image!.data[i]! - floatPixels[i]!;
      sqErr32 += d * d;
    }
    const rmse32 = Math.sqrt(sqErr32 / n);
    assert.ok(rmse32 < 1e-6, `BITPIX=-32 round-trip RMSE=${rmse32} exceeded 1e-6`);

    // 2. BITPIX = 16 with exact integer-representable BSCALE=0.01, BZERO=327.68
    const bscale = 0.01;
    const bzero = 327.68;
    const scaledPixels = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const rawInt = (i % 50000) - 25000;
      scaledPixels[i] = bzero + bscale * rawInt;
    }

    const bin16 = encodeFitsBinary([
      {
        kind: "PRIMARY",
        bitpix: 16,
        axes: [64, 64],
        bscale,
        bzero,
        data: scaledPixels,
      },
    ]);
    assert.strictEqual(bin16.byteLength % FITS_BLOCK_BYTES, 0);
    const dec16 = decodeFitsBinary(bin16);

    let sqErr16 = 0;
    for (let i = 0; i < n; i++) {
      const d = dec16.hdus[0]!.image!.data[i]! - scaledPixels[i]!;
      sqErr16 += d * d;
    }
    const rmse16 = Math.sqrt(sqErr16 / n);
    assert.ok(rmse16 < 1e-6, `BITPIX=16 BSCALE/BZERO round-trip RMSE=${rmse16} exceeded 1e-6`);
  });

  it("Gaussian PSF aperture photometry flux recovery & Planck blackbody / magnitude parity", () => {
    const width = 65;
    const height = 65;
    const cx = 32;
    const cy = 32;
    const sigma = 2.2;
    const trueFlux = 50000.0;
    const skyLevel = 125.0;

    const img = generateGaussianPsfImage(width, height, cx, cy, sigma, trueFlux, skyLevel);
    const stats = computeImageStatistics(img, 3.0, 5);
    assert.ok(Math.abs(stats.clippedMean - skyLevel) < 0.05, `Clipped sky mean=${stats.clippedMean}`);

    // Aperture radius = 5 * sigma captures > 99.9996% of a 2D Gaussian PSF
    const phot = aperturePhotometry(img, width, height, cx, cy, 11.0, 16.0, 24.0, 25.0);
    const fluxRelErr = Math.abs(phot.netFlux - trueFlux) / trueFlux;
    assert.ok(fluxRelErr < 1e-3, `Gaussian PSF aperture photometry flux relErr=${fluxRelErr}`);
    assert.ok(Math.abs(phot.skyPerPixel - skyLevel) < 1e-3);

    // Magnitude <-> flux round-trip and AB 3631 Jy zero point
    const mag = fluxToMagnitude(trueFlux, 25.0);
    assert.ok(Math.abs(magnitudeToFlux(mag, 25.0) - trueFlux) / trueFlux < 1e-12);
    assert.ok(Math.abs(janskyToAbMagnitude(3631.0)) < 1e-12);

    // Planck Wien's displacement check for T = 5778 K (Solar photosphere): lambda_max ~ 501.5 nm
    const bPeak = planckRadianceWavelength(501.5e-9, 5778);
    const bBlue = planckRadianceWavelength(350e-9, 5778);
    const bRed = planckRadianceWavelength(800e-9, 5778);
    assert.ok(bPeak > bBlue && bPeak > bRed);
    assert.ok(planckRadianceFrequency(5e14, 5778) > 0);

    // Stefan-Boltzmann solar surface flux ~ 6.32e7 W/m^2
    const solarFlux = stefanBoltzmannFlux(5778);
    assert.ok(Math.abs(solarFlux - 6.32e7) / 6.32e7 < 0.01);
  });
});
