// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyContrastStretch,
  computeAperturePhotometry,
  getAstroColormapColor,
  lintFitsImage,
  parseFits,
  renderFitsImageSvg,
  type FitsHdu,
} from "../src/fits-astro-builder.js";
import {
  computeEquilibriumMetrics,
  generateFluxContours,
  lintTokamakEquilibrium,
  parseGeqdsk,
  renderTokamakEquilibriumSvg,
  type GeqdskData,
} from "../src/plasma-fusion-builder.js";

describe("Plasma Physics, Fusion & Astrophysics Diagram Builders (Path D)", () => {
  // -------------------------------------------------------------------------
  // 1. Plasma & Tokamak Equilibrium (G-EQDSK)
  // -------------------------------------------------------------------------
  const SAMPLE_GEQDSK = `
EFITD  03/12/2026 #123456  EFIT Equilibrium        3    5    5
 1.20000000E+00 1.80000000E+00 1.67000000E+00 1.07000000E+00 0.00000000E+00
 1.72000000E+00 0.00000000E+00 0.00000000E+00 1.20000000E+00 2.15000000E+00
 1.50000000E+06 0.00000000E+00 0.00000000E+00 1.72000000E+00 0.00000000E+00
 0.00000000E+00 0.00000000E+00 1.20000000E+00 0.00000000E+00 0.00000000E+00
 3.59050000E+00 3.59050000E+00 3.59050000E+00 3.59050000E+00 3.59050000E+00
 4.50000000E+04 4.00000000E+04 3.00000000E+04 1.50000000E+04 0.00000000E+00
 0.00000000E+00 0.00000000E+00 0.00000000E+00 0.00000000E+00 0.00000000E+00
 0.00000000E+00 0.00000000E+00 0.00000000E+00 0.00000000E+00 0.00000000E+00
 0.10000000E+00 0.15000000E+00 0.20000000E+00 0.25000000E+00 0.30000000E+00
 0.12000000E+00 0.08000000E+00 0.05000000E+00 0.08000000E+00 0.25000000E+00
 0.15000000E+00 0.05000000E+00 0.00000000E+00 0.05000000E+00 0.20000000E+00
 0.18000000E+00 0.08000000E+00 0.05000000E+00 0.08000000E+00 0.25000000E+00
 0.25000000E+00 0.20000000E+00 0.18000000E+00 0.22000000E+00 0.35000000E+00
 1.15000000E+00 1.30000000E+00 1.70000000E+00 2.50000000E+00 3.80000000E+00
 8 8
 1.15000000E+00 0.00000000E+00 1.45000000E+00 0.65000000E+00
 1.72000000E+00 0.85000000E+00 2.05000000E+00 0.50000000E+00
 2.25000000E+00 0.00000000E+00 2.05000000E+00 -0.50000000E+00
 1.60000000E+00 -0.88000000E+00 1.35000000E+00 -0.65000000E+00
 1.00000000E+00 0.00000000E+00 1.20000000E+00 1.00000000E+00
 1.70000000E+00 1.15000000E+00 2.20000000E+00 1.00000000E+00
 2.40000000E+00 0.00000000E+00 2.20000000E+00 -1.00000000E+00
 1.65000000E+00 -1.15000000E+00 1.20000000E+00 -1.00000000E+00
`;

  it("parses G-EQDSK file and extracts equilibrium geometry and profiles", () => {
    const data = parseGeqdsk(SAMPLE_GEQDSK);
    assert.strictEqual(data.nw, 5);
    assert.strictEqual(data.nh, 5);
    assert.strictEqual(data.rcentr, 1.67);
    assert.strictEqual(data.rmaxis, 1.72);
    assert.strictEqual(data.zmaxis, 0.0);
    assert.strictEqual(data.current, 1.5e6);
    assert.strictEqual(data.bcentr, 2.15);
    assert.strictEqual(data.rbbbs.length, 8);
    assert.strictEqual(data.zbbbs.length, 8);
    assert.strictEqual(data.rlim.length, 8);
    assert.strictEqual(data.zlim.length, 8);

    const metrics = computeEquilibriumMetrics(data);
    assert.strictEqual(metrics.majorRadiusR0, 1.67);
    assert.ok(
      metrics.minorRadiusA > 0.45 && metrics.minorRadiusA < 0.65,
      `Minor radius a should be ~0.55m: got ${metrics.minorRadiusA}`,
    );
    assert.ok(
      metrics.elongation > 1.4 && metrics.elongation < 1.8,
      `Elongation kappa should be ~1.6: got ${metrics.elongation}`,
    );
    assert.strictEqual(metrics.plasmaCurrentMA, 1.5);
    assert.strictEqual(metrics.toroidalFieldT, 2.15);
    assert.ok(metrics.q0 >= 1.0, `q0 on axis should be >= 1.0: got ${metrics.q0}`);
    assert.ok(metrics.q95 >= 2.0, `q95 at edge should be >= 2.0: got ${metrics.q95}`);
    assert.ok(metrics.xPoint !== undefined, "Single-null divertor X-point should be detected");
    assert.strictEqual(metrics.xPoint?.z, -0.88);
  });

  it("generates concentric poloidal flux contours and renders cross-section SVG", () => {
    const data = parseGeqdsk(SAMPLE_GEQDSK);
    const contours = generateFluxContours(data, [0.25, 0.5, 0.75, 1.0]);

    assert.strictEqual(contours.length, 4);
    assert.strictEqual(contours[0]!.psiNorm, 0.25);
    assert.strictEqual(contours[3]!.psiNorm, 1.0);
    assert.ok(contours[0]!.points.length >= 8);

    const svg = renderTokamakEquilibriumSvg(data, {
      width: 900,
      height: 600,
      showProfiles: true,
      showSeparatrix: true,
      showXPoint: true,
    });

    assert.ok(svg.includes("<svg"), "Should produce SVG element");
    assert.ok(svg.includes("Major Radius R (m)"), "Should label major radius R");
    assert.ok(svg.includes("Vertical Position Z (m)"), "Should label vertical position Z");
    assert.ok(svg.includes("Safety Factor Profile"), "Should include safety factor profile subplot");
    assert.ok(svg.includes("Plasma Pressure"), "Should include pressure profile subplot");
    assert.ok(svg.includes("X-Point"), "Should render X-point diamond label");
    assert.ok(svg.includes("Axis (R=1.72"), "Should render magnetic axis marker");
  });

  it("evaluates fusion MHD stability linter and detects kink hazard and axis errors", () => {
    const data = parseGeqdsk(SAMPLE_GEQDSK);

    // Clean equilibrium should have no errors
    const cleanDiags = lintTokamakEquilibrium(data);
    assert.strictEqual(cleanDiags.filter((d) => d.severity === "error").length, 0);

    // Create equilibrium with kink disruption hazard: q0 < 1 and q95 < 2
    const badKinkData: GeqdskData = {
      ...data,
      qpsi: data.qpsi.map(() => 0.85),
    };
    const kinkDiags = lintTokamakEquilibrium(badKinkData);
    assert.ok(kinkDiags.some((d) => d.code === "FUSION1001" && d.severity === "warning")); // sawtooth
    assert.ok(kinkDiags.some((d) => d.code === "FUSION1001" && d.severity === "error")); // external kink disruption

    // Create equilibrium with magnetic axis outside boundary
    const badAxisData: GeqdskData = {
      ...data,
      rmaxis: 5.5, // way outside 1.15..2.25
    };
    const axisDiags = lintTokamakEquilibrium(badAxisData);
    assert.ok(axisDiags.some((d) => d.code === "FUSION1002" && d.severity === "error"));

    // Create equilibrium with negative pressure
    const badPressData: GeqdskData = {
      ...data,
      pres: data.pres.map((p, idx) => (idx === 3 ? -500 : p)),
    };
    const pressDiags = lintTokamakEquilibrium(badPressData);
    assert.ok(pressDiags.some((d) => d.code === "FUSION1004" && d.severity === "error"));
  });

  // -------------------------------------------------------------------------
  // 2. Astrophysics & Astronomical Image (FITS)
  // -------------------------------------------------------------------------
  const SAMPLE_FITS_TEXT = `
SIMPLE  =                    T / file conforms to FITS standard
BITPIX  =                  -32 / IEEE 32-bit floating point
NAXIS   =                    2 / 2-dimensional image
NAXIS1  =                    8 / Width in pixels
NAXIS2  =                    8 / Height in pixels
BSCALE  =                  1.0 / Calibration scale
BZERO   =                  0.0 / Calibration zero offset
OBJECT  = 'Messier 51'         / Target galaxy
TELESCOP= 'Hubble Space Tel'   / Observatory
EXPTIME =                300.0 / Exposure time in seconds
CRPIX1  =                  4.0 / Reference pixel X
CRPIX2  =                  4.0 / Reference pixel Y
CRVAL1  =             202.4695 / Reference Right Ascension (deg)
CRVAL2  =              47.1952 / Reference Declination (deg)
CDELT1  =            -0.000138 / Pixel scale RA (deg/pix)
CDELT2  =             0.000138 / Pixel scale Dec (deg/pix)
CTYPE1  = 'RA---TAN'           / Gnomonic tangent projection
CTYPE2  = 'DEC--TAN'           / Gnomonic tangent projection
END
DATA_BEGIN
 10.0  12.0  15.0  20.0  22.0  18.0  14.0  11.0
 12.0  18.0  35.0  65.0  70.0  40.0  20.0  12.0
 14.0  25.0  85.0 220.0 240.0 100.0  30.0  15.0
 16.0  35.0 160.0 850.0 920.0 210.0  45.0  18.0
 15.0  32.0 145.0 790.0 880.0 190.0  40.0  16.0
 13.0  22.0  70.0 180.0 210.0  80.0  25.0  14.0
 11.0  16.0  30.0  55.0  60.0  35.0  18.0  12.0
 10.0  11.0  13.0  18.0  20.0  16.0  12.0  10.0
DATA_END
`;

  it("parses FITS text header cards, WCS parameters, and pixel data matrix", () => {
    const hdu = parseFits(SAMPLE_FITS_TEXT);
    assert.strictEqual(hdu.width, 8);
    assert.strictEqual(hdu.height, 8);
    assert.strictEqual(hdu.bitpix, -32);
    assert.strictEqual(hdu.objectName, "Messier 51");
    assert.strictEqual(hdu.telescope, "Hubble Space Tel");
    assert.strictEqual(hdu.expTime, 300.0);
    assert.strictEqual(hdu.data.length, 8);
    assert.strictEqual(hdu.data[0]!.length, 8);

    assert.ok(hdu.wcs !== undefined, "WCS parameters should be extracted");
    assert.strictEqual(hdu.wcs?.crpix[0], 4.0);
    assert.strictEqual(hdu.wcs?.crval[0], 202.4695);
    assert.strictEqual(hdu.wcs?.ctype[0], "RA---TAN");

    assert.strictEqual(hdu.dataMin, 10.0);
    assert.strictEqual(hdu.dataMax, 920.0);
  });

  it("computes non-linear astronomical contrast stretches and false-color LUTs", () => {
    const hdu = parseFits(SAMPLE_FITS_TEXT);

    // Linear stretch
    const lin = applyContrastStretch(hdu.data, "linear");
    assert.strictEqual(lin.length, 8);
    assert.strictEqual(lin[0]![0], 0.0); // min = 10 -> 0
    assert.strictEqual(lin[3]![4], 1.0); // max = 920 -> 1

    // Log stretch
    const log = applyContrastStretch(hdu.data, "log");
    assert.ok(log[3]![4]! >= 0.99);

    // Arcsinh stretch
    const asinh = applyContrastStretch(hdu.data, "arcsinh");
    assert.ok(asinh[3]![4]! >= 0.95);

    // Colormap colors
    const colHeatMin = getAstroColormapColor("heat", 0.0);
    const colHeatMax = getAstroColormapColor("heat", 1.0);
    assert.strictEqual(colHeatMin, "rgb(0, 0, 0)");
    assert.strictEqual(colHeatMax, "rgb(255, 255, 255)");

    const colViridis = getAstroColormapColor("viridis", 0.5);
    assert.ok(colViridis.startsWith("rgb("));
  });

  it("computes aperture photometry, PSF radial profile, and renders astronomical SVG", () => {
    const hdu = parseFits(SAMPLE_FITS_TEXT);

    // Measure photometry around core peak (X=4, Y=4)
    const photo = computeAperturePhotometry(hdu.data, 4, 4, 3.5, 3.5, 4.0);
    assert.strictEqual(photo.centerX, 4);
    assert.strictEqual(photo.centerY, 4);
    assert.ok(photo.peakFlux >= 850, `Peak flux should be >= 850: got ${photo.peakFlux}`);
    assert.ok(photo.skyBackground <= 20, `Sky background should be <= 20: got ${photo.skyBackground}`);
    assert.ok(photo.fwhm > 1.0 && photo.fwhm < 3.5, `FWHM should be ~1.8-2.5 px: got ${photo.fwhm}`);
    assert.ok(photo.radialProfile.length >= 3);

    const svg = renderFitsImageSvg(hdu, {
      width: 900,
      height: 600,
      stretch: "arcsinh",
      colormap: "heat",
      targetCoord: [4, 4],
    });

    assert.ok(svg.includes("<svg"), "Should produce SVG element");
    assert.ok(svg.includes("Messier 51"), "Should display target object name");
    assert.ok(svg.includes("Pixel X (NAXIS1)"), "Should label pixel X axis");
    assert.ok(svg.includes("Radial Point Spread Profile (PSF)"), "Should include PSF radial profile");
    assert.ok(svg.includes("FWHM ="), "Should display FWHM measurement");
    assert.ok(svg.includes("WCS RA / Dec"), "Should display WCS coordinates readout");
  });

  it("evaluates astronomical image linter and detects WCS and dimension errors", () => {
    const hdu = parseFits(SAMPLE_FITS_TEXT);

    // Clean HDU has no errors
    const cleanDiags = lintFitsImage(hdu);
    assert.strictEqual(cleanDiags.filter((d) => d.severity === "error").length, 0);

    // Degenerate WCS transform
    const badWcsHdu: FitsHdu = {
      ...hdu,
      wcs: {
        crpix: [4, 4],
        crval: [202.4, 47.1],
        cdelt: [0.0, 0.0], // degenerate!
        ctype: ["RA---TAN", "DEC--TAN"],
      },
    };
    const wcsDiags = lintFitsImage(badWcsHdu);
    assert.ok(wcsDiags.some((d) => d.code === "ASTRO1001" && d.severity === "error"));

    // Invalid dimensions NAXIS <= 0
    const badDimHdu: FitsHdu = {
      ...hdu,
      width: 0,
      height: -5,
    };
    const dimDiags = lintFitsImage(badDimHdu);
    assert.ok(dimDiags.some((d) => d.code === "ASTRO1002" && d.severity === "error"));

    // Non-positive exposure time
    const badExpHdu: FitsHdu = {
      ...hdu,
      expTime: -10,
    };
    const expDiags = lintFitsImage(badExpHdu);
    assert.ok(expDiags.some((d) => d.code === "ASTRO1004" && d.severity === "warning"));
  });
});
