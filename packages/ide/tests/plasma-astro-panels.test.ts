// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeAperturePhotometry, parseFits, renderFitsImageSvg } from "@modelscript/diagram/fits-astro";
import {
  computeEquilibriumMetrics,
  parseGeqdsk,
  renderTokamakEquilibriumSvg,
} from "@modelscript/diagram/plasma-fusion";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FitsImageViewerEditorProvider, FitsImageViewerPanel } from "../src/fits-image-panel.js";
import { TokamakEquilibriumEditorProvider, TokamakEquilibriumPanel } from "../src/tokamak-equilibrium-panel.js";

const SAMPLE_GEQDSK_FIXTURE = `
EFITD  03/12/2026 #654321  DIII-D Baseline         3    5    5
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

const SAMPLE_FITS_FIXTURE = `
SIMPLE  =                    T / file conforms to FITS standard
BITPIX  =                  -32 / IEEE 32-bit floating point
NAXIS   =                    2 / 2-dimensional image
NAXIS1  =                    6 / Width in pixels
NAXIS2  =                    6 / Height in pixels
BSCALE  =                  1.0 / Calibration scale
BZERO   =                  0.0 / Calibration zero offset
OBJECT  = 'Crab Nebula'        / Supernova remnant target
TELESCOP= 'James Webb Space'   / JWST NIRCam
EXPTIME =                600.0 / Exposure time in seconds
CRPIX1  =                  3.0 / Reference pixel X
CRPIX2  =                  3.0 / Reference pixel Y
CRVAL1  =              83.6331 / Reference Right Ascension (deg)
CRVAL2  =              22.0145 / Reference Declination (deg)
CDELT1  =            -0.000050 / Pixel scale RA (deg/pix)
CDELT2  =             0.000050 / Pixel scale Dec (deg/pix)
CTYPE1  = 'RA---TAN'           / Gnomonic tangent projection
CTYPE2  = 'DEC--TAN'           / Gnomonic tangent projection
END
DATA_BEGIN
 15.0  20.0  35.0  40.0  25.0  15.0
 22.0  65.0 180.0 210.0  75.0  20.0
 30.0 190.0 850.0 920.0 220.0  35.0
 28.0 160.0 790.0 840.0 180.0  30.0
 18.0  50.0 140.0 160.0  60.0  18.0
 12.0  18.0  25.0  30.0  20.0  12.0
DATA_END
`;

describe("Plasma Physics, Fusion & Astrophysics IDE Panels (Path D)", () => {
  it("exposes TokamakEquilibriumPanel and TokamakEquilibriumEditorProvider viewType identifiers", () => {
    assert.equal(TokamakEquilibriumPanel.viewType, "modelscript.tokamakEquilibriumViewer");
    assert.equal(TokamakEquilibriumEditorProvider.viewType, "modelscript.tokamakEquilibriumEditor");
  });

  it("constructs tokamak equilibrium from G-EQDSK and renders poloidal cross-section SVG", () => {
    const data = parseGeqdsk(SAMPLE_GEQDSK_FIXTURE);
    assert.equal(data.comment, "EFITD  03/12/2026 #654321  DIII-D Baseline");
    assert.equal(data.nw, 5);
    assert.equal(data.nh, 5);
    assert.equal(data.rcentr, 1.67);

    const metrics = computeEquilibriumMetrics(data);
    assert.ok(metrics.q0 >= 1.0);
    assert.ok(metrics.q95 >= 2.0);
    assert.equal(metrics.plasmaCurrentMA, 1.5);

    const svg = renderTokamakEquilibriumSvg(data, {
      width: 900,
      height: 600,
      showProfiles: true,
      darkMode: true,
    });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("Major Radius R (m)"), "Should include horizontal R axis label");
    assert.ok(svg.includes("Vertical Position Z (m)"), "Should include vertical Z axis label");
    assert.ok(svg.includes("Safety Factor Profile"), "Should include q profile subplot");
    assert.ok(svg.includes("Plasma Pressure"), "Should include pressure profile subplot");
  });

  it("exposes FitsImageViewerPanel and FitsImageViewerEditorProvider viewType identifiers", () => {
    assert.equal(FitsImageViewerPanel.viewType, "modelscript.fitsImageViewer");
    assert.equal(FitsImageViewerEditorProvider.viewType, "modelscript.fitsImageEditor");
  });

  it("parses FITS image and renders astronomical viewer SVG with aperture photometry", () => {
    const hdu = parseFits(SAMPLE_FITS_FIXTURE);
    assert.equal(hdu.objectName, "Crab Nebula");
    assert.equal(hdu.telescope, "James Webb Space");
    assert.equal(hdu.expTime, 600.0);
    assert.equal(hdu.width, 6);
    assert.equal(hdu.height, 6);

    const photometry = computeAperturePhotometry(hdu.data, 3, 3, 2.5);
    assert.ok(photometry.peakFlux > 800);
    assert.ok(photometry.fwhm > 1.0 && photometry.fwhm < 3.0);

    const svg = renderFitsImageSvg(hdu, {
      width: 900,
      height: 600,
      stretch: "arcsinh",
      colormap: "heat",
      targetCoord: [3, 3],
      darkMode: true,
    });

    assert.ok(svg.includes("<svg"), "Should output valid SVG root");
    assert.ok(svg.includes("Crab Nebula"), "Should display target name in title");
    assert.ok(svg.includes("Radial Point Spread Profile (PSF)"), "Should render PSF radial profile");
    assert.ok(svg.includes("Pixel X (NAXIS1)"), "Should label pixel X axis");
  });
});
